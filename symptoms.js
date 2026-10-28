// symptoms.js - AI Symptom Checker module (plugs into the existing HMS)
// Triage scoring engine + LLM/NLP guidance + PDF summary + clinic directory
const express = require("express");
const PDFDocument = require("pdfkit");

// Every symptom maps to a department so the booking page can always pre-select one.
const SYMPTOMS = {
  "Chest pain": { w: 10, red: true, dept: "Cardiology" },
  "Difficulty breathing": { w: 10, red: true, dept: "Pulmonology" },
  "Loss of consciousness": { w: 10, red: true, dept: "Neurology" },
  "Severe bleeding": { w: 10, red: true, dept: "General Medicine" },
  "Face drooping / slurred speech": { w: 10, red: true, dept: "Neurology" },
  "High fever (above 102F)": { w: 5, dept: "General Medicine" },
  "Persistent vomiting": { w: 4, dept: "Gastroenterology" },
  "Abdominal pain": { w: 4, dept: "Gastroenterology" },
  "Diarrhea": { w: 3, dept: "Gastroenterology" },
  "Persistent cough": { w: 3, dept: "Pulmonology" },
  "Fever": { w: 3, dept: "General Medicine" },
  "Skin rash": { w: 2, dept: "Dermatology" },
  "Headache": { w: 2, dept: "Neurology" },
  "Sore throat": { w: 2, dept: "ENT" },
  "Joint / body pain": { w: 2, dept: "Orthopedics" },
  "Fatigue": { w: 1, dept: "General Medicine" },
  "Cold / runny nose": { w: 1, dept: "ENT" },
};

// Departments where a child (under 14) should be seen by the Pediatrician instead.
const CHILD_REDIRECT = ["General Medicine", "ENT", "Gastroenterology", "Pulmonology"];

// Pick the department with the highest combined symptom weight (ties -> the heavier single symptom).
function pickDepartment(symptoms, age) {
  const score = {}, top = {};
  for (const s of symptoms) {
    const d = SYMPTOMS[s]; if (!d || !d.dept) continue;
    score[d.dept] = (score[d.dept] || 0) + d.w;
    top[d.dept] = Math.max(top[d.dept] || 0, d.w);
  }
  const ranked = Object.keys(score).sort((a, b) => score[b] - score[a] || top[b] - top[a]);
  let dept = ranked[0] || "General Medicine";
  if (age && age < 14 && CHILD_REDIRECT.includes(dept)) dept = "Pediatrics";
  return { dept, alternatives: ranked.filter((d) => d !== dept).slice(0, 2) };
}

// Severity (1-5) is calculated by the SYSTEM from the symptoms, how many days they have lasted, and age.
function autoSeverity(symptoms, duration, age) {
  let sum = 0, max = 0;
  for (const s of symptoms) { const w = SYMPTOMS[s] ? SYMPTOMS[s].w : 0; sum += w; max = Math.max(max, w); }
  let sev = max >= 10 ? 5 : max >= 5 ? 3 : sum >= 5 ? 2 : 1;
  if (duration >= 3) sev++;
  if (duration >= 7) sev++;
  if (age && (age < 5 || age >= 60)) sev++;
  return Math.min(5, sev);
}

// Rule-based triage: red-flag symptoms override everything; the AI never decides the level.
function triage({ symptoms, duration, age }) {
  let sum = 0, red = false;
  for (const s of symptoms) {
    const d = SYMPTOMS[s]; if (!d) continue;
    sum += d.w; if (d.red) red = true;
  }
  const severity = autoSeverity(symptoms, duration, age);
  const score = sum + severity * 2 + (age && (age < 5 || age >= 60) ? 3 : 0);
  const level = red || score >= 18 ? "Emergency" : score >= 10 || duration >= 5 ? "Doctor Visit" : "Home Care";
  const { dept, alternatives } = pickDepartment(symptoms, age);
  return { score, level, dept, alternatives, severity };
}

const DISCLAIMER = "This is informational assistance only. It is NOT a medical diagnosis and does not replace consultation with a qualified doctor. In an emergency call 112 (India) or 108 (ambulance).";
const FALLBACK = {
  "Emergency": "Your symptoms may need IMMEDIATE medical attention. Call 112/108 or go to the nearest emergency department now. Do not travel alone or drive yourself.",
  "Doctor Visit": "Consulting a doctor within 24-48 hours is recommended. Note when symptoms started and any medicines taken, and watch for worsening.",
  "Home Care": "Symptoms look mild. Rest, drink fluids, eat light food and monitor. See a doctor if symptoms worsen or last more than 3 days.",
};

async function aiGuidance(i, level) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return FALLBACK[level];
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", max_tokens: 250, temperature: 0.3, messages: [
        { role: "system", content: "You are a health-information assistant. NEVER diagnose, NEVER name a definite disease, NEVER prescribe medicines or doses. Give general self-care and next-step guidance in under 120 words, consistent with the triage level given. If level is Emergency, tell the user to seek emergency care immediately." },
        { role: "user", content: `Triage level: ${level}. Age: ${i.age}. Symptoms: ${i.symptoms.join(", ")}. Severity 1-5: ${i.severity}. Duration (days): ${i.duration}. Notes: ${i.notes || "none"}.` }] }) });
    const j = await r.json();
    return j.choices[0].message.content.trim();
  } catch (e) { return FALLBACK[level]; }
}

