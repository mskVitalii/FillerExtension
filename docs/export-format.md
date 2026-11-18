# Filler export format (`filler-export`, version 1)

Settings → **Your Data** → **Export all data (.zip)** downloads `filler-export-YYYY-MM-DD.zip`
(local date). It holds everything the extension knows about the user, so another program (the
local application agent) can import it without talking to Google Drive. Built by
`extension/src/features/export/data-export.ts`; `extension/test/data-export.test.ts` pins the layout.

**Never in the zip:** the OpenAI API key, Tavily/Adzuna keys, Google OAuth tokens.

## Stability rules

- `manifest.json` → `format` is always `"filler-export"`. `version` is an integer.
- Adding a file, a field or a `kind` is **not** a version bump. Importers must ignore what they
  don't know.
- Renaming/removing a path or field, or changing a field's meaning, bumps `version`.
- All JSON is UTF-8, pretty-printed. All text files are UTF-8. Timestamps are ISO 8601 (UTC,
  e.g. `2026-11-17T10:00:00.000Z`); `activation-log.json` dates are local `YYYY-MM-DD`.
- Paths inside the zip use `/`, never start with `/`. Find files through `manifest.json` and
  the `*index.json` files, not by guessing names — a CV's original file keeps its own name.

## Layout

```
manifest.json
profile.json
custom-fields.json
language-levels.json
faq.json
preferences.json
activation-log.json
rules/index.json
rules/cover-letter.md            (only if set)
rules/outreach.md                (only if set)
legends/index.json
legends/<legendId>.md
cvs/index.json
cvs/<cvId>/<original file name>  (.pdf / .docx / .zip / .tex)
cvs/<cvId>/compiled.pdf          (LaTeX CVs only)
cvs/<cvId>/text.txt
cv-templates.json
applications/index.json
applications/<applicationId>/application.json
applications/<applicationId>/job-posting.md
applications/<applicationId>/cover-letter.txt           (only if a letter exists)
applications/<applicationId>/cover-letter.<lang>.txt    (translation, if any; <lang> = ISO 639-1)
applications/<applicationId>/adapted-cv.pdf             (only if one was made)
```

## `manifest.json`

```jsonc
{
  "format": "filler-export",
  "version": 1,
  "exportedAt": "2026-11-17T11:00:00.000Z",
  "extensionVersion": "1.1.6",          // null if unknown
  "counts": { "cvs": 2, "legends": 1, "applications": 312 },
  "warnings": ["Application ab12 adapted CV: Drive read failed: 500"],  // items that couldn't be read
  "files": [
    { "path": "profile.json", "kind": "profile", "contentType": "application/json", "bytes": 512 }
    // … every file except manifest.json, sorted by path
  ]
}
```

`kind` is one of: `profile`, `custom-fields`, `language-levels`, `faq`, `preferences`,
`rules-index`, `rules`, `legends-index`, `legend`, `cvs-index`, `cv-original`, `cv-compiled-pdf`,
`cv-text`, `cv-templates`, `applications-index`, `application`, `job-posting`, `cover-letter`,
`cover-letter-translation`, `adapted-cv`, `activation-log`.

A non-empty `warnings` means the export is partial (e.g. Google Drive not connected → no
applications, no CV files). The files listed are still valid.

## Documents

| File | Shape |
| --- | --- |
| `profile.json` | `Profile` (`extension/src/types/profile.ts`): `salutation, pronouns, firstName, lastName, fullName, email, phone, address, city, postalCode, country, linkedin, github, website, expectedSalary` — all strings, `""` when unset. `phone` is stored as `+<country><number>`. |
| `custom-fields.json` | `[{ id, label, value }]` — extra label/value pairs the user drags onto forms. |
| `language-levels.json` | `[{ language: "German", level: "B2" }]` — CEFR `A1`…`C2`, or `Native`. |
| `faq.json` | `[{ id?, question, answer }]` — pre-written answers to recurring application questions. `id` only on user-added questions. |
| `preferences.json` | UI/model preferences (`Preferences` in `features/storage/sync.ts`). No secrets. |
| `activation-log.json` | `[{ url, date }]` — every job URL the user worked on, first-seen local date. |

### `rules/index.json`

```jsonc
{
  "coverLetter": { "file": "rules/cover-letter.md", "sourceFileName": "x_gen_rules.md", "updatedAt": "…" },
  "outreach": null            // not set
}
```

