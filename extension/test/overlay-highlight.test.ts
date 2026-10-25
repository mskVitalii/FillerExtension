import { afterEach, describe, expect, it } from "vitest";
import { mountOverlayHost } from "@/features/autofill/overlay-host";
import { clearFieldHighlights, highlightFields } from "@/features/autofill/field-highlight";
import { cancelActivePicker, startElementPicker } from "@/features/autofill/element-picker";

/**
 * "Highlighting shows nothing": the on-page overlay used to be a bare
 * `<div>` on `<html>` — reachable by page CSS (`div { display:none
 * !important }`), dropped by a framework owning `<html>`'s children, and
 * gone the moment a pick succeeded. These check the hardened host and the
 * highlight that now marks what a pick / question scan found.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const overlays = () => Array.from(document.querySelectorAll("filler-overlay"));

function rectAt(el: Element, top: number, left = 10, width = 200, height = 30) {
  el.getBoundingClientRect = () =>
    ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
}

afterEach(() => {
  clearFieldHighlights();
  cancelActivePicker();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("overlay host", () => {
  it("is a custom element with !important inline styles page CSS can't override", () => {
    document.head.innerHTML = `<style>div, html > * { display: none !important; z-index: 0 !important; }</style>`;
    const overlay = mountOverlayHost("");
    const { host } = overlay;
    expect(host.tagName.toLowerCase()).toBe("filler-overlay");
    expect(host.style.getPropertyPriority("display")).toBe("important");
    expect(host.style.getPropertyValue("z-index")).toBe("2147483647");
    expect(host.getAttribute("popover")).toBe("manual");
    overlay.remove();
    expect(host.isConnected).toBe(false);
  });

  it("puts itself back when the page removes it, but not after remove()", async () => {
    const overlay = mountOverlayHost("");
    overlay.host.remove();
    await wait(0);
    expect(overlay.host.isConnected).toBe(true);
    overlay.remove();
    await wait(0);
    expect(overlay.host.isConnected).toBe(false);
  });

  it("mounts inside an open modal dialog so it isn't painted behind it", () => {
    document.body.innerHTML = `<dialog open id="modal"></dialog>`;
    const modal = document.getElementById("modal")!;
    const realQuery = document.querySelector.bind(document);
    // jsdom has no top layer / `:modal`; stand in for the one selector we ask about.
    document.querySelector = ((selector: string) =>
      selector === ":modal" ? modal : realQuery(selector)) as typeof document.querySelector;
    try {
      const overlay = mountOverlayHost("");
      expect(overlay.host.parentElement).toBe(modal);
      overlay.remove();
    } finally {
      document.querySelector = realQuery as typeof document.querySelector;
    }
  });
});

describe("field highlight", () => {
  it("outlines every target at its on-screen position, labelled", async () => {
    document.body.innerHTML = `<input id="a"><textarea id="b"></textarea>`;
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    rectAt(a, 100);
    rectAt(b, 300);
    highlightFields([
      { el: a, label: "Why us?" },
      { el: b, label: "Notice period" },
    ]);
    await wait(30);

    const rings = Array.from(overlays()[0].shadowRoot!.querySelectorAll<HTMLElement>(".ring"));
    expect(rings).toHaveLength(2);
    expect(rings[0].style.top).toBe("97px");
    expect(rings[1].style.top).toBe("297px");
    expect(rings[0].textContent).toBe("1 · Why us?");
  });

  it("follows scrolling and a field replaced by a re-render", async () => {
    document.body.innerHTML = `<input name="why">`;
    const original = document.querySelector("input")!;
    rectAt(original, 100);
    highlightFields([{ el: original, locate: () => document.querySelector('input[name="why"]') }]);
    await wait(30);
    const ring = () => overlays()[0].shadowRoot!.querySelector<HTMLElement>(".ring")!;
    expect(ring().style.top).toBe("97px");

    rectAt(original, 40); // scrolled
    await wait(30);
    expect(ring().style.top).toBe("37px");

    const replacement = document.createElement("input");
    replacement.name = "why";
    rectAt(replacement, 500);
    original.replaceWith(replacement);
    await wait(300);
    expect(ring().style.top).toBe("497px");
    expect(ring().hasAttribute("data-off")).toBe(false);
  });

  it("removes itself after its duration, and a new highlight replaces the old one", async () => {
    document.body.innerHTML = `<input>`;
    const input = document.querySelector("input")!;
    rectAt(input, 10);
    highlightFields([{ el: input }], 5000);
    highlightFields([{ el: input }], 60);
    expect(overlays()).toHaveLength(1);
    await wait(120);
    expect(overlays()).toHaveLength(0);
  });
});

describe("element picker overlay", () => {
  it("highlights the picked fields after a successful click", async () => {
    document.body.innerHTML = `
      <div id="block">
        <p>Why do you want to work here?</p>
        <textarea name="why"></textarea>
      </div>`;
    const block = document.getElementById("block")!;
    const textarea = document.querySelector("textarea")!;
    rectAt(block, 50, 10, 400, 200);
    rectAt(textarea, 80);
    document.elementFromPoint = () => block;

    const outcome = startElementPicker();
    expect(overlays()).toHaveLength(1);
    block.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 60 }));
    block.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 20, clientY: 60 }));
    const result = await outcome;
    expect(result.cancelled).toBe(false);
    await wait(30);

    // Picker overlay gone, highlight of the picked textarea up.
    const remaining = overlays();
    expect(remaining).toHaveLength(1);
    const ring = remaining[0].shadowRoot!.querySelector<HTMLElement>(".ring")!;
    expect(ring.style.top).toBe("77px");
    expect(ring.textContent).toContain("Why do you want to work here?");
  });

  it("explains an embedded iframe instead of showing nothing over it", async () => {
    document.body.innerHTML = `<iframe src="https://boards.greenhouse.io/acme/jobs/1"></iframe>`;
    const frame = document.querySelector("iframe")!;
    rectAt(frame, 0, 0, 800, 600);

    const outcome = startElementPicker();
    frame.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const shadow = overlays()[0].shadowRoot!;
    const chip = shadow.querySelector<HTMLElement>(".chip")!;
    const box = shadow.querySelector<HTMLElement>(".box")!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toContain("boards.greenhouse.io");
    expect(box.hidden).toBe(false);
    expect(box.style.width).toBe("800px");

    cancelActivePicker();
    expect((await outcome).cancelled).toBe(true);
  });
});
