# ATS form fixtures

One folder per applicant-tracking system. Each set of fixtures has its own loader and tests:

| ATS | Tests | Loader | Sources |
| --- | --- | --- | --- |
| Greenhouse, Lever, Ashby | `greenhouse/lever/ashby.test.ts`, `engine-fixes.test.ts` | `snapshot-harness.ts` (via `ats-suite.ts`) | below |
| softgarden, join, Personio, Recruitee | `softgarden/join/personio/recruitee.test.ts` | `helpers.ts` | each fixture's header comment |
| Workday, SuccessFactors | `workday/successfactors.test.ts`, `generic-fixes.test.ts` | `widgets.ts` | below |
| d.vinci, rexx, Umantis, concludis, SmartRecruiters | `adapters/answers/fill-rate/generic-rules.test.ts` | `load-ats-fixture.ts`, `harness.ts` | `SOURCES.md` |

The adapters themselves are in `src/features/autofill/ats/` (one `AtsAdapter` per ATS, registered
in `ats/index.ts`).

## Greenhouse, Lever, Ashby

Sanitized snapshots of real, public application forms, used by `greenhouse.test.ts`,
`lever.test.ts` and `ashby.test.ts` (shared checks in `ats-suite.ts`, widget simulators in
`snapshot-harness.ts`). Taken 2026-11-18 with `tools/snapshot.cjs`, which loads the form in Chrome, opens
each custom dropdown once to record its options (`data-fixture-options`), then strips scripts,
styles, images, tracking, cookie banners, the job description and everything hidden on the live
page. Nothing is ever submitted.

| File | Source | Language | What it covers |
| --- | --- | --- | --- |
| `greenhouse/celonis-en.html` | job-boards.greenhouse.io/celonis/jobs/8039943003 | EN | react-select questions, phone dial-code picker, CV + cover letter, demographic block ("The Best Team Wins") + its consent box |
| `greenhouse/flix-de-embed.html` | job-boards.greenhouse.io/embed/job_app?for=flix&token=8760330002 | DE | German labels, embed (`grnhse_iframe`) form, CV only, "…Arbeitserlaubnis für Deutschland?" |
| `greenhouse/n26-en-embed.html` | job-boards.greenhouse.io/embed/job_app?for=n26&token=8242571 | EN | embed form, async "Location (City)" geocoder select |
| `greenhouse/raisin-en-eu.html` | job-boards.eu.greenhouse.io/raisin/jobs/4949391101 | EN | EU instance, checkbox-group question, preferred name |
| `lever/agicap-en.html` | jobs.lever.co/agicap/fc89bc56-… | EN | location typeahead, radio card, marketing consent |
| `lever/finn-de.html` | jobs.lever.co/finn/29359507-… | DE | German cards (salary as a card question, select, radio, prose textarea) |
| `lever/sysdig-dach-en.html` | jobs.lever.co/sysdig/ab478d66-… | EN | all URL fields, cover-letter file card, "Acknowledged" boxes, US EEO selects |
| `lever/spotify-gsa-en.html` | jobs.lever.co/spotify/93b9a474-… | EN | checkbox-group card, "Demographic Survey" |
| `ashby/enpal-de.html` | jobs.ashbyhq.com/enpal/83a76458-… | DE/EN | "Number" tel field, location autocomplete, number salary, Yes/No buttons, date picker |
| `ashby/n8n-en.html` | jobs.ashbyhq.com/n8n/49e569f0-… | EN | "First and last name", relabelled location, checkbox-group questions, Diversity Survey |
| `ashby/parloa-en.html` | jobs.ashbyhq.com/parloa/b21f2595-… | EN | autocomplete single-select, Yes/No, radios, data-consent box |

The Ashby fixtures keep the "Autofill from resume" uploader, which must never receive the CV.

The applicant is always the fictional one from `test/fixtures.ts` (Ada Lovelace).

### Refreshing a snapshot

```bash
PLAYWRIGHT_CORE=~/Projects/FillerAgent/node_modules/playwright-core \
  node test/ats/tools/snapshot.cjs "<form url>" test/ats/<ats>/<name>.html "<selector that appears when the form is ready>"
```

Ready selectors: Greenhouse `#first_name`, Lever `input[name="name"]`, Ashby `#_systemfield_name`.
Postings close; when one does, replace it with another live posting rather than editing the HTML
by hand, and update the expectations in the matching `*.test.ts`.

### Fill rate

`make test` prints one `[fill-rate] <ats>/<fixture>: ok/total` line per fixture: profile fields
holding the expected value plus files in the right input, out of all expected.

## Workday and SuccessFactors

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
