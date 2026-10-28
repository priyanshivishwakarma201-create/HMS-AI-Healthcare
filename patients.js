// patients.js - Patient registration/profile + doctor-side patient history
const express = require("express");

module.exports = (db, authRequired, roleRequired) => {
  const r = express.Router();
  const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
  const patientOf = (uid) => db.prepare("SELECT id FROM patients WHERE user_id = ?").get(uid);
  const doctorOf = (uid) => db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(uid);

  // ---------- Patient: own registration profile ----------
  r.get("/patient/profile", authRequired, roleRequired("patient"), (req, res) => {
    const p = db.prepare("SELECT p.*, u.name, u.email FROM patients p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?").get(req.user.id);
    if (!p) return res.status(404).json({ error: "Patient profile not found" });
    res.json(p);
  });

  r.put("/patient/profile", authRequired, roleRequired("patient"), (req, res) => {
    const b = req.body || {};
    const name = clean(b.name, 80), age = parseInt(b.age, 10), gender = clean(b.gender, 10);
    const mobile = clean(b.contact, 15).replace(/[\s-]/g, "");
    const address = clean(b.address, 200), city = clean(b.city, 60);
    const regType = clean(b.registration_type, 30);
    if (!name) return res.status(400).json({ error: "Full name is required" });
    if (!(age >= 0 && age <= 120)) return res.status(400).json({ error: "Enter a valid age (0-120)" });
    if (!["Male", "Female", "Other"].includes(gender)) return res.status(400).json({ error: "Select gender" });
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: "Enter a valid 10-digit mobile number" });
    if (!address || !city) return res.status(400).json({ error: "Address and city are required" });
    if (!["New Patient", "Returning Patient", "Emergency"].includes(regType)) return res.status(400).json({ error: "Select registration type" });
    const p = patientOf(req.user.id);
    if (!p) return res.status(404).json({ error: "Patient profile not found" });
    db.transaction(() => {
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
      db.prepare(`UPDATE patients SET age=?, gender=?, contact=?, address=?, city=?, blood_group=?, emergency_contact=?,
        registration_type=?, chief_complaint=?, allergies=?, existing_conditions=?, profile_complete=1,
        registered_at=COALESCE(registered_at, CURRENT_TIMESTAMP) WHERE id=?`)
        .run(age, gender, mobile, address, city, clean(b.blood_group, 5), clean(b.emergency_contact, 15),
          regType, clean(b.chief_complaint, 500), clean(b.allergies, 200), clean(b.existing_conditions, 300), p.id);
    })();
    res.json({ message: "Registration saved", profile_complete: 1 });
  });

  // ---------- Doctor: my patients + stored history ----------
  r.get("/doctor/patients", authRequired, roleRequired("doctor"), (req, res) => {
    const d = doctorOf(req.user.id);
    if (!d) return res.json([]);
    res.json(db.prepare(`SELECT p.id, u.name, p.age, p.gender, p.contact, COUNT(a.id) AS visits, MAX(a.appt_date) AS last_visit
      FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = p.user_id
      WHERE a.doctor_id = ? GROUP BY p.id ORDER BY last_visit DESC`).all(d.id));
  });

  r.get("/doctor/patients/:pid/history", authRequired, roleRequired("doctor"), (req, res) => {
    const d = doctorOf(req.user.id), pid = +req.params.pid;
    // a doctor may only open the history of patients who have an appointment with them
    if (!d || !db.prepare("SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ?").get(d.id, pid))
      return res.status(403).json({ error: "Not authorized for this patient" });
    const profile = db.prepare(`SELECT p.id, u.name, p.age, p.gender, p.contact, p.emergency_contact, p.address, p.city, p.blood_group,
      p.registration_type, p.chief_complaint, p.allergies, p.existing_conditions FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(pid);
    const assessments = db.prepare(`SELECT a.created_at, a.risk_level, a.score, a.ai_guidance, a.suggested_department,
      l.symptoms, l.severity, l.duration_days, l.notes FROM Assessments a JOIN SymptomLogs l ON l.id = a.log_id
      WHERE a.patient_id = ? ORDER BY a.id DESC`).all(pid);
    const visits = db.prepare(`SELECT ap.appt_date, ap.appt_time, ap.reason, ap.status, du.name AS doctor_name, dep.name AS department,
      rx.medicines, rx.notes AS rx_notes FROM appointments ap JOIN doctors dd ON dd.id = ap.doctor_id
      JOIN users du ON du.id = dd.user_id JOIN departments dep ON dep.id = dd.department_id
      LEFT JOIN prescriptions rx ON rx.appointment_id = ap.id WHERE ap.patient_id = ?
      ORDER BY ap.appt_date DESC, ap.appt_time DESC`).all(pid);
    res.json({ profile, assessments, visits });
  });
  return r;
};
