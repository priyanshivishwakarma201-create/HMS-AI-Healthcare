// extras.js - patient registration flow, stepper, and doctor-side patient history
let PROFILE = null;
const PTABS = { profile: "patientProfileTab", symptom: "patientSymptomTab", book: "patientBookTab", myappts: "patientApptsTab" };

function fillDemo(email, pass) {
  showAuthTab("login");
  document.getElementById("loginEmail").value = email;
  document.getElementById("loginPassword").value = pass;
}

// ---------------- Patient flow: Registration -> Symptom Checker -> Book ----------------
async function initPatientFlow() {
  PROFILE = await api("/patient/profile");
  fillProfileForm();
  if (!PROFILE.profile_complete) {
    showPatientTab("profile");
    document.getElementById("profileBanner").innerHTML = '<div class="banner info">👋 Welcome! Please complete your registration to continue to the Symptom Checker.</div>';
  } else showPatientTab("symptom");
}

function showPatientTab(tab) {
  const locked = PROFILE && !PROFILE.profile_complete;
  if (locked && tab !== "profile") tab = "profile";
  Object.entries(PTABS).forEach(([t, id]) => document.getElementById(id).classList.toggle("hidden", t !== tab));
  document.querySelectorAll("#patientView .tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.disabled = locked && b.dataset.tab !== "profile";
  });
  renderStepper(tab);
  if (tab === "symptom") loadSymptomTab();
  if (tab === "myappts") loadPatientAppointments();
}

function renderStepper(tab) {
  const cur = tab === "profile" ? 1 : tab === "symptom" ? 2 : 3;
  const steps = ["Registration", "Symptom Check", "Book Visit"];
  document.getElementById("patientStepper").innerHTML = steps.map((s, i) =>
    `<div class="step ${i + 1 < cur ? "done" : i + 1 === cur ? "active" : ""}"><i>${i + 1 < cur ? "✓" : i + 1}</i><span>${s}</span></div>`).join("");
}

function fillProfileForm() {
  const p = PROFILE, v = (id, x) => (document.getElementById(id).value = x ?? "");
  v("pfName", p.name); v("pfAge", p.age); v("pfGender", p.gender || "Male"); v("pfMobile", p.contact); v("pfEmergency", p.emergency_contact);
  v("pfBlood", p.blood_group); v("pfAddress", p.address); v("pfCity", p.city || "Indore"); v("pfComplaint", p.chief_complaint);
  v("pfAllergies", p.allergies); v("pfConditions", p.existing_conditions);
  const r = document.querySelector(`input[name="regType"][value="${p.registration_type || "New Patient"}"]`);
  if (r) r.checked = true;
}

document.getElementById("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = (id) => document.getElementById(id).value;
  const msg = document.getElementById("profileMsg"); msg.innerHTML = "";
  try {
    await api("/patient/profile", "PUT", {
      registration_type: document.querySelector('input[name="regType"]:checked').value, name: g("pfName"), age: g("pfAge"), gender: g("pfGender"),
      contact: g("pfMobile"), emergency_contact: g("pfEmergency"), blood_group: g("pfBlood"), address: g("pfAddress"), city: g("pfCity"),
      chief_complaint: g("pfComplaint"), allergies: g("pfAllergies"), existing_conditions: g("pfConditions") });
    PROFILE = await api("/patient/profile");
    CURRENT_USER.name = PROFILE.name; localStorage.setItem("hms_user", JSON.stringify(CURRENT_USER));
    document.getElementById("navUserName").textContent = PROFILE.name;
    document.getElementById("navAvatar").textContent = PROFILE.name.charAt(0).toUpperCase();
    document.getElementById("profileBanner").innerHTML = "";
    msg.innerHTML = '<div class="banner ok">✅ Registration saved! Opening Symptom Checker…</div>';
    setTimeout(() => showPatientTab("symptom"), 900);
  } catch (err) { msg.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`; }
});

// ---------------- Doctor: My Patients + stored history ----------------
function showDoctorTab(tab) {
  document.getElementById("doctorApptsTab").classList.toggle("hidden", tab !== "appts");
  document.getElementById("doctorPatientsTab").classList.toggle("hidden", tab !== "patients");
  document.querySelectorAll("#doctorTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "patients") loadDoctorPatients();
}

async function loadDoctorPatients() {
  const rows = await api("/doctor/patients");
  document.getElementById("doctorPatientsTable").querySelector("tbody").innerHTML = rows.map((p) => `
    <tr><td><b>${esc(p.name)}</b></td><td>${esc(p.age || "-")} / ${esc(p.gender || "-")}</td><td>${esc(p.contact || "-")}</td>
    <td>${p.visits}</td><td>${esc(p.last_visit)}</td>
    <td><button class="btn small ghost" onclick="viewPatientHistory(${p.id})">View History</button></td></tr>`).join("")
    || '<tr><td colspan="6" class="muted">No patients yet.</td></tr>';
}

async function viewPatientHistory(pid) {
  const area = document.getElementById("historyArea");
  try {
    const { profile: p, assessments, visits } = await api(`/doctor/patients/${pid}/history`);
    const kv = (k, v) => `<div><span>${k}</span>${esc(v || "-")}</div>`;
    area.innerHTML = `
      <div class="card"><h3>🗂 Patient History — ${esc(p.name)}</h3>
        <div class="kv">${kv("Registration type", p.registration_type)}${kv("Age / Gender", `${p.age || "-"} / ${p.gender || "-"}`)}${kv("Mobile", p.contact)}
          ${kv("Emergency contact", p.emergency_contact)}${kv("Blood group", p.blood_group)}${kv("City", p.city)}${kv("Address", p.address)}
          ${kv("Bimari / main problem", p.chief_complaint)}${kv("Allergies", p.allergies)}${kv("Existing conditions", p.existing_conditions)}</div></div>
      <div class="card"><h3>🩺 Symptom Assessments (${assessments.length})</h3><div class="timeline">
        ${assessments.map((a) => `<div class="tl-item"><b>${esc(a.created_at)}</b> <span class="risk ${a.risk_level.replace(" ", "")}" style="font-size:12px;padding:2px 10px">${esc(a.risk_level)}</span>
          <div>${esc(a.symptoms)} • severity ${a.severity}/5 • ${a.duration_days} day(s)</div>${a.notes ? `<div class="muted">Notes: ${esc(a.notes)}</div>` : ""}</div>`).join("") || '<p class="muted">No assessments yet.</p>'}
      </div></div>
      <div class="card"><h3>📋 Past Visits &amp; Prescriptions (${visits.length})</h3>
        <table><thead><tr><th>Date</th><th>Doctor</th><th>Reason</th><th>Status</th><th>Prescription</th></tr></thead><tbody>
        ${visits.map((v) => `<tr><td>${esc(v.appt_date)} ${esc(v.appt_time)}</td><td>${esc(v.doctor_name)}<br><span class="muted">${esc(v.department)}</span></td>
          <td>${esc(v.reason || "-")}</td><td><span class="badge ${v.status}">${v.status}</span></td><td>${v.medicines ? esc(v.medicines) + (v.rx_notes ? `<br><span class="muted">${esc(v.rx_notes)}</span>` : "") : "-"}</td></tr>`).join("")}
        </tbody></table></div>`;
    area.scrollIntoView({ behavior: "smooth" });
  } catch (err) { area.innerHTML = `<div class="card"><p class="error-msg">${esc(err.message)}</p></div>`; }
}
