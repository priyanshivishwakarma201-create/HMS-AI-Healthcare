
// Show/hide password for login, registration, and doctor forms.
function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.textContent = show ? "🙈" : "👁";
  button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  button.setAttribute("aria-pressed", String(show));
}

// app.js - Frontend logic for Hospital Management System
// Talks to the backend via fetch() calls to /api/* routes

const API = "/api";
// Escape user-provided text before putting it into innerHTML (prevents XSS)
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let TOKEN = localStorage.getItem("hms_token") || null;
let CURRENT_USER = JSON.parse(localStorage.getItem("hms_user") || "null");

// Booking state (patient flow)
let selectedDeptId = null;
let selectedDoctorId = null;
let selectedSlot = null;

// ---------------------------------------------------------------
// GENERIC API HELPER
// ---------------------------------------------------------------
async function api(path, method = "GET", body = null) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // expired / invalid token -> send the user back to the login screen
    if (TOKEN && /token/i.test(data.error || "")) { logout(); throw new Error("Session expired. Please log in again."); }
    throw new Error(data.error || "Something went wrong");
  }
  return data;
}

// ---------------------------------------------------------------
// AUTH: LOGIN / REGISTER / LOGOUT
// ---------------------------------------------------------------
function showAuthTab(tab) {
  document.getElementById("loginForm").classList.toggle("hidden", tab !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", tab !== "register");
  document.getElementById("loginTabBtn").classList.toggle("active", tab === "login");
  document.getElementById("registerTabBtn").classList.toggle("active", tab === "register");
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(email.trim())) {
    errEl.textContent = "Please enter a valid Gmail address ending with @gmail.com";
    return;
  }
  try {
    const data = await api("/auth/login", "POST", { email, password });
    TOKEN = data.token;
    CURRENT_USER = data.user;
    localStorage.setItem("hms_token", TOKEN);
    localStorage.setItem("hms_user", JSON.stringify(CURRENT_USER));
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById("regName").value,
    email: document.getElementById("regEmail").value,
    password: document.getElementById("regPassword").value,
  };
  const errEl = document.getElementById("registerError");
  const okEl = document.getElementById("registerSuccess");
  errEl.textContent = "";
  okEl.textContent = "";
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(payload.email.trim())) {
    errEl.textContent = "Please enter a valid Gmail address ending with @gmail.com";
    return;
  }
  payload.email = payload.email.trim().toLowerCase();
  try {
    await api("/auth/register", "POST", payload);
    // account created -> log in automatically and go to the patient registration page
    const data = await api("/auth/login", "POST", { email: payload.email, password: payload.password });
    TOKEN = data.token; CURRENT_USER = data.user;
    localStorage.setItem("hms_token", TOKEN); localStorage.setItem("hms_user", JSON.stringify(CURRENT_USER));
    document.getElementById("registerForm").reset();
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function logout() {
  TOKEN = null;
  CURRENT_USER = null;
  localStorage.removeItem("hms_token");
  localStorage.removeItem("hms_user");
  document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.remove("hidden");
}

// ---------------------------------------------------------------
// APP ENTRY - route to correct dashboard based on role
// ---------------------------------------------------------------
function enterApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  document.getElementById("navUserName").textContent =
    CURRENT_USER.name;
  document.getElementById("navRole").textContent = CURRENT_USER.role;
  document.getElementById("navAvatar").textContent = CURRENT_USER.name.charAt(0).toUpperCase();

  document.getElementById("adminView").classList.add("hidden");
  document.getElementById("patientView").classList.add("hidden");
  document.getElementById("doctorView").classList.add("hidden");

  if (CURRENT_USER.role === "admin") {
    document.getElementById("adminView").classList.remove("hidden");
    loadAdminOverview();
    loadDepartmentsForAdmin();
    loadDoctorsForAdmin();
  } else if (CURRENT_USER.role === "patient") {
    document.getElementById("patientView").classList.remove("hidden");
    loadDepartmentsForBooking();
    loadPatientAppointments();
    initPatientFlow();
  } else if (CURRENT_USER.role === "doctor") {
    document.getElementById("doctorView").classList.remove("hidden");
    loadDoctorAppointments();
  }
}

// on page load, auto-login if token exists
window.addEventListener("DOMContentLoaded", () => {
  if (TOKEN && CURRENT_USER) enterApp();
  document.getElementById("bookDate").min = new Date().toISOString().split("T")[0];
});

