// server.js
// Hospital Management System - Backend API
// Tech: Node.js + Express + SQLite (better-sqlite3) + JWT auth

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "hms_mini_project_secret_key_2026"; // set JWT_SECRET env var in production

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------------
function authRequired(req, res, next) {
  const header = req.headers["authorization"];
  const token = header && header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not authorized for this action" });
    }
    next();
  };
}

// ---------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------
// This project accepts Gmail addresses only. This checks the address format/domain;
// verifying that the inbox actually belongs to the user requires an email OTP flow.
function isGmailAddress(email) {
  return typeof email === "string" && /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(email.trim());
}

// Register a new patient (public signup)
app.post("/api/auth/register", (req, res) => {
  const { name, email, password, age, gender, contact, address } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required" });
  }
  if (!isGmailAddress(email)) {
    return res.status(400).json({ error: "Please enter a valid Gmail address ending with @gmail.com" });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) return res.status(400).json({ error: "Email already registered" });

  const hashed = bcrypt.hashSync(password, 8);
  const info = db
    .prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'patient')")
    .run(name, normalizedEmail, hashed);

  db.prepare(
    "INSERT INTO patients (user_id, age, gender, contact, address) VALUES (?, ?, ?, ?, ?)"
  ).run(info.lastInsertRowid, age || null, gender || null, contact || null, address || null);

  res.json({ message: "Registration successful. Please log in." });
});

