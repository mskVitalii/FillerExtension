# Update check and the NEW badge

Most people run Filler as an unpacked extension built from `extension.zip`, and Chrome never
updates those itself. So the extension checks GitHub Releases on its own, puts **NEW** on its
toolbar icon when a newer version is out, and the Side Panel explains how to update.

Code: `extension/src/features/updates/version.ts` (pure: semver, release selection),
`features/updates/check.ts` (fetch, storage, badge; shared by the worker and the panel),
`background/updates.ts` (alarm and lifecycle events), `components/UpdateBanner.tsx`,
`components/AboutCard.tsx` (Settings → About). Tests: `extension/test/updates-version.test.ts`.

## Which releases count

Only GitHub releases that:

- are tagged **`extension-vX.Y.Z`** (X.Y.Z is the manifest version, Chrome's 1–4 numeric parts, no suffix),
- are published (not draft, not prerelease), and
- carry an uploaded asset named **`extension.zip`**.

Among those, the highest version wins (by number, not by date or by GitHub's "Latest" label).

Why the prefix: the repo already has the releases `v4.0.0` ("CV generation", marked Latest) and
`3.2.0`. They belong to an older numbering and are both higher than the extension's current
1.1.x. A check that took "the latest release" or "any semver tag" would announce one of them
forever. They have no `extension-v` prefix and no `extension.zip`, so they're ignored. Leave
them as they are; don't delete or retag them.

## Publishing a release

From the primary checkout, on `main`, right after the usual release:

```bash
make publish                              # bump + clean release build + extension.zip
git commit -am "Release X.Y.Z: <summary>" # include extension.zip, package.json, manifest.json
make gh-release
```

`make gh-release`:

1. Refuses unless it runs on `main`, HEAD's subject is `Release X.Y.Z: …` for the version in
   `package.json`, `manifest.json` has the same version and is committed, and `extension.zip`
   exists, holds a `manifest.json` of that version, and is the copy committed in HEAD.
2. Pushes `main` to `origin`.
3. Skips if the release `extension-vX.Y.Z` already exists, so it's safe to re-run.
4. Otherwise runs `gh release create extension-vX.Y.Z extension.zip --target <HEAD>
   --title "Filler X.Y.Z" --notes "<summary from the commit subject>\n\n<how to update>" --latest`.

`--latest` moves GitHub's "Latest" label to the new release. That doesn't touch `v4.0.0` itself, and
the check ignores the label anyway.

## How the check runs

- **When:** on install/update (`onInstalled`), on browser start (`onStartup`), every 6 hours via
  the `filler-update-check` alarm (`chrome.alarms`, new `alarms` permission, which shows no
  install warning), and when the Side Panel opens. Panel-open and startup checks are throttled to
  one per 30 minutes. Settings → About → "Check for updates" always checks.
- **Request:** `GET https://api.github.com/repos/mskVitalii/FillerExtension/releases?per_page=100`
  with `cache: "no-store"` and `If-None-Match: <last ETag>`. GitHub answers with
  `Access-Control-Allow-Origin: *`, exposes `ETag`, and allows `If-None-Match` in the CORS
  preflight. That was checked with curl on 2026-11-24. So **no host permission** is needed, and
  none was added. A 304 keeps the cached result and doesn't count against the anonymous limit
  of 60 requests per hour per IP.
- **State** (all in `chrome.storage.local`; the worker keeps nothing in memory):
  - `updateCheck`: `{ checkedAt, etag, latest, error }`. `latest` is the best `extension-v`
    release seen, whether newer or not. A failed check keeps the previous `latest` and ETag and
    records `error`.
  - `updateDismissedVersion`: the version whose banner the user closed.
  - `storeUpdateVersion`: the version Chrome reported for a Web Store install.
- **Badge:** `syncUpdateBadge()` re-derives it from storage on every event. It shows `NEW` (white on
  `#2563eb`) while an update is offered and that version isn't dismissed, and clears otherwise.
  Installing the new version fires `onInstalled`, so the badge clears as soon as the installed
  version is current. Badges don't survive a browser restart, so `onStartup` re-derives it.

## What the user sees

- **Side Panel banner** (main view, under the pin hint): "Filler X.Y.Z is available, you have A.B.C",
  a **Download extension.zip** button (the asset URL), a **Release notes** link (the release
  page) and three steps: unzip, replace the files in the "Load unpacked" folder, click Reload in
  `chrome://extensions` (a button opens that page, filtered to Filler). The × hides the banner
  **and the badge** for that version. The next version shows both again.
- **Settings → About:** the installed version, the update source, the last check's result and
  time, and "Check for updates".

## Chrome Web Store installs

Chrome adds `update_url` to a Web Store install's manifest, and an unpacked build doesn't have
one. When it's present, GitHub is never queried. Instead:

- The alarm and the checks call `chrome.runtime.requestUpdateCheck()`. `"throttled"` is normal.
- `chrome.runtime.onUpdateAvailable` records the version and sets the badge.
- The banner offers **Reload to update** (`chrome.runtime.reload()`, which applies the
  update Chrome already downloaded).

A listener on `onUpdateAvailable` stops Chrome from applying the update on its own when the
worker goes idle. So the worker applies it right away (`runtime.reload()`) when no Filler page is
open (no side panel, extension tab, popup or offscreen document, per `runtime.getContexts`).
Otherwise it waits for the user's click, and the 6-hour alarm tries again once the panel is
closed. A browser restart applies it too.

## Decisions

- **Tag prefix and required asset**, instead of deleting the old releases or comparing dates.
- **No new host permission**, because GitHub's API is CORS-open. The only new permission is `alarms`.
- **Dismissing also clears the badge** for that version. Otherwise NEW would stay with no way to
  hide it short of updating. Settings → About still says an update is available.
- **Check state uses its own keys**, read through `chrome.storage.local` directly in
  `check.ts`, not through `LocalStorageSchema`. It's private to this feature, and keeping it out of the
  shared schema keeps parallel branches from conflicting.
- **Extension-only module:** `features/updates/check.ts` uses `chrome.action`/`chrome.alarms`.
  FillerAgent resolves `@/*` into this tree, so it must not import it (it doesn't).
  `version.ts` is pure and safe to share.
