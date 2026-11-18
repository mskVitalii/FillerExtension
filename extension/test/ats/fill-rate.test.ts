import { describe, expect, it } from "vitest";
import { fillRate } from "./harness";
import { SPECS } from "./specs";

/**
 * The whole Filler pass on every real-form snapshot, scored against its hand-written spec
 * (`specs.ts`): profile fields, salutation, document slots, detected questions and consent
 * checkboxes. `FILL_RATE_REPORT=1 npx vitest run test/ats/fill-rate.test.ts` prints the table.
 */
const rows: string[] = [];

for (const [ats, specs] of Object.entries(SPECS)) {
  describe(`fill rate: ${ats}`, () => {
    for (const spec of specs) {
      it(spec.file, async () => {
        const score = await fillRate(ats, spec);
        rows.push(`${ats}/${spec.file}: ${score.ok}/${score.total}, wrong ${score.wrong}${score.misses.length ? ` — ${score.misses.join("; ")}` : ""}`);
        if (process.env.FILL_RATE_REPORT) console.log(rows[rows.length - 1]);
        expect(score.misses).toEqual([]);
        expect(score.ok).toBe(score.total);
        expect(score.wrong).toBe(0);
      }, 30000);
    }
  });
}