// =================================================================
// ADMIN DASHBOARD
// =================================================================
function showAdminTab(tab) {
  ["overview", "doctors", "departments", "appointments"].forEach((t) => {
    document.getElementById(`admin${t === "overview" ? "Overview" : t === "doctors" ? "Doctors" : t === "departments" ? "Dept" : "Appt"}Tab`)
      .classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  if (tab === "appointments") loadAllAppointmentsAdmin();
}

async function loadAdminOverview() {
  const stats = await api("/admin/stats");
  document.getElementById("statsGrid").innerHTML = `
    <div class="stat-card"><div class="num">${stats.totalPatients}</div><div class="label">Total Patients</div></div>
    <div class="stat-card"><div class="num">${stats.totalDoctors}</div><div class="label">Total Doctors</div></div>
    <div class="stat-card"><div class="num">${stats.totalAppointments}</div><div class="label">Total Appointments</div></div>
    <div class="stat-card"><div class="num">${stats.todayAppointments}</div><div class="label">Today's Appointments</div></div>
  `;
  document.getElementById("byDeptList").innerHTML =
    stats.byDept.map((d) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>${esc(d.department)}</span><strong>${d.count}</strong></div>`).join("") ||
    '<p class="muted">No data yet.</p>';
  document.getElementById("byStatusList").innerHTML =
    stats.byStatus.map((s) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span class="badge ${s.status}">${s.status}</span><strong>${s.count}</strong></div>`).join("") ||
    '<p class="muted">No data yet.</p>';
}

async function loadDepartmentsForAdmin() {
  const depts = await api("/departments");
  document.getElementById("deptTable").querySelector("tbody").innerHTML =
    depts.map((d) => `<tr><td>${esc(d.name)}</td></tr>`).join("");
  document.getElementById("docDept").innerHTML =
    depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
}

document.getElementById("addDeptForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("deptName").value;
  const msgEl = document.getElementById("addDeptMsg");
  try {
    await api("/departments", "POST", { name });
    msgEl.innerHTML = '<p class="success-msg">Department added.</p>';
    document.getElementById("deptName").value = "";
    loadDepartmentsForAdmin();
  } catch (err) {
    msgEl.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`;
  }
});

async function loadDoctorsForAdmin() {
  const doctors = await api("/doctors");
  document.getElementById("doctorsTable").querySelector("tbody").innerHTML =
    doctors.map((d) => `
      <tr>
        <td>${esc(d.name)}</td>
        <td>${esc(d.department)}</td>
        <td>${esc(d.specialization || "-")}</td>
        <td>${esc(d.qualification || "-")}</td>
        <td>${d.experience} yrs</td>
        <td>₹${d.fee}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="muted">No doctors yet.</td></tr>`;
}

document.getElementById("addDoctorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById("docName").value,
    email: document.getElementById("docEmail").value,
    password: document.getElementById("docPassword").value,
    department_id: document.getElementById("docDept").value,
    specialization: document.getElementById("docSpec").value,
    qualification: document.getElementById("docQual").value,
    experience: document.getElementById("docExp").value,
    fee: document.getElementById("docFee").value,
  };
  const msgEl = document.getElementById("addDoctorMsg");
  try {
    await api("/doctors", "POST", payload);
    msgEl.innerHTML = '<p class="success-msg">Doctor added successfully.</p>';
    document.getElementById("addDoctorForm").reset();
    loadDoctorsForAdmin();
  } catch (err) {
    msgEl.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`;
  }
});

async function loadAllAppointmentsAdmin() {
  const appts = await api("/appointments");
  document.getElementById("adminApptTable").querySelector("tbody").innerHTML =
    appts.map((a) => `
      <tr>
        <td>${esc(a.patient_name)}</td>
        <td>${esc(a.doctor_name)}</td>
        <td>${esc(a.department)}</td>
        <td>${a.appt_date}</td>
        <td>${a.appt_time}</td>
        <td><span class="badge ${a.status}">${a.status}</span></td>
      </tr>`).join("") || `<tr><td colspan="6" class="muted">No appointments yet.</td></tr>`;
}

// =================================================================
// PATIENT DASHBOARD
// =================================================================
// showPatientTab() now lives in extras.js

async function loadDepartmentsForBooking() {
  document.getElementById("bookDate").min = isoLocal(new Date());
  const depts = await api("/departments");
  const select = document.getElementById("bookDeptSelect");
  select.innerHTML =
    `<option value="">-- Select Department --</option>` +
    depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  select.onchange = () => {
    selectedDeptId = select.value;
    selectedDoctorId = null;
    selectedSlot = null;
    document.getElementById("autoDeptBanner").innerHTML = "";
    if (selectedDeptId) loadDoctorsForBooking(selectedDeptId);
    else document.getElementById("doctorList").innerHTML = '<p class="muted">Select a department first.</p>';
    document.getElementById("slotContainer").innerHTML = '<p class="muted">Select a doctor and date first.</p>';
  };
}

async function loadDoctorsForBooking(deptId) {
  const doctors = await api(`/doctors?department_id=${deptId}`);
  const container = document.getElementById("doctorList");
  if (doctors.length === 0) {
    container.innerHTML = '<p class="muted">No doctors available in this department yet.</p>';
    return;
  }
  container.innerHTML = doctors.map((d) => `
    <div class="doctor-card" data-id="${d.id}" onclick="selectDoctor(${d.id})">
      <strong>${esc(d.name)}</strong> <span class="badge-type">${esc(d.specialization || "General")}</span><br/>
      <span>🎓 ${esc(d.qualification || "Qualification not listed")}</span><br/>
      <span class="muted">🩺 ${d.experience} yrs experience · ${esc(d.department)} · Fee: ₹${d.fee}</span>
    </div>
  `).join("");
}

function selectDoctor(id) {
  selectedDoctorId = id;
  selectedSlot = null;
  document.querySelectorAll(".doctor-card").forEach((c) => {
    c.classList.toggle("selected", Number(c.dataset.id) === id);
  });
  refreshSlots();
}

document.getElementById("bookDate").addEventListener("change", refreshSlots);

const fmtDay = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const isoLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

async function refreshSlots() {
  const container = document.getElementById("slotContainer");
  const date = document.getElementById("bookDate").value;
  selectedSlot = null;
  if (!selectedDoctorId || !date) {
    container.innerHTML = '<p class="muted">Select a doctor and date first.</p>';
    return;
  }
  const data = await api(`/doctors/${selectedDoctorId}/slots?date=${date}`);
  const free = data.slots.filter((s) => s.status === "available").length;
  const label = { booked: "Booked", past: "Passed" };
  container.innerHTML =
    `<p class="${free ? "success-msg" : "error-msg"}" style="margin:10px 0 0">${free
      ? `✅ ${free} of ${data.slots.length} time slots available on ${fmtDay(date)}`
      : `No slots available on ${fmtDay(date)}. Try another date.`}</p>` +
    `<div class="slot-grid">` +
    data.slots.map((s) => s.status === "available"
      ? `<div class="slot-btn" data-slot="${s.time}" onclick="selectSlot('${s.time}')">${s.time}</div>`
      : `<div class="slot-btn unavailable" title="${label[s.status]}">${s.time}<br><small>${label[s.status]}</small></div>`).join("") +
    `</div>`;
}

// Starting from today, move the date forward until the chosen doctor has a free slot.
async function jumpToNextAvailableDate() {
  const dateEl = document.getElementById("bookDate");
  const start = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoLocal(d);
    const data = await api(`/doctors/${selectedDoctorId}/slots?date=${iso}`);
    if (data.available.length) { dateEl.value = iso; return; }
  }
  dateEl.value = isoLocal(start);
}

