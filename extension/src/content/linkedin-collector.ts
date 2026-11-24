import { bootLinkedInCollector } from "@/features/linkedin-collector/collector";

/**
 * Entry of `linkedin-collector.js` (vite.linkedin.config.ts) — the on-page "Add" buttons on
 * LinkedIn's job pages, registered dynamically only after the user switched the collector on
 * (features/linkedin-collector/registration.ts). Separate from `content-script.js`: that one is
 * injected on a click on the toolbar icon, this one by Chrome on every LinkedIn page load.
 */
bootLinkedInCollector();
