// Usage: PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node test/ats/tools/snapshot.cjs <url> <out.html> <readySelector>
// (playwright-core is not a dependency of the extension; point PLAYWRIGHT_CORE at any install, e.g. the FillerAgent one.)
// Never submits anything: it only loads the form and opens dropdowns to read their options.
// Opens an ATS application form, harvests hidden option lists of custom dropdowns
// (react-select / Ashby comboboxes) into data-fixture-options, strips scripts/tracking,
// drops controls invisible on the live page, and writes the sanitized form HTML.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const fs = require("fs");

const [url, out, ready] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 2000 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(ready, { timeout: 45000 });
  await page.waitForTimeout(2500);
  // Cookie banners: decline / close if trivially present (never accept).
  for (const sel of ['button:has-text("Decline")', 'button:has-text("Reject")', 'button:has-text("Ablehnen")']) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }

  // Harvest option lists of custom dropdowns (react-select on Greenhouse, comboboxes on Ashby).
  // Opening a menu is harmless (no submit). Options are read only from the listbox that input controls.
  const combos = await page.$$('input[role="combobox"]');
  for (const c of combos) {
    try {
      await c.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await c.focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(600);
      const n = await c.evaluate((input) => {
        const id = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
        let list = id ? document.getElementById(id) : null;
        if (!list) list = input.closest(".select__container")?.querySelector('[role="listbox"]') || null;
        if (!list) return 0;
        const opts = [...list.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim());
        if (opts.length) input.setAttribute("data-fixture-options", JSON.stringify(opts.slice(0, 300)));
        return opts.length;
      });
      console.error("combo", await c.getAttribute("id"), n);
      await page.keyboard.press("Escape");
      await c.evaluate((el) => el.blur());
      await page.waitForTimeout(200);
    } catch (e) {
      console.error("combo harvest failed", e.message.split("\n")[0]);
    }
  }

  const html = await page.evaluate(() => {
    const isVisible = (el) => {
      if (el.type === "file" || el.type === "hidden") return true;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      // Visually-hidden but real (radio/checkbox styled via label) still count when they take part in layout
      return el.offsetParent !== null || cs.position === "fixed" || r.width > 0 || r.height > 0;
    };
    // Mark invisible controls before cloning.
    document.querySelectorAll("input, textarea, select, [role=combobox], [role=checkbox], [role=radio]").forEach((el) => {
      if (!isVisible(el)) el.setAttribute("data-fixture-drop", "1");
    });
    // Whole subtrees hidden on the live page (closed dropdown lists, collapsed widgets) — jsdom can't
    // tell they're hidden, so drop them unless they hold a file input (often display:none but real).
    document.querySelectorAll("body *").forEach((el) => {
      const cs = getComputedStyle(el);
      if ((cs.display === "none" || cs.visibility === "hidden") && !el.matches('input[type="file"], input[type="hidden"]') && !el.querySelector('input[type="file"]')) {
        el.setAttribute("data-fixture-drop", "1");
      }
    });
    const root = document.body.cloneNode(true);
    root.querySelectorAll(".job__description, [class*=_descriptionText]").forEach((el) => {
      el.innerHTML = "<p>[Job description removed from fixture]</p>";
    });
    root.querySelectorAll("[data-fixture-drop]").forEach((el) => el.remove());
    root.querySelectorAll("script, style, link, noscript, iframe, template, meta, img, picture, video, source, canvas").forEach((el) => el.remove());
    root.querySelectorAll("svg").forEach((el) => {
      el.replaceChildren();
    });
    root.querySelectorAll("*").forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name;
        if (n.startsWith("on") || n === "style" || n === "srcset" || n === "nonce" || n.startsWith("data-gtm") || n.startsWith("data-ga") || n === "data-reactroot") el.removeAttribute(n);
        if (n === "href" && /^javascript:/i.test(a.value)) el.setAttribute("href", "#");
      }
      if (el.tagName === "INPUT" && el.type === "hidden") el.setAttribute("value", "");
      if (el.tagName === "INPUT" && (el.name === "authenticity_token" || /token|captcha/i.test(el.name))) el.setAttribute("value", "");
    });
    root.querySelectorAll(".cc-window, #onetrust-consent-sdk, [aria-label*=cookie i]").forEach((el) => el.remove());
    root.querySelectorAll('[class*="captcha" i], [id*="captcha" i]').forEach((el) => el.remove());
    return root.innerHTML.replace(/\n\s*\n+/g, "\n");
  });
  const doc = `<!doctype html>\n<!-- Sanitized snapshot of ${url} taken ${new Date().toISOString().slice(0, 10)} for Filler's autofill tests. Scripts, styles, images, tracking and controls invisible on the live page removed; data-fixture-options = option list harvested by opening the widget. -->\n<html><head><meta charset="utf-8"><title>fixture</title></head><body>\n${html}\n</body></html>\n`;
  fs.writeFileSync(out, doc);
  console.log("wrote", out, doc.length);
  await page.screenshot({ path: out.replace(/\.html$/, ".png"), fullPage: true });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