// Called from the symptom result: pre-select the department, the first doctor, and the next free date.
async function autoPrefillBooking(dept, alternatives = []) {
  const dateEl = document.getElementById("bookDate");
  dateEl.min = isoLocal(new Date());
  const banner = document.getElementById("autoDeptBanner");
  const sel = document.getElementById("bookDeptSelect");
  const opt = [...sel.options].find((o) => o.text === dept);
  if (!opt) { banner.innerHTML = ""; return; }
  sel.value = opt.value;
  selectedDeptId = opt.value;
  selectedSlot = null;
  await loadDoctorsForBooking(selectedDeptId);
  banner.innerHTML = `<div class="banner ok">🤖 Based on your symptoms we selected <b>${esc(dept)}</b> for you.` +
    (alternatives.length ? ` Other possible: ${alternatives.map(esc).join(", ")} (you can change it below).` : " You can change it below.") + `</div>`;
  const first = document.querySelector(".doctor-card");
  if (first) {
    selectedDoctorId = Number(first.dataset.id);
    document.querySelectorAll(".doctor-card").forEach((c) => c.classList.toggle("selected", Number(c.dataset.id) === selectedDoctorId));
    await jumpToNextAvailableDate();
    await refreshSlots();
  }
}

function selectSlot(slot) {
  selectedSlot = slot;
  document.querySelectorAll(".slot-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.slot === slot);
  });
}

