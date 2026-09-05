/**
 * House writing style for everything the extension generates as the
 * applicant's own words — cover letters and application-question answers.
 *
 * This is the `no-ai-slop` skill's rule set condensed into prompt form and
 * embedded directly in each system prompt; we deliberately do NOT invoke the
 * skill at runtime. `HOUSE_STYLE_RULES` is prepended to prompts that already
 * carry their own task-specific rules, so keep it terse. `stripEmDashes` is
 * the deterministic backstop for the one rule a model breaks most often.
 */

export const HOUSE_STYLE_RULES = `Write like a specific person, not an AI assistant. These rules have no exceptions:

- NEVER use an em dash ("—"), a spaced en dash ("–") or "--" as punctuation. Real people don't write that way. Use a comma, a period, parentheses, or two sentences.
- Banned words: delve, foster, leverage, utilize, facilitate, empower, streamline, robust, cutting-edge, paradigm shift, game changer, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving. Say the plain thing.
- Cut empty phrases: "it's worth noting", "at the end of the day", "when it comes to", "at its core", "in today's world", "the reality is", "in order to", "going forward".
- No "not X, it's Y" / "the question isn't X, it's Y" / "not just X but Y" contrasts. State Y directly.
- No throat-clearing openers ("Here's the thing", "Let me be clear", "I'll be honest") and no faux-insight setups ("what most people get wrong", "here's what nobody tells you").
- No importance puffery ("stands as a testament", "marks a pivotal moment", "plays a vital role", "underscores its significance"). State the fact and stop.
- No colon reveals: a noun phrase, a colon, then a dramatic lowercase clause.
- No trailing "-ing" clauses that editorialize ("highlighting the commitment to...", "underscoring its importance", "showcasing", "reflecting"). End the sentence.
- No metadiscourse that tells the reader what to notice ("this matters", "this distinction matters", "in other words", "as you can see").
- No "In conclusion" / "Ultimately" / "Overall" recap ending and no cute one-line kicker. Stop on the last concrete point.
- No emoji, no mid-sentence bold, no rhetorical questions.
- Vary sentence shape; don't stack short punchy fragments.
- Be concrete: name the technology, project, number, or outcome instead of calling it "significant", "impactful" or "exciting". Use active voice.`;

/**
 * Deterministic guarantee for the em-dash rule: strip any dash the model
 * still used as sentence punctuation and repair the spacing. Leaves
 * hyphenated words ("full-stack") and numeric ranges ("2019-2022") alone —
 * only a dash padded by spaces, or an em dash / horizontal bar anywhere, is
 * treated as punctuation.
 */
export function stripEmDashes(text: string): string {
  return (
    text
      // "word — word", "word—word", or a stray bar → comma
      .replace(/[ \t]*[—―][ \t]*/g, ", ")
      // " -- " used as an em-dash substitute
      .replace(/[ \t]+--[ \t]+/g, ", ")
      // " – " (spaced en dash) as punctuation, but not "2019 – 2022"
      .replace(/(\D)[ \t]+–[ \t]+(?=\D)/g, "$1, ")
      // tidy the seams the swaps leave behind
      .replace(/[ \t]+([,.;:!?])/g, "$1")
      .replace(/,(\s*[.;:!?])/g, "$1")
      .replace(/,[ \t]*,/g, ",")
      .replace(/^[ \t]*,[ \t]*/gm, "")
      .replace(/([([{])[ \t]*,[ \t]*/g, "$1")
      .replace(/[ \t]*,[ \t]*([)\]}])/g, "$1")
      // a dash at the very end of a line leaves a dangling comma — drop it
      .replace(/,[ \t]*$/gm, "")
      .replace(/[ \t]+$/gm, "")
  );
}
