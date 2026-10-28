# HMS + AI Symptom Checker (B.Tech CSIT Mini Project)

## Run (Windows): double-click start.bat   |  or:  npm install  then  npm start
Open http://localhost:3000

## Logins (click the Demo buttons on the login page)
Patient: patient@gmail.com / patient123 | Doctor: ananya@gmail.com / doctor123 (also rohan@, kavita@, imran@) | Admin: admin@gmail.com / admin123

## Patient flow
1. "New Patient" -> create account -> Patient Registration page (type, details, bimari)
2. Symptom Checker: choose symptoms + number of days. Severity (1-5) is calculated automatically.
3. Result: risk level, guidance, suggested department -> Book appointment / Download PDF
## Doctor flow
Appointments (with History button) and "My Patients" -> stored registration, symptom assessments, past visits & prescriptions.

Optional AI text: set OPENAI_API_KEY (CMD: set OPENAI_API_KEY=sk-...). Works offline without it.
Clinic data is SAMPLE data (db.js) - replace with real Indore clinics before the demo.