async function bookAppointment() {
  const msgEl = document.getElementById("bookMsg");
  const date = document.getElementById("bookDate").value;
  const reason = document.getElementById("bookReason").value;

  if (!selectedDoctorId || !date || !selectedSlot) {
    msgEl.innerHTML = '<p class="error-msg">Please select department, doctor, date and time slot.</p>';
    return;
  }
  try {
    await api("/appointments", "POST", {
      doctor_id: selectedDoctorId,
      appt_date: date,
      appt_time: selectedSlot,
      reason,
    });
    msgEl.innerHTML = '<p class="success-msg">Appointment booked successfully!</p>';
    selectedDoctorId = null;
    selectedSlot = null;
    document.getElementById("autoDeptBanner").innerHTML = "";
    document.getElementById("bookReason").value = "";
    setTimeout(() => showPatientTab("myappts"), 1000);
  } catch (err) {
    msgEl.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`;
  }
}

async function loadPatientAppointments() {
  const appts = await api("/appointments");
  document.getElementById("patientApptTable").querySelector("tbody").innerHTML =
    appts.map((a) => `
      <tr>
        <td>${esc(a.doctor_name)}</td>
        <td>${esc(a.department)}</td>
        <td>${a.appt_date}</td>
        <td>${a.appt_time}</td>
        <td><span class="badge ${a.status}">${a.status}</span></td>
        <td>
          <button class="btn small ghost" onclick="viewPatientHistory(${a.patient_id})">History</button>
          ${a.status === "Confirmed" || a.status === "Pending"
            ? `<button class="btn small danger" onclick="cancelAppointment(${a.id})">Cancel</button>`
            : a.status === "Completed"
            ? `<button class="btn small secondary" onclick="viewPrescription(${a.id})">View Rx</button>`
            : "-"}
        </td>
      </tr>`).join("") || `<tr><td colspan="6" class="muted">No appointments yet.</td></tr>`;
}

async function cancelAppointment(id) {
  if (!confirm("Cancel this appointment?")) return;
  try {
    await api(`/appointments/${id}/status`, "PATCH", { status: "Cancelled" });
    loadPatientAppointments();
  } catch (err) {
    alert(err.message);
  }
}

async function viewPrescription(apptId) {
  const area = document.getElementById("prescriptionArea");
  try {
    const rx = await api(`/prescriptions/${apptId}`);
    area.innerHTML = `
      <div class="card">
        <h3>Prescription</h3>
        <p><strong>Medicines:</strong> ${esc(rx.medicines)}</p>
        <p><strong>Notes:</strong> ${esc(rx.notes || "-")}</p>
      </div>`;
  } catch (err) {
    area.innerHTML = `<div class="card"><p class="muted">No prescription found for this appointment.</p></div>`;
  }
}

// =================================================================
// DOCTOR DASHBOARD
// =================================================================
async function loadDoctorAppointments() {
  const appts = await api("/appointments");
  document.getElementById("doctorApptTable").querySelector("tbody").innerHTML =
    appts.map((a) => `
      <tr>
        <td>${esc(a.patient_name)}</td>
        <td>${esc(a.age || "-")} / ${esc(a.gender || "-")}</td>
        <td>${esc(a.contact || "-")}</td>
        <td>${a.appt_date}</td>
        <td>${a.appt_time}</td>
        <td>${esc(a.reason || "-")}</td>
        <td><span class="badge ${a.status}">${a.status}</span></td>
        <td>
          ${a.status === "Confirmed"
            ? `<button class="btn small" onclick="openRxForm(${a.id})">Add Prescription</button>`
            : a.status === "Completed"
            ? `<button class="btn small secondary" onclick="openRxForm(${a.id})">Edit Prescription</button>`
            : ""}
        </td>
      </tr>`).join("") || `<tr><td colspan="8" class="muted">No appointments assigned yet.</td></tr>`;
}

async function openRxForm(apptId) {
  const area = document.getElementById("rxFormArea");
  let existing = { medicines: "", notes: "" };
  try {
    existing = await api(`/prescriptions/${apptId}`);
  } catch (e) { /* no existing prescription, that's fine */ }

  area.innerHTML = `
    <div class="card">
      <h3>Prescription for Appointment #${apptId}</h3>
      <label>Medicines (name, dosage, frequency)</label>
      <textarea id="rxMedicines">${esc(existing.medicines || "")}</textarea>
      <label>Additional Notes</label>
      <textarea id="rxNotes">${esc(existing.notes || "")}</textarea>
      <button class="btn" onclick="savePrescription(${apptId})">Save Prescription</button>
      <div id="rxMsg"></div>
    </div>`;
}

async function savePrescription(apptId) {
  const medicines = document.getElementById("rxMedicines").value;
  const notes = document.getElementById("rxNotes").value;
  const msgEl = document.getElementById("rxMsg");
  if (!medicines.trim()) {
    msgEl.innerHTML = '<p class="error-msg">Please enter medicines.</p>';
    return;
  }
  try {
    await api("/prescriptions", "POST", { appointment_id: apptId, medicines, notes });
    msgEl.innerHTML = '<p class="success-msg">Prescription saved. Appointment marked Completed.</p>';
    loadDoctorAppointments();
  } catch (err) {
    msgEl.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`;
  }
}
