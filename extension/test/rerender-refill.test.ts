import { afterEach, describe, expect, it } from "vitest";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { buildLocator, resolveLocator } from "@/features/autofill/element-locator";
import { fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { fillElement } from "@/features/autofill/native-setter";
import { guardFills, readValue } from "@/features/autofill/refill-guard";
import { autofillDocument } from "@/features/autofill/engine";
import { EMPTY_PROFILE } from "@/types/profile";

/**
 * React/SPA forms replace the DOM node we filled (a remount on a new form
 * session, a step transition) or re-render a field empty right after the
 * fill. These drive real React 18 the way react-select.test.ts does —
 * outside act(), so React's own scheduler renders between our steps, as in
 * the browser.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root!.render(element));
}

describe("locator after a re-render replaced the node", () => {
  it("finds the replacement by name/autocomplete, not the stale node", async () => {
    let remount: () => void = () => {};
    function Form() {
      const [generation, setGeneration] = useState(0);
      remount = () => setGeneration((g) => g + 1);
      return createElement(
        "form",
        { key: generation },
        createElement("label", { htmlFor: "why" }, "Why do you want to join?"),
        createElement("textarea", { id: "why", name: "motivation" }),
        createElement("input", { name: "city", autoComplete: "address-level2" }),
      );
    }
    mount(createElement(Form));

    const oldTextarea = container!.querySelector("textarea")!;
    const locator = buildLocator(oldTextarea, "Why do you want to join?");
    flushSync(() => remount());

    const fresh = container!.querySelector("textarea")!;
    expect(fresh).not.toBe(oldTextarea);
    expect(oldTextarea.isConnected).toBe(false);
    expect(fresh.hasAttribute("data-filler-loc")).toBe(false);
    expect(resolveLocator(locator)).toBe(fresh);

    const result = await fillAnswersByLocator([{ locator, answer: "Because of the mission." }]);
    expect(result.filled).toBe(1);
    expect(fresh.value).toBe("Because of the mission.");
  });

  it("doesn't trust a stale CSS path that now points at a different kind of control", () => {
    document.body.innerHTML = `<form id="f"><div><input name="first"></div><div><input name="last"></div></form>`;
    const last = document.querySelector<HTMLInputElement>('input[name="last"]')!;
    const locator = buildLocator(last, "");
    // Re-render: the attribute stamp is gone and the second slot is now a select.
    document.body.innerHTML = `<form id="f"><div><input name="first"></div><div><select name="other"></select></div><div><input name="last"></div></form>`;
    expect(resolveLocator(locator)).toBe(document.querySelector('input[name="last"]'));
  });

  it("falls back to position only while the form still has the same number of fields", () => {
    document.body.innerHTML = `<form><input><input><input></form>`;
    const second = document.querySelectorAll("input")[1];
    const locator = buildLocator(second, "");
    // New wrapper structure: the CSS path is dead, no attribute identifies the field.
    document.body.innerHTML = `<section><div><input><input><input></div></section>`;
    expect(resolveLocator(locator)).toBe(document.querySelectorAll("input")[1]);
    document.body.innerHTML = `<section><div><input><input><input><input></div></section>`;
    expect(resolveLocator(locator)).toBeNull();
  });
});

describe("refill after a re-render", () => {
  it("refills a controlled React input that the form remounted empty right after the fill", async () => {
    let state = "";
    let remounts = 0;
    function Form() {
      const [value, setValue] = useState("");
      const [generation, setGeneration] = useState(0);
      const resetOnce = useRef(false);
      state = value;
      useEffect(() => {
        // A form library re-initializing after the first change: new node,
        // state wiped — exactly what loses a fill on some ATS forms.
        if (value && !resetOnce.current) {
          resetOnce.current = true;
          setTimeout(() => {
            remounts++;
            setValue("");
            setGeneration((g) => g + 1);
          }, 30);
        }
      }, [value]);
      return createElement("input", {
        key: generation,
        name: "firstName",
        autoComplete: "given-name",
        value,
        onChange: (e: { target: HTMLInputElement }) => setValue(e.target.value),
      });
    }
    mount(createElement(Form));

    const first = container!.querySelector("input")!;
    const result = await autofillDocument({ ...EMPTY_PROFILE, firstName: "Ada" });
    expect(result.filled).toBe(1);

    await wait(600);
    const replaced = container!.querySelector("input")!;
    expect(remounts).toBe(1);
    expect(replaced).not.toBe(first);
    expect(replaced.value).toBe("Ada");
    expect(state).toBe("Ada");
  });
});

describe("refill guard never loops", () => {
  it("caps refills on a page that wipes the field every time it's filled, then stops", async () => {
    document.body.innerHTML = `<form><input name="email"></form>`;
    // Hostile re-render: every value we write is wiped again a moment later
    // by a brand-new node — a naive observer would refill forever.
    let wiping = true;
    const wipe = () => {
      setTimeout(() => {
        if (!wiping) return;
        const fresh = document.createElement("input");
        fresh.name = "email";
        fresh.addEventListener("input", wipe);
        document.querySelector("input")!.replaceWith(fresh);
      }, 5);
    };
    const input = document.querySelector("input")!;
    input.addEventListener("input", wipe);

    let refills = 0;
    fillElement(input, "a@b.c");
    const report = await guardFills(
      [
        {
          el: input,
          before: "",
          locate: () => document.querySelector("input"),
          refill: (el) => {
            refills++;
            return fillElement(el, "a@b.c");
          },
        },
      ],
      { debounceMs: 10, maxRetries: 2, timeoutMs: 2000, settleMs: 50, checkpointsMs: [] },
    );
    wiping = false;
    expect(refills).toBe(2);
    expect(report.refills).toBe(2);
    expect(report.lost).toBe(1);
  });

  it("ignores its own mutations and a page that re-renders on every mutation, stopping by timeout", async () => {
    document.body.innerHTML = `<form><input name="city"><div id="log"></div></form>`;
    const input = document.querySelector("input")!;
    // A page observer reacting to *any* mutation (including ours) with
    // another mutation: an endless re-render storm.
    let storm = 0;
    const pageObserver = new MutationObserver(() => {
      if (storm++ < 500) document.getElementById("log")!.append(document.createElement("span"));
    });
    pageObserver.observe(document.body, { childList: true, subtree: true });

    let refills = 0;
    fillElement(input, "Berlin");
    const started = Date.now();
    const report = await guardFills(
      [{ el: input, before: "", locate: () => input, refill: () => (refills++, true) }],
      { debounceMs: 20, timeoutMs: 400, settleMs: 100, checkpointsMs: [] },
    );
    pageObserver.disconnect();
    expect(refills).toBe(0);
    expect(report).toEqual({ refills: 0, lost: 0 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("stops early once values held through a quiet period", async () => {
    document.body.innerHTML = `<input name="city">`;
    const input = document.querySelector("input")!;
    fillElement(input, "Berlin");
    const started = Date.now();
    await guardFills([{ el: input, before: "", locate: () => input, refill: () => true }], {
      timeoutMs: 5000,
      settleMs: 50,
      checkpointsMs: [20],
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("leaves a value the site reformatted alone (input mask), only undoing a reset", async () => {
    document.body.innerHTML = `<input name="phone">`;
    const input = document.querySelector("input")!;
    fillElement(input, "+491701234567");
    input.value = "+49 170 1234567";
    let refills = 0;
    await guardFills([{ el: input, before: "", locate: () => input, refill: () => (refills++, true) }], {
      settleMs: 30,
      checkpointsMs: [10],
    });
    expect(refills).toBe(0);
    expect(readValue(input)).toBe("+49 170 1234567");
  });
});
