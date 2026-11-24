Recorded live from the Bundesagentur für Arbeit's Jobsuche API on 2026-11-24
(`GET /pc/v6/jobs?was=Softwareentwickler&wo=München&umkreis=25&angebotsart=1&veroeffentlichtseit=3&size=25`,
five of its listings kept, and `GET /pc/v4/jobdetails/<base64(refnr)>` for each; descriptions cut to
600 characters). Used by `test/job-search-jobsuche.test.ts` — the tests never reach the network.