module.exports = (db, authRequired, roleRequired) => {
  const r = express.Router();
  const patientOf = (uid) => db.prepare("SELECT * FROM patients WHERE user_id = ?").get(uid);

  r.get("/symptoms", authRequired, (req, res) => res.json(Object.keys(SYMPTOMS)));

  r.get("/clinics", authRequired, (req, res) => res.json(db.prepare("SELECT * FROM ClinicLocations").all()));

  r.post("/assess", authRequired, roleRequired("patient"), async (req, res) => {
    const p = patientOf(req.user.id);
    if (!p) return res.status(400).json({ error: "Patient profile not found" });
    if (!p.profile_complete) return res.status(400).json({ error: "Please complete your registration first." });
    const b = req.body || {};
    const symptoms = (Array.isArray(b.symptoms) ? b.symptoms : []).filter((s) => SYMPTOMS[s]);
    if (!symptoms.length) return res.status(400).json({ error: "Select at least one symptom" });
    const input = { symptoms, age: p.age || 0, severity: 1,
      duration: Math.min(365, Math.max(0, +b.duration || 0)), notes: String(b.notes || "").slice(0, 500) };
    const { score, level, dept, alternatives, severity } = triage(input);
    input.severity = severity;
    const guidance = await aiGuidance(input, level);
    const id = db.transaction(() => {
      const lid = db.prepare("INSERT INTO SymptomLogs (patient_id, symptoms, severity, duration_days, notes) VALUES (?,?,?,?,?)")
        .run(p.id, symptoms.join(", "), input.severity, input.duration, input.notes).lastInsertRowid;
      return db.prepare("INSERT INTO Assessments (patient_id, log_id, score, risk_level, ai_guidance, suggested_department) VALUES (?,?,?,?,?,?)")
        .run(p.id, lid, score, level, guidance, dept).lastInsertRowid;
    })();
    const types = { "Emergency": ["Emergency", "Hospital"], "Doctor Visit": ["Clinic", "Hospital"], "Home Care": ["Clinic"] }[level];
    const clinics = db.prepare(`SELECT * FROM ClinicLocations WHERE type IN (${types.map(() => "?").join(",")})`).all(...types);
    res.json({ assessmentId: id, score, level, severity, duration: input.duration, guidance, disclaimer: DISCLAIMER, suggested_department: dept, alternative_departments: alternatives, clinics });
  });

  r.get("/assessments", authRequired, roleRequired("patient", "admin"), (req, res) => {
    const base = `SELECT a.id, a.risk_level, a.score, a.suggested_department, a.created_at, l.symptoms, u.name AS patient_name
      FROM Assessments a JOIN SymptomLogs l ON l.id = a.log_id JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = p.user_id`;
    if (req.user.role === "admin") return res.json(db.prepare(base + " ORDER BY a.id DESC").all());
    const p = patientOf(req.user.id);
    res.json(db.prepare(base + " WHERE a.patient_id = ? ORDER BY a.id DESC").all(p ? p.id : -1));
  });

  r.get("/assessments/:id/pdf", authRequired, roleRequired("patient", "admin"), (req, res) => {
    const a = db.prepare(`SELECT a.*, l.symptoms, l.severity, l.duration_days, l.notes, u.name, p.age, p.gender
      FROM Assessments a JOIN SymptomLogs l ON l.id = a.log_id JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = p.user_id WHERE a.id = ?`).get(req.params.id);
    if (!a) return res.status(404).json({ error: "Assessment not found" });
    if (req.user.role === "patient") { const p = patientOf(req.user.id); if (!p || p.id !== a.patient_id) return res.status(403).json({ error: "Not authorized" }); }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=health-assessment-${a.id}.pdf`);
    const d = new PDFDocument({ margin: 50 }); d.pipe(res);
    d.fontSize(20).text("AI & Healthcare Technology", { align: "center" }).fontSize(13).text("Health Assessment Summary", { align: "center" }).moveDown();
    d.fontSize(11).text(`Assessment ID: ${a.id}     Date: ${a.created_at}`).text(`Patient: ${a.name}     Age: ${a.age || "-"}     Gender: ${a.gender || "-"}`).moveDown();
    d.font("Helvetica-Bold").text("Symptoms: ", { continued: true }).font("Helvetica").text(a.symptoms);
    d.text(`Severity (auto, 1-5): ${a.severity}     Duration: ${a.duration_days} day(s)`);
    if (a.notes) d.text("Notes: " + a.notes);
    d.moveDown().font("Helvetica-Bold").fontSize(14).text(`Risk Level: ${a.risk_level}  (score ${a.score})`).font("Helvetica").fontSize(11);
    if (a.suggested_department) d.text("Suggested department: " + a.suggested_department);
    d.moveDown(0.5).text("Guidance: " + a.ai_guidance).moveDown();
    d.font("Helvetica-Bold").text("Nearby options").font("Helvetica");
    db.prepare("SELECT * FROM ClinicLocations LIMIT 3").all().forEach((c) => d.text(`- ${c.name} (${c.speciality}), ${c.address}, ${c.phone}`));
    d.moveDown().fontSize(9).fillColor("#B00020").text("DISCLAIMER: " + DISCLAIMER);
    d.end();
  });
  return r;
};
