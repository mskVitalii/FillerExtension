import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads an ATS fixture (`test/ats/<ats>/<file>.html`) into jsdom and replays the
 * behaviour of the vendor widgets in it, which a parsed fixture can't run on its own:
 *
 * - Workday listbox buttons (`button[aria-haspopup=listbox][data-fixture-options]`):
 *   a click renders the popup `ul[role=listbox]` (with its "Select One" placeholder row)
 *   and points `aria-controls` at it; clicking an option sets the button text/value and
 *   closes the popup; Escape closes it. Exactly what the live tenant did.
 * - Workday multiselect prompts (`[data-automation-id=multiSelectContainer] input`):
 *   Enter renders `activeListContainer` results filtered by the typed text; a click adds a
 *   `selectedItem` pill.
 * - Workday "Add" buttons (`[data-fixture-add]`): stamp the named <template>, numbering it.
 * - Workday "I currently work here": hides the end date.
 * - UI5 `sap.m.Select` (`.sapMSlt[data-fixture-options]`), `sap.m.ComboBox` (arrow opens
 *   `<id>-popup`), `sap.m.CheckBox` (`.sapMCb[role=checkbox]`).
 *
 * Every widget ignores typed text as a selection, like the real ones.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadAtsFixture(relative: string): void {
  const html = readFileSync(path.resolve(here, relative), "utf-8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  // jsdom compiles inline handlers (`onchange="clearDpcsInfo()"`) whose functions live in the
  // page's own scripts, never loaded here; drop the compiled handler, keep the attribute text.
  for (const attr of ["onclick", "onchange", "onkeyup", "onkeydown", "oninput", "onblur", "onfocus"]) {
    for (const el of document.body.querySelectorAll(`[${attr}]`)) (el as unknown as Record<string, unknown>)[attr] = null;
  }
  wireWidgets(document);
}

/** Keeps only the `<section>` with `id` (fixtures that hold several states of one page). */
export function showOnly(id: string): void {
  for (const section of document.querySelectorAll("body > section")) {
    if (section.id === id) section.removeAttribute("hidden");
    else section.remove();
  }
}

let seq = 0;

function options(el: Element): string[] {
  return (el.getAttribute("data-fixture-options") ?? "").split("|").filter(Boolean);
}

function closeAllPopups(): void {
  for (const popup of document.querySelectorAll("[data-fixture-popup]")) {
    const owner = document.getElementById(popup.getAttribute("data-fixture-popup")!);
    owner?.removeAttribute("aria-controls");
    owner?.setAttribute("aria-expanded", "false");
    popup.remove();
  }
}

function wireWorkdayListbox(btn: HTMLButtonElement): void {
  btn.addEventListener("click", () => {
    const openId = btn.getAttribute("aria-controls");
    if (openId && document.getElementById(openId)) {
      closeAllPopups();
      return;
    }
    closeAllPopups();
    const listId = `wd-list-${++seq}`;
    const holder = document.createElement("div");
    holder.setAttribute("data-fixture-popup", btn.id);
    const list = document.createElement("ul");
    list.setAttribute("role", "listbox");
    list.id = listId;
    const placeholder = document.createElement("li");
    placeholder.setAttribute("role", "option");
    placeholder.setAttribute("data-value", "");
    placeholder.setAttribute("aria-selected", "true");
    placeholder.innerHTML = "<div>Select One</div>";
    list.append(placeholder);
    options(btn).forEach((text, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("data-value", `v${i}`);
      li.id = `${listId}-${i}`;
      li.innerHTML = `<div>${text}</div>`;
      li.addEventListener("click", () => {
        btn.textContent = text;
        btn.value = `v${i}`;
        const carrier = btn.nextElementSibling;
        if (carrier instanceof HTMLInputElement) carrier.value = `v${i}`;
        closeAllPopups();
      });
      list.append(li);
    });
    holder.append(list);
    document.body.append(holder);
    btn.setAttribute("aria-controls", listId);
    btn.setAttribute("aria-expanded", "true");
  });
}

function wireWorkdayPrompt(input: HTMLInputElement): void {
  const container = input.closest("[data-automation-id='multiSelectContainer']")!;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    closeAllPopups();
    const query = input.value.trim().toLowerCase();
    const holder = document.createElement("div");
    holder.setAttribute("data-fixture-popup", input.id);
    holder.setAttribute("data-automation-id", "activeListContainer");
    holder.setAttribute("role", "listbox");
    for (const text of options(input).filter((t) => t.toLowerCase().includes(query))) {
      const row = document.createElement("div");
      row.setAttribute("role", "option");
      row.setAttribute("data-automation-id", "menuItem");
      row.innerHTML = `<div data-automation-id="promptOption">${text}</div>`;
      row.addEventListener("click", () => {
        let list = container.querySelector("[data-automation-id='selectedItemList']");
        if (!list) {
          list = document.createElement("ul");
          list.setAttribute("data-automation-id", "selectedItemList");
          container.append(list);
        }
        list.innerHTML = `<li data-automation-id="menuItem"><div role="option" data-automation-id="selectedItem"><p data-automation-id="promptOption">${text}</p></div></li>`;
        input.value = "";
        closeAllPopups();
      });
      holder.append(row);
    }
    document.body.append(holder);
  });
}

