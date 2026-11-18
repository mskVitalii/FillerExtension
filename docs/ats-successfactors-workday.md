# Workday and SAP SuccessFactors: what Filler supports, what's blocked, what the agent needs

Status as of 2026-11-18 (branch `claude/ats-successfactors-workday-d2c4d0`).
Code: `extension/src/features/autofill/ats/` (`workday.ts`, `successfactors.ts`, registry
`index.ts`, interface `types.ts`). Tests: `extension/test/ats/` (fixtures described in
`extension/test/ats/README.md`).

## What was studied

- **Workday**: Deutsche Bank's public tenant (`db.wd3.myworkdayjobs.com`, `DBWebsite`).
  Its "Apply Manually" goes straight to step 1 "My Information" **without an account**;
  that page's DOM was captured (fixture `workday/my-information.html`). Dropdowns were
  opened to read their real option lists and how they render (popup `ul[role=listbox]`,
  `aria-controls`, `li[role=option][data-value]`, synthetic clicks work). Pressing "Next"
  was not done, so steps 2–5 are synthetic.
- **SuccessFactors**: SAP's own tenant (`career5.successfactors.eu/career?company=SAP`).
  The Sign In and Create an Account pages are public and were captured. Everything after
  sign-in (the application form) needs an account and is synthetic. `jobs.sap.com` (the
  career-site front end) sits behind a Cloudflare challenge; not bypassed.

## Supported now (autofill engine, extension and agent alike)

Workday
- My Information: salutation (localized, "Ms" → "Frau"), given/family name, street, postal
  code, city, country (listbox, localized), email, phone number (national, since the
  country code is its own field), Phone Device Type → "Mobile", Country Phone Code
  prompt → the profile's country. Dropdowns are picked, never typed; the hidden value
  inputs beside them are never touched. Optional name parts, extension, "preferred name",
  SMS opt-in are left alone.
- Questions: Workday dropdowns are offered with their real option list, split date
  widgets (day/month/year spin buttons) are one question with `dateKind`, search prompts
  are answered by search + click. Answers go through the matching widget.
- Consent checkboxes are found although Workday has no `<form>`.
- Files: the CV goes into "Resume/CV"; a cover letter goes into its own slot, or into
  "Resume/CV" only when that uploader accepts several files — never replacing the CV.
- Create Account: email, and one generated password in Password + Verify (the agent must
  not press "Create Account" on its own, see below). Sign In: the password is never filled.
- My Experience: `fillWorkdayExperience(history)` fills work experience (title, company,
  location, "I currently work here", from/to month+year, description), education
  (school, degree from a localized list, field of study prompt, grade, years) and websites,
  pressing "Add" for each missing entry and never overwriting filled entries. The history
  comes from `extractCvHistory(cvText)` (`features/openai/extract-cv-history.ts`, support
  model, low effort). **Not wired into the Side Panel yet** — callable from the agent.
- Step model: `atsStep()` → posting / start / login / register / form / review / submitted,
  with step name, "n of m", next/back buttons, `nextIsSubmit`, and validation errors.

SuccessFactors
- Create an Account: email + retype email, first/last name, country `<select>`, generated
  password into Choose + Retype Password. "Hear more about career opportunities" and
  "job posting notifications" count as newsletters.
- Password fields are never a profile field or AI question, also after "Show" turns them
  into `type="text"` (generic fix, see below).
- Classic application page: salutation ("Mr."/"Ms."), contact data, country select, salary
  expectation, date questions written in the field's own pattern (`dd.MM.yyyy` → `15.01.2027`),
  attachments routed by their row label (Resume / Cover Letter).
- SAPUI5 flow: `sap.m.Input`, `sap.m.Select` and `sap.m.ComboBox` (picked from their popover,
  localized: "Frau", "Deutschland"), `sap.m.DatePicker`, `sap.m.CheckBox` (the real
  control, not its hidden mirror input), `FileUploader` slots (Lebenslauf / Anschreiben),
  wizard step model (current step, Weiter/Zurück, submit on the last step).

Generic engine fixes (made because the cause was generic, each with a test)
- A label that is a question ("…Arbeitserlaubnis für Deutschland?") is not a field name:
  `field-detector.ts` no longer reads it as `country` (`land\b`).
- A password box revealed as `type="text"` is never filled from the profile
  (`password-fields.ts#isRevealedPasswordField`).
- A `<button aria-haspopup="listbox">` only takes a value by picking an option, never typing
  (`combobox.ts#isFlyoutOnly`).
- A create-password pair is recognized without a `<form>` element.
- "Select one" / "Bitte wählen" on a listbox button reads as empty for question filling.

## Fundamentally blocked (no code can or should do these unattended)

