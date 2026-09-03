import type { RuntimeMessage } from "@/types/messages";
import { INSERT_FIELD_LABELS, INSERT_FIELD_ORDER, type InsertField } from "@/features/autofill/insert-field-labels";
import { ensureContentScript } from "./inject-content-script";
import { resolveInsertValue } from "./resolve-insert-value";

const INSERT_PARENT_ID = "job-app-assistant-insert";
// "generatePassword" reads as "Generated password" in the panel's own
// Password card, but as an action here — this is the one label that
// deliberately diverges from INSERT_FIELD_LABELS' toast wording.
const MENU_TITLE_OVERRIDES: Partial<Record<InsertField, string>> = { generatePassword: "Generate password" };
const MENU_ITEMS: { id: InsertField; title: string }[] = INSERT_FIELD_ORDER.map((id) => ({
  id,
  title: MENU_TITLE_OVERRIDES[id] ?? INSERT_FIELD_LABELS[id],
}));

/** Right click → Insert → <field> (spec section 14). */
export function registerContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: INSERT_PARENT_ID,
      title: "Insert",
      contexts: ["editable"],
    });
    for (const item of MENU_ITEMS) {
      chrome.contextMenus.create({
        id: `${INSERT_PARENT_ID}:${item.id}`,
        parentId: INSERT_PARENT_ID,
        title: item.title,
        contexts: ["editable"],
      });
    }
  });
}

export function parseInsertField(menuItemId: string): InsertField | null {
  if (!menuItemId.startsWith(`${INSERT_PARENT_ID}:`)) return null;
  return menuItemId.slice(INSERT_PARENT_ID.length + 1) as InsertField;
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (!tab?.id || typeof info.menuItemId !== "string") return;
  const field = parseInsertField(info.menuItemId);
  if (!field) return;

  // A static import, not a dynamic one: Vite wraps every dynamic `import()`
  // in a preload helper that touches `document` (to add a
  // `<link rel="modulepreload">`) — harmless on a normal page, but this
  // code runs in the background service worker, which has no `document` at
  // all. That made *every* context-menu insert throw
  // "ReferenceError: document is not defined" immediately, before ever
  // reaching the content script — this module is tiny and used on every
  // click anyway, so there was no real benefit to splitting it out.
  const value = await resolveInsertValue(field, tab.id);
  // Deliberately NOT bailing out here when `value` is empty (e.g. no CV
  // uploaded yet, or that profile field was never filled in): the message
  // still goes to the content script so it can show an on-page toast
  // explaining *why* nothing was inserted — silently doing nothing looked
  // indistinguishable from the feature being broken.

  // Runs inside this click's activeTab grant, which re-injects into every
  // frame of the tab (see inject-content-script.ts) even on a tab that's
  // never had the content script before. The content script's own
  // getInsertTarget() falls back to `document.activeElement` precisely for
  // this "just-injected" case — right-clicking an editable element leaves
  // it focused, so the fresh script can still find it even though it wasn't
  // listening in time to catch the `contextmenu` event itself.
  await ensureContentScript(tab.id);

  const message: RuntimeMessage = { type: "INSERT_VALUE", field, value };
  // `info.frameId` targets the exact frame the right-click happened in —
  // without it this always goes to the top frame, so "Insert" silently did
  // nothing for any field inside an iframe-embedded application form.
  chrome.tabs.sendMessage(tab.id, message, { frameId: info.frameId }).catch(() => {
    // Restricted page (e.g. chrome:// pages) — genuinely nothing to do,
    // there's no DOM to show a toast in.
  });
}