function wireWorkdayAdd(btn: HTMLElement): void {
  btn.addEventListener("click", () => {
    const template = document.getElementById(btn.getAttribute("data-fixture-add")!) as HTMLTemplateElement;
    const section = btn.parentElement!;
    const prefix = template.innerHTML.match(/data-automation-id="(\w+)-__N__"/)![1];
    const n = section.querySelectorAll(`[data-automation-id^="${prefix}-"]`).length + 1;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = template.innerHTML.replace(/__N__/g, String(n));
    const entry = wrapper.firstElementChild!;
    section.insertBefore(entry, btn);
    wireWidgets(entry);
  });
}

function wireCurrentlyWorkHere(box: HTMLInputElement): void {
  box.addEventListener("click", () => {
    const panel = box.closest("[data-automation-id^='workExperience-']");
    const end = panel?.querySelector("[data-automation-id='formField-endDate']");
    if (end) end.toggleAttribute("hidden", box.checked);
  });
}

function wireUi5Select(select: HTMLElement): void {
  select.addEventListener("click", () => {
    if (document.getElementById(`${select.id}-list`)) {
      closeAllPopups();
      return;
    }
    closeAllPopups();
    const popup = document.createElement("div");
    popup.id = `${select.id}-popup`;
    popup.setAttribute("data-fixture-popup", select.id);
    const list = document.createElement("ul");
    list.id = `${select.id}-list`;
    list.setAttribute("role", "listbox");
    for (const text of options(select)) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = "sapMSelectListItemBase sapMSelectListItem";
      li.textContent = text;
      li.addEventListener("click", () => {
        select.querySelector(".sapMSltLabel")!.textContent = text;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeAllPopups();
      });
      list.append(li);
    }
    popup.append(list);
    document.body.append(popup);
    select.setAttribute("aria-expanded", "true");
    select.setAttribute("aria-controls", list.id);
  });
}

function wireUi5ComboBox(input: HTMLInputElement): void {
  const base = input.id.replace(/-inner$/, "");
  const arrow = document.getElementById(`${base}-arrow`)!;
  arrow.addEventListener("click", () => {
    if (document.getElementById(`${base}-popup`)) {
      closeAllPopups();
      return;
    }
    closeAllPopups();
    const popup = document.createElement("div");
    popup.id = `${base}-popup`;
    popup.setAttribute("data-fixture-popup", input.id);
    const list = document.createElement("ul");
    list.id = `${base}-popup-list-listUl`;
    list.setAttribute("role", "listbox");
    for (const text of options(input)) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = "sapMLIB sapMSLI sapMComboBoxBaseItem";
      li.innerHTML = `<div class="sapMLIBContent"><div class="sapMSLITitleOnly">${text}</div></div>`;
      li.addEventListener("click", () => {
        input.value = text;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        closeAllPopups();
      });
      list.append(li);
    }
    popup.append(list);
    document.body.append(popup);
    input.setAttribute("aria-expanded", "true");
  });
}

function wireUi5CheckBox(box: HTMLElement): void {
  box.addEventListener("click", () => {
    const checked = box.getAttribute("aria-checked") !== "true";
    box.setAttribute("aria-checked", String(checked));
    const mirror = box.querySelector<HTMLInputElement>("input[type='checkbox']");
    if (mirror) mirror.checked = checked;
  });
}

function wireWidgets(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("button[aria-haspopup='listbox'][data-fixture-options]").forEach(wireWorkdayListbox);
  root.querySelectorAll<HTMLInputElement>("[data-automation-id='multiSelectContainer'] input[data-fixture-options]").forEach(wireWorkdayPrompt);
  root.querySelectorAll<HTMLElement>("[data-fixture-add]").forEach(wireWorkdayAdd);
  root.querySelectorAll<HTMLInputElement>("input[name='currentlyWorkHere']").forEach(wireCurrentlyWorkHere);
  root.querySelectorAll<HTMLElement>(".sapMSlt[data-fixture-options]").forEach(wireUi5Select);
  root.querySelectorAll<HTMLInputElement>(".sapMComboBox input[data-fixture-options]").forEach(wireUi5ComboBox);
  root.querySelectorAll<HTMLElement>(".sapMCb[role='checkbox']").forEach(wireUi5CheckBox);
}

let escapeWired = false;
if (!escapeWired) {
  escapeWired = true;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllPopups();
  });
}
