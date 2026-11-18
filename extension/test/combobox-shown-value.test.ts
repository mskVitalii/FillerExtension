import { describe, expect, it } from "vitest";
import { comboboxShownValue } from "@/features/autofill/combobox";
import { readValue } from "@/features/autofill/refill-guard";

/** greenhouse.io's react-select after a pick: the input's own value is the (cleared) search text. */
function widget(inner: string): HTMLInputElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="select__control">
      <div class="select__value-container">${inner}
        <div class="select__input-container"><input id="q" class="select__input" role="combobox" value="" /></div>
      </div>
    </div>`;
  document.body.append(root);
  return root.querySelector("input")!;
}

describe("comboboxShownValue", () => {
  it("reads a single pick from the value container, not the empty search input", () => {
    const el = widget('<div class="select__single-value">Male</div>');
    expect(comboboxShownValue(el)).toBe("Male");
    expect(readValue(el)).toBe("Male");
  });

  it("joins multi-select chips", () => {
    const el = widget('<div class="select__multi-value"><div class="select__multi-value__label">East Europe</div></div><div class="select__multi-value"><div class="select__multi-value__label">West Europe</div></div>');
    expect(comboboxShownValue(el)).toBe("East Europe, West Europe");
  });

  it("is empty for a widget with nothing picked, and null for a plain input", () => {
    expect(comboboxShownValue(widget(""))).toBe("");
    const plain = document.createElement("input");
    plain.className = "form-control";
    document.body.append(plain);
    expect(comboboxShownValue(plain)).toBeNull();
  });
});
