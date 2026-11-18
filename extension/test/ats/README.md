# ATS form fixtures (Greenhouse, Lever, Ashby)

Sanitized snapshots of real, public application forms, used by `greenhouse.test.ts`,
`lever.test.ts` and `ashby.test.ts` (shared checks in `ats-suite.ts`, widget simulators in
`harness.ts`). Taken 2026-11-18 with `tools/snapshot.cjs`, which loads the form in Chrome, opens
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

## Refreshing a snapshot

```bash
PLAYWRIGHT_CORE=~/Projects/FillerAgent/node_modules/playwright-core \
  node test/ats/tools/snapshot.cjs "<form url>" test/ats/<ats>/<name>.html "<selector that appears when the form is ready>"
```

Ready selectors: Greenhouse `#first_name`, Lever `input[name="name"]`, Ashby `#_systemfield_name`.
Postings close; when one does, replace it with another live posting rather than editing the HTML
by hand, and update the expectations in the matching `*.test.ts`.

## Fill rate

`make test` prints one `[fill-rate] <ats>/<fixture>: ok/total` line per fixture: profile fields
holding the expected value plus files in the right input, out of all expected.
