# Projects

One person can keep several **projects**, each a full set of what the first-run setup collects:
profile, CVs, Personal Legend, FAQ answers, custom fields, generation and outreach rules, and
"what I don't want" in job search. The API keys, the Google connection, the UI language and the
Settings are shared by all projects. The picker sits in the Side Panel header, next to "Filler".

The full design lives in FillerAgent's `docs/projects.md`. The extension's side, in short:

- **Rules** (pure, shared with the agent): `src/features/projects/registry.ts`.
- **Scope**: `src/features/projects/scope.ts`. `currentProjectId()` reads `activeProjectId`
  from `chrome.storage.local`, or the agent's resolver.
- **Storage**: `getLocal`, `setLocal` and `removeLocal` map the keys in `PROJECT_STORAGE_KEYS`.
  The Default project keeps the old key names. Other projects use `p:<id>:<key>`.
- **Drive**: the client maps file names. Default's files stay at the root. Other projects use
  `projects/<id>/<name>`. `applications/`, `jobPosting/`, `adaptedCv/` and `projects.json` are
  shared.
- **Sync preferences**: Default keeps `preferences`. Other projects keep their own
  `jobSearchNegativePrompt` under `projectPrefs:<id>`.
- **Registry**: `src/features/projects/store.ts` handles listing, creating, renaming, deleting
  (with tombstones) and `refreshProjects`, which merges with Drive `projects.json`.
- **Applications**: they carry `projectId` (none means Default) and keep it when saved from
  another project. The Applications list shows the active project's, and has an "All projects"
  toggle.

Migration is a no-op: what existed before projects *is* the Default project, read where it always
was. A browser that hasn't updated keeps working on Default. Tests are in
`extension/test/projects.test.ts`.

Runs stay in their project (`scope.ts`):

- **Side Panel**: keeps the project it opened in.
- **Requests**: `sendMessage` stamps it on each one, and `routeMessage` runs the
  project-touching ones in `runInProject`. A cover letter still streaming when the user switches
  keeps reading and writing its own project.
- **Another project's runs**: they wait for it.
- **Resume**: `CoverLetterRun.projectId` keeps a finished letter from being resumed by another
  project's panel.

Tests: `extension/test/projects-pin.test.ts`.
