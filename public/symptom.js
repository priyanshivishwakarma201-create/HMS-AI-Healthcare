// symptom.js - AI Symptom Checker tab (severity is calculated by the server)
let SYM_LOADED = false;
let SYMPTOM_OPTIONS = [];
const RED_FLAGS = ["Chest pain", "Difficulty breathing", "Loss of consciousness", "Severe bleeding", "Face drooping / slurred speech"];
const SELECTED_SYMPTOMS = new Set();

function setDays(n) {
  document.getElementById("symDuration").value = n;
}

async function loadSymptomTab() {
  if (!SYM_LOADED) {
    SYMPTOM_OPTIONS = await api("/symptoms");
    const input = document.getElementById("customSymptom");
    const dataList = document.getElementById("symptomOptions");
    dataList.innerHTML = SYMPTOM_OPTIONS.map((s) => `<option value="${esc(s)}"></option>`).join("");
    renderSelectedSymptoms();
    SYM_LOADED = true;
  }

  const c = window.PROFILE && PROFILE.chief_complaint;
  document.getElementById("symBimari").innerHTML = c
    ? `<div class="banner info">📝 Your registered problem: <b>${esc(c)}</b></div>`
    : "";
  const notes = document.getElementById("symNotes");
  if (c && !notes.value) notes.value = c;
  loadAssessmentHistory();
}

function toggleSymptomInput() {
  const box = document.getElementById("symptomAddBox");
  const opening = box.style.display === "none" || !box.style.display;
  box.style.display = opening ? "flex" : "none";
  if (opening) document.getElementById("customSymptom").focus();
}

function addSymptom() {
  const input = document.getElementById("customSymptom");
  const typed = input.value.trim();
  const match = SYMPTOM_OPTIONS.find((s) => s.toLowerCase() === typed.toLowerCase());

  if (!typed) {
    document.getElementById("symMsg").innerHTML = '<p class="error-msg">Please type a symptom first.</p>';
    return;
  }
  if (!match) {
    document.getElementById("symMsg").innerHTML = '<p class="error-msg">Please choose a symptom from the suggestions.</p>';
    input.focus();
    return;
  }
  if (SELECTED_SYMPTOMS.has(match)) {
    document.getElementById("symMsg").innerHTML = '<p class="error-msg">This symptom is already added.</p>';
    return;
  }

  SELECTED_SYMPTOMS.add(match);
  document.getElementById("symMsg").innerHTML = "";
  input.value = "";
  renderSelectedSymptoms();
  input.focus();
}

function removeSymptom(symptom) {
  SELECTED_SYMPTOMS.delete(symptom);
  renderSelectedSymptoms();
}

function renderSelectedSymptoms() {
  const container = document.getElementById("selectedSymptoms");
  if (!container) return;
  container.innerHTML = [...SELECTED_SYMPTOMS].map((s) => `
    <label class="chip ${RED_FLAGS.includes(s) ? "red" : ""} selected-symptom">
      <input type="checkbox" value="${esc(s)}" checked>
      <span>${esc(s)}</span>
      <button type="button" class="remove-symptom" aria-label="Remove ${esc(s)}" title="Remove symptom" onclick='removeSymptom(${JSON.stringify(s)})'>×</button>
    </label>`).join("");
}

async function runAssessment() {
  const msg = document.getElementById("symMsg");
  msg.innerHTML = "";
  const symptoms = [...SELECTED_SYMPTOMS];

  if (!symptoms.length) {
    msg.innerHTML = '<p class="error-msg">Please add at least one symptom using the + button.</p>';
    return;
  }

  try {
    const d = await api("/assess", "POST", {
      symptoms,
      duration: document.getElementById("symDuration").value,
      notes: document.getElementById("symNotes").value
    });
    window.LAST_SYMPTOMS = symptoms.join(", ");
    const cls = d.level.replace(" ", "");
    document.getElementById("symResult").innerHTML = `
      <div class="card result ${cls}">
        <div class="result-head">
          <div><span class="risk ${cls}">${esc(d.level)}</span> <span class="muted">Risk score: ${d.score}</span></div>
          <div class="sevbox">Severity (auto): <div class="sev ${cls}">${[1,2,3,4,5].map((i) => `<span class="${i <= d.severity ? "on" : ""}"></span>`).join("")}</div><b>${d.severity}/5</b></div>
        </div>
        <p class="muted" style="margin-top:12px">Based on: ${esc(symptoms.join(", "))} • ${d.duration} day(s)</p>
        <p style="font-size:16px">${esc(d.guidance)}</p>
        ${d.suggested_department ? `<p><strong>Suggested department:</strong> ${esc(d.suggested_department)}</p>` : ""}
        <button class="btn small" onclick='bookSuggested(${JSON.stringify(d.suggested_department || "")}, ${JSON.stringify(d.alternative_departments || [])})'>📅 Book appointment (${esc(d.suggested_department || "choose dept")})</button>
        <button class="btn small secondary" onclick="downloadPdf(${d.assessmentId})">📄 Download PDF</button>
        <h4 style="margin-top:20px">Nearby clinics &amp; hospitals</h4>
        ${d.clinics.map((c) => `<div class="clinic-row"><strong>${esc(c.name)}</strong> — ${esc(c.speciality)}<br><span class="muted">${esc(c.address)} • ${esc(c.phone)}</span></div>`).join("") || '<p class="muted">No clinics found.</p>'}
        <p class="disclaimer">⚠ ${esc(d.disclaimer)}</p>
      </div>`;
    document.getElementById("symResult").scrollIntoView({ behavior: "smooth" });
    loadAssessmentHistory();
  } catch (err) {
    msg.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`;
  }
}

async function bookSuggested(dept, alternatives) {
  showPatientTab("book");
  const reason = document.getElementById("bookReason");
  if (window.LAST_SYMPTOMS) reason.value = "Symptoms: " + window.LAST_SYMPTOMS;
  await autoPrefillBooking(dept, alternatives || []);
}

async function downloadPdf(id) {
  const res = await fetch(`${API}/assessments/${id}/pdf`, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!res.ok) { alert("Could not download PDF"); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `health-assessment-${id}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadAssessmentHistory() {
  try {
    const rows = await api("/assessments");
    document.getElementById("symHistory").querySelector("tbody").innerHTML = rows.map((a) => `
      <tr><td>${esc(a.created_at)}</td><td>${esc(a.symptoms)}</td>
      <td><span class="risk ${a.risk_level.replace(" ", "")}" style="font-size:12px;padding:3px 12px">${esc(a.risk_level)}</span></td>
      <td><button class="btn small secondary" onclick="downloadPdf(${a.id})">PDF</button></td></tr>`).join("")
      || '<tr><td colspan="4" class="muted">No assessments yet.</td></tr>';
  } catch (err) {
    // History can be unavailable during login/profile setup; keep the symptom form usable.
  }
}