The `.md` files are the rules verbatim — instructions for *how* to write the cover letter /
the recruiter outreach message. `sourceFileName` is the file the user uploaded them from, or null.

### `legends/index.json`

```jsonc
{ "activeId": "uuid", "items": [{ "id": "uuid", "name": "Main", "uploadedAt": "…", "isActive": true, "file": "legends/uuid.md" }] }
```

A Personal Legend is the user's free-text background (experience, projects, motivation) used as
ground truth for generated text. Use the active one unless the import needs all.

### `cvs/index.json`

```jsonc
{
  "activeId": "uuid",
  "items": [
    {
      "id": "uuid",
      "name": "German backend CV",     // display name (falls back to fileName)
      "fileName": "Lebenslauf.pdf",
      "mimeType": "application/pdf",
      "format": "pdf",                 // "pdf" | "docx" | "latex"
      "language": "de",                // ISO 639-1 or null
      "isDefault": true,               // default CV for postings in `language`
      "description": "Backend roles, Go/Kotlin",   // user's rules: which postings this CV is for ("" if none)
      "isActive": false,
      "uploadedAt": "…",
      "file": "cvs/uuid/Lebenslauf.pdf",           // null if it couldn't be read
      "compiledPdf": null,                         // LaTeX only: the compiled PDF
      "text": "cvs/uuid/text.txt"                  // plain text extracted from the CV
    }
  ]
}
```

Picking a CV for a posting (what the extension does): the CVs whose `language` matches the
posting's language; among them the one whose `description` best matches the posting; else the
one with `isDefault`; with none in that language, the English default.

A CV may contain `{{placeholder}}` markers (LaTeX: `\{\{name\}\}`) that are filled per posting.

### `cv-templates.json`

Placeholder definitions per CV, keyed by CV `id`:

```jsonc
{
  "uuid": {
    "format": "pdf",
    "content": "…",                   // may be stale; the CV text is authoritative
    "variables": [
      { "name": "city", "description": "City of the posting", "options": ["Berlin", "Munich"], "mode": "free" }
    ],                                // mode "choice": value must be one of options; "free": options are examples
    "updatedAt": "…"
  }
}
```

### `applications/index.json`

Newest first:

```jsonc
[
  {
    "id": "ab12…",                    // stable id derived from the posting URL
    "company": "Acme",
    "position": "Backend Engineer",
    "url": "https://…",
    "status": "applied",              // "draft" | "applied" | "interview" | "rejected" | "offer"
    "createdAt": "…",
    "updatedAt": "…",
    "timing": null,                   // or { startedAt, submittedAt, durationMs }, see below
    "files": {
      "application": "applications/ab12…/application.json",
      "jobPosting": "applications/ab12…/job-posting.md",       // null if unreadable
      "coverLetter": "applications/ab12…/cover-letter.txt",   // null if none
      "translations": [{ "language": "German", "path": "applications/ab12…/cover-letter.de.txt" }],
      "adaptedCv": "applications/ab12…/adapted-cv.pdf"         // null if none
    }
  }
]
```

`application.json` is the full stored record (`Application` in `extension/src/types/application.ts`):
the structured `job` (`company, position, location, description, requirements[],
responsibilities[], salary, techStack[], contact, url`), the cover letter text, `adaptedCv` (which
CV and which placeholder `values` it was filled with), and `timing` when present (see below).

`job-posting.md` is the posting as it was when the application was saved, as Markdown.
Cover letters are plain text, paragraphs separated by a blank line.

### Application timing (`application.json` → `timing`, optional)

```jsonc
{ "startedAt": "2026-11-17T09:00:00.000Z", "submittedAt": "2026-11-17T09:12:30.000Z", "durationMs": 750000 }
```

`startedAt` — the extension first read this posting; `submittedAt` — the user marked it applied.
Absent on applications never marked applied, or marked before this was recorded.

## Sync with the local agent

While the extension is paired with the local agent (FillerAgent, Side Panel → "Connect local AI
agent"), `features/agent-bridge/sync.ts` sends it this same zip automatically — when the panel
finds the agent online, a few seconds after the user's data changes, and right before "Apply via
AI agent". It calls `buildExport(now, { applications })` with `"none"` (or `"records"`, at most
every 6 h: `application.json` + index, no postings/adapted CVs) and uploads only when
`contentHash` — SHA-256 over every file except `manifest.json` and `applications/` — differs
from the hash the agent reports at `GET /api/sync`. An export whose CV files couldn't be read
(Drive not connected) is not sent.