- **Account creation.** Both ATS require an account per employer tenant for most postings
  (Workday: per tenant; SF: per company instance). Creating one is the user's decision and
  ties their email to that employer's system. The engine can pre-fill the form; pressing
  "Create Account" needs the user's go-ahead.
- **Email verification.** Workday tenants often require clicking an emailed link before
  the first sign-in; SF may send a one-time code (`#otpContainer` on the registration page).
  Needs access to the user's mailbox, i.e. the user.
- **Accepting terms / data-privacy statements.** SF's registration opens a privacy dialog
  that must be read and acknowledged (`#fbclc_dpcsId` is set by it); Workday has a terms
  checkbox on Create Account and on the last steps. These are consents: decided per tenant
  by the user (or by an explicit standing rule the user wrote).
- **CAPTCHA / bot detection.** `jobs.sap.com` serves a Cloudflare challenge; some Workday
  tenants add reCAPTCHA to Create Account. Never bypassed.
- **Submitting.** The final "Submit" (Workday Review) / "Apply" (SF) is never pressed
  without the user.

## What the agent (`~/Projects/FillerAgent`) needs for these two ATS

1. **One dedicated Chrome profile per user, persisted.** Workday and SF sessions are cookies
   per tenant host (`<tenant>.wd3.myworkdayjobs.com`, `career5.successfactors.eu`). Keep the
   Playwright `userDataDir` between runs so a login done once stays valid as long as the
   tenant allows (session length is tenant configuration; not measured here).
2. **Account/login state per tenant.** Store, per tenant host (+ SF `company=` parameter),
   whether an account exists and which email it uses. Workday tenant = subdomain + site
   (`db.wd3.myworkdayjobs.com/DBWebsite`); SF tenant = host + `company`.
3. **Gate handling via `atsStep()`.** Before the LLM loop, call `atsStep(document)` (import
   `@/features/autofill/ats` in the page bundle):
   - `posting` → press `next` (Apply); `start` → press `next` ("Apply Manually"), or
     "Autofill with Resume" if the agent uploads the CV there instead.
   - `login` → if the user's session cookie is gone, **pause the job** and notify the user
     to sign in once in the dedicated profile; do not type passwords.
   - `register` → **pause**, notify the user ("this employer needs an account on Workday/SF"),
     offer the pre-filled form; never press Create Account unattended.
   - `consent` (SF privacy dialog) → pause unless the user set a standing rule.
   - `form` → run `autofill(profile)`, then `fillWorkdayExperience(history)` on Workday's
     "My Experience", then questions, checkboxes, files; then press `next` if `errors` is empty.
   - `review` (`nextIsSubmit: true`) → stop and ask the user, as today.
   - `submitted` → mark applied.
4. **Resume after the user logs in once.** Keep the job URL and the step reached; when the user
   says they signed in (or a periodic check sees `atsStep().kind` is no longer `login`/`register`),
   re-open the job URL (signed-in Workday users may get their saved draft back; not verified here)
   and continue from the current step. Re-run the profile pass; it never overwrites filled fields
   in the repeaters and the refill guard handles re-renders.
5. **Step navigation.** Workday re-renders the whole step after "Next"/"Save and Continue": wait for
   `[data-automation-id="progressBarActiveStep"]` to change (or the step name) instead of a fixed
   delay. Validation errors come back in `atsStep().errors`; feed them to the LLM loop. SF UI5:
   wait for the wizard's `aria-current` step to move. SF classic is one page.
6. **CV history once per CV.** Call `extractCvHistory(cv.text)` once per CV and cache it with the
   CV (agent context store), then pass it to `fillWorkdayExperience`.
7. **File uploads.** Workday's Resume/CV accepts several files; upload the CV first, then the cover
   letter. After an upload Workday parses the CV and may pre-fill My Experience — fill experience
   *after* the upload so the parse doesn't overwrite it (filled entries are left alone).
8. **Email verification / OTP.** If a verification step appears after registration (the user did it),
   pause and tell the user to click the link; resume as in 4.
9. **Rate and identity.** Many applications to the same tenant from one account are visible to that
   employer's recruiters; keep the per-employer volume in check (one application per posting).
10. **Wire `extractCvHistory`/`fillWorkdayExperience` into the extension's Side Panel** (not done: needs
    a message type and a cached history per CV) — a follow-up for the extension, not the agent.

## Known gaps

- Two-word labels ("Eintrittsdatum", "Kündigungsfrist") aren't question-shaped, so the generic question
  scan skips them; the agent's LLM loop sees them in its snapshot.
- Workday hierarchical dropdowns ("Job Board" → submenu of boards) are only answered at the first level.
- UI5 radio groups (`div[role=radio]`) are not handled by the picker's radio-group code.
- Workday tenant-specific "Voluntary Disclosures" (US-style) and "Self Identify" pages: handled as
  generic questions only.
- Synthetic fixtures need re-capture from a real signed-in session.
