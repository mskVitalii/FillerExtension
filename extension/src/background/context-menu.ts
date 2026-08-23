import type { ProfileFieldKey } from "@/types/profile";
import type { RuntimeMessage } from "@/types/messages";
import { ensureContentScript } from "./inject-content-script";

const INSERT_PARENT_ID = "job-app-assistant-insert";

/** field key sent to the content script; "cv"/"coverLetter" are handled specially. */
const MENU_ITEMS: { id: ProfileFieldKey | "cv" | "coverLetter"; title: string }[] = [
  { id: "salutation", title: "Salutation" },
  { id: "firstName", title: "First name" },
  { id: "lastName", title: "Last name" },
  { id: "fullName", title: "Full name" },
  { id: "email", title: "Email" },
  { id: "phone", title: "Phone" },
  { id: "address", title: "Address" },
  { id: "linkedin", title: "LinkedIn" },
  { id: "github", title: "GitHub" },
  { id: "website", title: "Website" },
  { id: "expectedSalary", title: "Expected salary" },
  { id: "cv", title: "CV" },
  { id: "coverLetter", title: "Cover Letter" },
];

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

export function parseInsertField(menuItemId: string): (ProfileFieldKey | "cv" | "coverLetter") | null {
  if (!menuItemId.startsWith(`${INSERT_PARENT_ID}:`)) return null;
  return menuItemId.slice(INSERT_PARENT_ID.length + 1) as ProfileFieldKey | "cv" | "coverLetter";
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (!tab?.id || typeof info.menuItemId !== "string") return;
  const field = parseInsertField(info.menuItemId);
  if (!field) return;

  const { resolveInsertValue } = await import("./resolve-insert-value");
  const value = await resolveInsertValue(field);
  if (!value) return;

  // Runs inside this click's activeTab grant. On a tab that's never had
  // the content script loaded before, this injects it too late to have
  // caught the contextmenu event that opened this very menu — insert
  // then silently no-ops (getInsertTarget() finds nothing) — but it's
  // ready for every use after this one on the same tab.
  await ensureContentScript(tab.id);

  const message: RuntimeMessage = { type: "INSERT_VALUE", field, value };
  chrome.tabs.sendMessage(tab.id, message).catch(() => {
    // Restricted page (e.g. chrome:// pages) — nothing to do.
  });
}
