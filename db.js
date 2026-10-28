// db.js
// Database setup for Hospital Management System
// Uses SQLite (file-based, no separate DB server needed)

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const db = new Database(path.join(__dirname, "hospital.db"));
db.pragma("foreign_keys = ON");

// ---------- SCHEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','doctor','patient')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  department_id INTEGER NOT NULL,
  specialization TEXT,
  experience INTEGER DEFAULT 0,
  fee INTEGER DEFAULT 300,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  age INTEGER,
  gender TEXT,
  contact TEXT,
  address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  appt_date TEXT NOT NULL,
  appt_time TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Confirmed','Completed','Cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL UNIQUE,
  medicines TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

-- AI Symptom Checker tables
CREATE TABLE IF NOT EXISTS SymptomLogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  symptoms TEXT NOT NULL,
  severity INTEGER,
  duration_days INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  log_id INTEGER NOT NULL,
  score INTEGER,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('Emergency','Doctor Visit','Home Care')),
  ai_guidance TEXT,
  suggested_department TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (log_id) REFERENCES SymptomLogs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ClinicLocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, type TEXT, speciality TEXT, address TEXT, phone TEXT, city TEXT
);
`);

// ---------- MIGRATION: replace legacy demo @gmail.com addresses ----------
db.prepare("UPDATE users SET email = lower(replace(email, '@gmail.com', '@gmail.com')) WHERE lower(email) LIKE '%@gmail.com'").run();

// ---------- CLINIC DIRECTORY SEED (SAMPLE DATA - replace with real Indore clinics) ----------
if (db.prepare("SELECT COUNT(*) c FROM ClinicLocations").get().c === 0) {
  const insClinic = db.prepare("INSERT INTO ClinicLocations (name,type,speciality,address,phone,city) VALUES (?,?,?,?,?,?)");
  [["Sample City Hospital","Emergency","Trauma & Emergency","Vijay Nagar, Indore","0731-0000001","Indore"],
   ["Sample Care Multispeciality","Hospital","General Medicine","Palasia, Indore","0731-0000002","Indore"],
   ["Sample Family Clinic","Clinic","General Physician","Rajwada, Indore","0731-0000003","Indore"],
   ["Sample Child & Women Clinic","Clinic","Paediatrics / Gynaecology","Bhawarkua, Indore","0731-0000004","Indore"],
   ["Sample Wellness Centre","Clinic","Home-care follow-up","Saket, Indore","0731-0000005","Indore"]]
   .forEach((c) => insClinic.run(...c));
}

// ---------- SEED DATA (only if empty) ----------
const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;

if (userCount === 0) {
  console.log("Seeding initial data...");

  const insertUser = db.prepare(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)"
  );
  const insertDept = db.prepare("INSERT INTO departments (name) VALUES (?)");
  const insertDoctor = db.prepare(
    "INSERT INTO doctors (user_id, department_id, specialization, experience, fee) VALUES (?, ?, ?, ?, ?)"
  );
  const insertPatient = db.prepare(
    "INSERT INTO patients (user_id, age, gender, contact, address) VALUES (?, ?, ?, ?, ?)"
  );

  const hash = (pwd) => bcrypt.hashSync(pwd, 8);

  // Admin
  insertUser.run("Admin User", "admin@gmail.com", hash("admin123"), "admin");

  // Departments
  const deptNames = ["Cardiology", "Neurology", "Orthopedics", "Pediatrics", "Dermatology"];
  const deptIds = deptNames.map((n) => insertDept.run(n).lastInsertRowid);

  // Sample doctors (login password same as email prefix + "123")
  const doctorsSeed = [
    { name: "Dr. Ananya Sharma", email: "ananya@gmail.com", dept: 0, spec: "Cardiologist", exp: 8, fee: 500 },
    { name: "Dr. Rohan Verma", email: "rohan@gmail.com", dept: 1, spec: "Neurologist", exp: 12, fee: 700 },
    { name: "Dr. Kavita Singh", email: "kavita@gmail.com", dept: 2, spec: "Orthopedic Surgeon", exp: 6, fee: 450 },
    { name: "Dr. Imran Khan", email: "imran@gmail.com", dept: 3, spec: "Pediatrician", exp: 5, fee: 300 },
  ];

  doctorsSeed.forEach((d) => {
    const uid = insertUser.run(d.name, d.email, hash("doctor123"), "doctor").lastInsertRowid;
    insertDoctor.run(uid, deptIds[d.dept], d.spec, d.exp, d.fee);
  });

  // Sample patient
  const puid = insertUser.run("Test Patient", "patient@gmail.com", hash("patient123"), "patient").lastInsertRowid;
  insertPatient.run(puid, 24, "Other", "9999999999", "Indore, MP");

  console.log("Seed complete.");
  console.log("Login credentials -> Admin: admin@gmail.com / admin123");
  console.log("Doctor: ananya@gmail.com / doctor123 (and others, see README)");
  console.log("Patient: patient@gmail.com / patient123");
}

// ---------- MIGRATION: extended patient registration fields ----------
{
  const have = db.prepare("PRAGMA table_info(patients)").all().map((c) => c.name);
  const add = { city: "TEXT", blood_group: "TEXT", emergency_contact: "TEXT", registration_type: "TEXT", chief_complaint: "TEXT",
    allergies: "TEXT", existing_conditions: "TEXT", profile_complete: "INTEGER DEFAULT 0", registered_at: "TEXT" };
  for (const [c, t] of Object.entries(add)) if (!have.includes(c)) db.exec(`ALTER TABLE patients ADD COLUMN ${c} ${t}`);
  // patients who already have contact details (e.g. seeded / old accounts) count as registered
  db.exec("UPDATE patients SET profile_complete = 1 WHERE profile_complete = 0 AND contact IS NOT NULL AND contact != ''");
}

// ---------- MIGRATION: doctor qualification (education) ----------
{
  const have = db.prepare("PRAGMA table_info(doctors)").all().map((c) => c.name);
  if (!have.includes("qualification")) db.exec("ALTER TABLE doctors ADD COLUMN qualification TEXT");
}

// ---------- MIGRATION: extra departments + doctors so every symptom maps to a bookable department ----------
{
  const extra = [
    ["General Medicine", "Dr. Meera Joshi", "meera@gmail.com", "General Physician", 10, 300],
    ["Gastroenterology", "Dr. Arjun Patel", "arjun@gmail.com", "Gastroenterologist", 9, 600],
    ["ENT", "Dr. Sana Qureshi", "sana@gmail.com", "ENT Specialist", 7, 400],
    ["Pulmonology", "Dr. Vikram Rao", "vikram@gmail.com", "Pulmonologist", 11, 600],
  ];
  const hash = bcrypt.hashSync("doctor123", 8);
  for (const [dept, name, email, spec, exp, fee] of extra) {
    db.prepare("INSERT OR IGNORE INTO departments (name) VALUES (?)").run(dept);
    const depId = db.prepare("SELECT id FROM departments WHERE name = ?").get(dept).id;
    if (!db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
      const uid = db.prepare("INSERT INTO users (name, email, password, role) VALUES (?,?,?,'doctor')").run(name, email, hash).lastInsertRowid;
      db.prepare("INSERT INTO doctors (user_id, department_id, specialization, experience, fee) VALUES (?,?,?,?,?)").run(uid, depId, spec, exp, fee);
    }
  }
}

{
  const quals = {
    "ananya@gmail.com": "MBBS, MD (Cardiology)", "rohan@gmail.com": "MBBS, MD, DM (Neurology)",
    "kavita@gmail.com": "MBBS, MS (Orthopaedics)", "imran@gmail.com": "MBBS, MD (Pediatrics)",
    "meera@gmail.com": "MBBS, MD (General Medicine)", "arjun@gmail.com": "MBBS, MD, DM (Gastroenterology)",
    "sana@gmail.com": "MBBS, MS (ENT)", "vikram@gmail.com": "MBBS, MD (Pulmonary Medicine)",
  };
  for (const [email, q] of Object.entries(quals))
    db.prepare("UPDATE doctors SET qualification = ? WHERE (qualification IS NULL OR qualification = '') AND user_id = (SELECT id FROM users WHERE email = ?)").run(q, email);
}

module.exports = db;