// Login (all roles)
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!isGmailAddress(email)) {
    return res.status(400).json({ error: "Please enter a valid Gmail address ending with @gmail.com" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ---------------------------------------------------------------
// DEPARTMENTS
// ---------------------------------------------------------------
app.get("/api/departments", authRequired, (req, res) => {
  const depts = db.prepare("SELECT * FROM departments ORDER BY name").all();
  res.json(depts);
});

app.post("/api/departments", authRequired, roleRequired("admin"), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Department name required" });
  try {
    const info = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
    res.json({ id: info.lastInsertRowid, name });
  } catch (e) {
    res.status(400).json({ error: "Department already exists" });
  }
});

// ---------------------------------------------------------------
// DOCTORS
// ---------------------------------------------------------------

// Public-ish listing (any logged in user) - used for booking
app.get("/api/doctors", authRequired, (req, res) => {
  const { department_id } = req.query;
  let rows;
  if (department_id) {
    rows = db
      .prepare(
        `SELECT d.id, u.name, d.specialization, d.qualification, d.experience, d.fee, dep.name as department
         FROM doctors d
         JOIN users u ON u.id = d.user_id
         JOIN departments dep ON dep.id = d.department_id
         WHERE d.department_id = ?`
      )
      .all(department_id);
  } else {
    rows = db
      .prepare(
        `SELECT d.id, u.name, d.specialization, d.qualification, d.experience, d.fee, dep.name as department
         FROM doctors d
         JOIN users u ON u.id = d.user_id
         JOIN departments dep ON dep.id = d.department_id`
      )
      .all();
  }
  res.json(rows);
});

// Admin adds a new doctor (creates user + doctor row)
app.post("/api/doctors", authRequired, roleRequired("admin"), (req, res) => {
  const { name, email, password, department_id, specialization, qualification, experience, fee } = req.body;
  if (!name || !email || !password || !department_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!isGmailAddress(email)) {
    return res.status(400).json({ error: "Please enter a valid Gmail address ending with @gmail.com" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) return res.status(400).json({ error: "Email already in use" });

  const hashed = bcrypt.hashSync(password, 8);
  const uinfo = db
    .prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'doctor')")
    .run(name, normalizedEmail, hashed);

  const dinfo = db
    .prepare(
      "INSERT INTO doctors (user_id, department_id, specialization, qualification, experience, fee) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(uinfo.lastInsertRowid, department_id, specialization || "", qualification || "", experience || 0, fee || 300);

  res.json({ id: dinfo.lastInsertRowid, message: "Doctor added successfully" });
});

// Doctor's available slots for a given date (very simple: fixed slots minus already booked ones)
const ALL_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"];

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const nowHM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
// A slot is bookable if it is not in the past (for today) and not already taken.
const isPast = (date, slot) => date < todayStr() || (date === todayStr() && slot <= nowHM());

app.get("/api/doctors/:id/slots", authRequired, (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });

  const booked = db
    .prepare(
      `SELECT appt_time FROM appointments WHERE doctor_id = ? AND appt_date = ? AND status != 'Cancelled'`
    )
    .all(req.params.id, date)
    .map((r) => r.appt_time);

  const slots = ALL_SLOTS.map((time) => ({
    time,
    status: booked.includes(time) ? "booked" : isPast(date, time) ? "past" : "available",
  }));
  res.json({ date, slots, available: slots.filter((s) => s.status === "available").map((s) => s.time) });
});

// ---------------------------------------------------------------
// APPOINTMENTS
// ---------------------------------------------------------------

// Patient books an appointment
app.post("/api/appointments", authRequired, roleRequired("patient"), (req, res) => {
  const { doctor_id, appt_date, appt_time, reason } = req.body;
  if (!doctor_id || !appt_date || !appt_time) {
    return res.status(400).json({ error: "doctor_id, appt_date and appt_time are required" });
  }

  if (!ALL_SLOTS.includes(appt_time)) return res.status(400).json({ error: "Invalid time slot" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appt_date) || isPast(appt_date, appt_time)) return res.status(400).json({ error: "Please choose a future date and time." });

  const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.user.id);
  if (!patient) return res.status(400).json({ error: "Patient profile not found" });
  if (!db.prepare("SELECT id FROM doctors WHERE id = ?").get(doctor_id)) return res.status(400).json({ error: "Invalid doctor" });

  // check slot still free
  const clash = db
    .prepare(
      `SELECT id FROM appointments WHERE doctor_id = ? AND appt_date = ? AND appt_time = ? AND status != 'Cancelled'`
    )
    .get(doctor_id, appt_date, appt_time);
  if (clash) return res.status(400).json({ error: "This slot was just booked. Please choose another." });

  const info = db
    .prepare(
      `INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, reason, status)
       VALUES (?, ?, ?, ?, ?, 'Confirmed')`
    )
    .run(patient.id, doctor_id, appt_date, appt_time, reason || "");

  res.json({ id: info.lastInsertRowid, message: "Appointment booked successfully" });
});

// Get appointments - filtered by logged in user's role
app.get("/api/appointments", authRequired, (req, res) => {
  let rows;
  if (req.user.role === "patient") {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.user.id);
    rows = db
      .prepare(
        `SELECT a.*, u.name as doctor_name, dep.name as department
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         JOIN users u ON u.id = d.user_id
         JOIN departments dep ON dep.id = d.department_id
         WHERE a.patient_id = ?
         ORDER BY a.appt_date DESC, a.appt_time DESC`
      )
      .all(patient ? patient.id : -1);
  } else if (req.user.role === "doctor") {
    const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.user.id);
    rows = db
      .prepare(
        `SELECT a.*, u.name as patient_name, p.age, p.gender, p.contact
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users u ON u.id = p.user_id
         WHERE a.doctor_id = ?
         ORDER BY a.appt_date DESC, a.appt_time DESC`
      )
      .all(doctor ? doctor.id : -1);
  } else {
    // admin sees everything
    rows = db
      .prepare(
        `SELECT a.*, pu.name as patient_name, du.name as doctor_name, dep.name as department
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users pu ON pu.id = p.user_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN users du ON du.id = d.user_id
         JOIN departments dep ON dep.id = d.department_id
         ORDER BY a.appt_date DESC, a.appt_time DESC`
      )
      .all();
  }
  res.json(rows);
});

