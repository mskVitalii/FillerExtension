# ATS fixtures

Pages from specific applicant-tracking systems, loaded into jsdom by `widgets.ts`
(`loadAtsFixture`), which also replays the vendor widgets' behaviour (dropdown popups,
search prompts, "Add" buttons, UI5 controls) since a parsed fixture runs no scripts.
Each file's header says whether it was **captured** from a live public page or is
**synthetic**, and what it was built from. Attributes named `data-fixture-*` exist only
for the simulator.

Applicant data is always the fictional one from `test/fixtures.ts`.

| File | Kind | Source |
|---|---|---|
| `workday/my-information.html` | captured | Public German Workday tenant, "Apply Manually" step 1 (no sign-in needed there), 2026-11-18 |
| `workday/my-experience.html` | synthetic | Step 2, behind "Next" (not pressed); same markup conventions + Workday automation ids |
| `workday/application-questions.html` | synthetic | Steps 3–4 questionnaire, German tenant |
| `workday/sign-in.html` | synthetic | Start dialog, Create Account, Sign In, posting, Review |
| `successfactors/create-account.html` | captured | `career5.successfactors.eu/career?company=SAP` → Create an account, 2026-11-18 |
| `successfactors/sign-in.html` | captured | same tenant, Sign In |
| `successfactors/apply-classic.html` | synthetic | Classic JSP application page (behind sign-in) |
| `successfactors/apply-ui5.html` | synthetic | SAPUI5 apply wizard (behind sign-in), German locale |

What was *not* reachable without an account: every SuccessFactors application page, and
Workday steps 2–5 (they are behind "Next", which wasn't pressed). The synthetic pages
follow SAP/Workday's documented control markup; re-capture them from a real session
(the user's own dedicated Chrome profile, the agent's run) when one is available, and
keep the `data-fixture-*` attributes.
