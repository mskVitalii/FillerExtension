# Real ATS form snapshots

Rendered DOM of public application forms, taken 2026-11-18 with Playwright (headless Chromium,
`de-DE`) and sanitized: no scripts, styles, images, iframes, inline handlers or tracking
attributes; `<input type="hidden">` dropped (tokens); session ids (`sid=`, `apply_id=`, Textkernel
tokens) replaced by `REDACTED`. Elements the page didn't render were removed, except form controls
and option lists (the native `<select>` behind a jQuery UI selectmenu, a file input behind a
button), whose topmost hidden box is marked `data-fx-hidden` — `test/setup.ts` keeps those
invisible. Nothing was submitted and no account was created.

| ATS | File | Source |
| --- | --- | --- |
| d.vinci | `dvinci/heo-senior-director-it.html` | heo-jobs.dvinci-hr.com/de/jobs/20353/form |
| d.vinci | `dvinci/msg-services-aws-architect.html` | msgservices.dvinci-hr.com/de/jobs/111/form |
| d.vinci | `dvinci/noventi-produktmanager.html` | noventi-karriere.dvinci-hr.com/de/p/vorschau/jobs/21142/form |
| rexx | `rexx/horiba-inhouse-sales.html` | horiba-portal.rexx-recruitment.com/Inhouse-Sales-Specialist-mwd-de-f977.html |
| rexx | `rexx/ifa-depotverwaltung.html` | ifa-portal.rexx-recruitment.com/Depotverwaltung-mwd-in-Teilzeit-50--de-f1332.html |
| rexx | `rexx/nobix-bilanzbuchhalter.html` | nobix-portal.rexx-systems.com/Bilanzbuchhalter-mwd-bei-der-NOBIX-Group-GmbH-de-f266.html |
| rexx | `rexx/rexx-systems-junior-sales.html` | www.rexx-systems.com/jobs/Junior-Sales-Manager-mwd-de-f255.html |
| Umantis | `umantis/recruitingapp-5608.html` | recruitingapp-5608.de.umantis.com/Vacancies/240/Application/New/1 |
| Umantis | `umantis/yamaha-music.html` | recruitingapp-5230.de.umantis.com/Vacancies/711/Application/New/1 |
| concludis | `concludis/amazone-ausbildung.html` | amazone.concludis.de/candidate/formapply?prj=12240 |
| concludis | `concludis/cellitinnen-pflegefachkraft.html` | cellitinnenhaeuser.concludis.de/candidate/formapply?prj=38643 |
| concludis | `concludis/cellitinnen-stv-leitung.html` | cellitinnenhaeuser.concludis.de/candidate/formapply?prj=40316 |

Not captured: SmartRecruiters' one-click form (`jobs.smartrecruiters.com/oneclick-ui/…`, where
Delivery Hero's `careers.deliveryhero.com/Workflow?…` redirects) answers an automated browser with
a DataDome captcha, which isn't bypassed.

The expected fill of each form is in `specs.ts`; `fill-rate.test.ts` scores it.
