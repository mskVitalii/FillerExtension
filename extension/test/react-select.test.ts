import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import Select, { components, type DropdownIndicatorProps } from "react-select";
import { fillComboboxAnswer, revealComboboxOptions } from "@/features/autofill/combobox";

/**
 * Drives the real react-select (v5, what greenhouse.io's application form
 * ships) rather than a hand-written look-alike: the fixture page's mock can
 * only encode what we *think* the widget does, while these handlers are the
 * library's own. Captured live on a Greenhouse form, a real user's pick is:
 * mousedown on the Control `<div>` (focuses the input, which then opens the
 * menu) → mouseup/click → mousedown/mouseup/click on
 * `div#react-select-<inputId>-option-N`.
 */

// Deliberately *not* wrapped in act(): act() defers every state update to
// the end of its scope, so the engine — which dispatches an event, waits,
// then looks for the rendered menu — would never see the menu open. React's
// normal scheduler, as in the browser, renders between those steps.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const OPTIONS = ["Yes", "No", "Prefer not to say", "I am a protected veteran"].map((label) => ({ label, value: label }));

/** Greenhouse swaps react-select's indicator for a `<button aria-label="Toggle flyout">`. */
function ToggleFlyoutIndicator(props: DropdownIndicatorProps) {
  return createElement(
    components.DropdownIndicator,
    props,
    createElement("button", { type: "button", "aria-label": "Toggle flyout", tabIndex: -1 }, "▾"),
  );
}

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
});

async function renderSelect(extra: Partial<ComponentProps<typeof Select>> = {}) {
  let value: { label: string } | null = null;
  container = document.createElement("form");
  container.id = "application-form";
  document.body.appendChild(container);
  root = createRoot(container);
  const render = () =>
    root!.render(
      createElement(Select, {
        inputId: "question_38394970002",
        instanceId: "question_38394970002",
        "aria-label": "Are you a protected veteran?",
        options: OPTIONS,
        value,
        onChange: (next: unknown) => {
          value = next as { label: string } | null;
          render();
        },
        ...extra,
      }),
    );
  render();
  await tick();
  const input = document.getElementById("question_38394970002") as HTMLInputElement;
  return { input, value: () => value?.label ?? null };
}

/** Awaits the engine, then one more tick so React commits the last state update it caused. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  await tick();
  return result;
}

describe("real react-select (greenhouse.io)", () => {
  it("reads the option list", async () => {
    const { input } = await renderSelect();
    expect(await settle(revealComboboxOptions(input))).toEqual(OPTIONS.map((o) => o.label));
  });

  it("picks the matching option on a plain react-select", async () => {
    const { input, value } = await renderSelect();
    expect(await settle(fillComboboxAnswer(input, "Prefer not to say"))).toBe(true);
    expect(value()).toBe("Prefer not to say");
  });

  it("picks the matching option when the indicator is Greenhouse's 'Toggle flyout' button", async () => {
    const { input, value } = await renderSelect({ components: { DropdownIndicator: ToggleFlyoutIndicator } });
    expect(await settle(fillComboboxAnswer(input, "No"))).toBe(true);
    expect(value()).toBe("No");
  });

  it("closes the menu again after picking", async () => {
    const { input } = await renderSelect({ components: { DropdownIndicator: ToggleFlyoutIndicator } });
    await settle(fillComboboxAnswer(input, "Yes"));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  // Autofill runs while the Side Panel — not the page — holds focus. In that
  // state Chrome's `el.focus()` moves `activeElement` without dispatching
  // `focus`/`focusin`, so react-select's "open after focus" path (a Control
  // mousedown on an unfocused select) never fires. Simulate that here.
  describe("while the page itself doesn't have focus", () => {
    it("still opens the menu and picks the option (plain react-select)", async () => {
      vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
      const { input, value } = await renderSelect();
      expect(await settle(fillComboboxAnswer(input, "I am a protected veteran"))).toBe(true);
      expect(value()).toBe("I am a protected veteran");
    });

    it("still opens the menu and picks the option (Toggle flyout indicator)", async () => {
      vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
      const { input, value } = await renderSelect({ components: { DropdownIndicator: ToggleFlyoutIndicator } });
      expect(await settle(fillComboboxAnswer(input, "Prefer not to say"))).toBe(true);
      expect(value()).toBe("Prefer not to say");
    });

    it("still reads the option list", async () => {
      vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
      const { input } = await renderSelect();
      expect(await settle(revealComboboxOptions(input))).toEqual(OPTIONS.map((o) => o.label));
    });
  });

  it("doesn't type the answer into the search box when nothing matches", async () => {
    const { input, value } = await renderSelect();
    await settle(fillComboboxAnswer(input, "Something else entirely"));
    expect(value()).toBeNull();
    expect(input.value).toBe("");
  });
});