// Update appointment status (doctor marks Completed, patient/admin cancels)
app.patch("/api/appointments/:id/status", authRequired, (req, res) => {
  const { status } = req.body;
  const validStatuses = ["Pending", "Confirmed", "Completed", "Cancelled"];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });

  const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
  if (!appt) return res.status(404).json({ error: "Appointment not found" });

  // authorization check: patient can only cancel own, doctor can only update own, admin can do anything
  if (req.user.role === "patient") {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.user.id);
    if (!patient || appt.patient_id !== patient.id || status !== "Cancelled" || appt.status === "Completed") {
      return res.status(403).json({ error: "Not authorized" });
    }
  } else if (req.user.role === "doctor") {
    const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.user.id);
    if (!doctor || appt.doctor_id !== doctor.id) {
      return res.status(403).json({ error: "Not authorized" });
    }
  }

  db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ message: "Status updated" });
});

// ---------------------------------------------------------------
// PRESCRIPTIONS
// ---------------------------------------------------------------

// Doctor adds a prescription for an appointment
app.post("/api/prescriptions", authRequired, roleRequired("doctor"), (req, res) => {
  const { appointment_id, medicines, notes } = req.body;
  if (!appointment_id || !medicines) {
    return res.status(400).json({ error: "appointment_id and medicines are required" });
  }

  const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.user.id);
  const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointment_id);
  if (!doctor || !appt || appt.doctor_id !== doctor.id) {
    return res.status(403).json({ error: "Not authorized for this appointment" });
  }

  const existing = db
    .prepare("SELECT id FROM prescriptions WHERE appointment_id = ?")
    .get(appointment_id);

  if (existing) {
    db.prepare("UPDATE prescriptions SET medicines = ?, notes = ? WHERE appointment_id = ?").run(
      medicines,
      notes || "",
      appointment_id
    );
  } else {
    db.prepare(
      "INSERT INTO prescriptions (appointment_id, medicines, notes) VALUES (?, ?, ?)"
    ).run(appointment_id, medicines, notes || "");
  }

  db.prepare("UPDATE appointments SET status = 'Completed' WHERE id = ?").run(appointment_id);

  res.json({ message: "Prescription saved" });
});

// Get prescription for an appointment
app.get("/api/prescriptions/:appointmentId", authRequired, (req, res) => {
  // ownership check: only the patient/doctor of this appointment (or admin) may read it
  const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.appointmentId);
  if (!appt) return res.status(404).json({ error: "No prescription found" });
  if (req.user.role === "patient") {
    const p = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.user.id);
    if (!p || p.id !== appt.patient_id) return res.status(403).json({ error: "Not authorized" });
  } else if (req.user.role === "doctor") {
    const d = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.user.id);
    if (!d || d.id !== appt.doctor_id) return res.status(403).json({ error: "Not authorized" });
  }
  const rx = db
    .prepare("SELECT * FROM prescriptions WHERE appointment_id = ?")
    .get(req.params.appointmentId);
  if (!rx) return res.status(404).json({ error: "No prescription found" });
  res.json(rx);
});

// ---------------------------------------------------------------
// ADMIN DASHBOARD STATS
// ---------------------------------------------------------------
app.get("/api/admin/stats", authRequired, roleRequired("admin"), (req, res) => {
  const totalPatients = db.prepare("SELECT COUNT(*) c FROM patients").get().c;
  const totalDoctors = db.prepare("SELECT COUNT(*) c FROM doctors").get().c;
  const totalAppointments = db.prepare("SELECT COUNT(*) c FROM appointments").get().c;
  const todayAppointments = db
    .prepare("SELECT COUNT(*) c FROM appointments WHERE appt_date = date('now')")
    .get().c;

  const byDept = db
    .prepare(
      `SELECT dep.name as department, COUNT(a.id) as count
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN departments dep ON dep.id = d.department_id
       GROUP BY dep.name`
    )
    .all();

  const byStatus = db
    .prepare(`SELECT status, COUNT(*) as count FROM appointments GROUP BY status`)
    .all();

  res.json({ totalPatients, totalDoctors, totalAppointments, todayAppointments, byDept, byStatus });
});

// AI Symptom Checker module (triage + LLM + PDF + clinics)
app.use("/api", require("./patients")(db, authRequired, roleRequired));
app.use("/api", require("./symptoms")(db, authRequired, roleRequired));

// ---------------------------------------------------------------
// FALLBACK: serve frontend
// ---------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\nHospital Management System running at http://localhost:${PORT}\n`);
});
