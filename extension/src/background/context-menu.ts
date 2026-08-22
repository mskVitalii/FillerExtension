import type { ProfileFieldKey } from "@/types/profile";
import type { RuntimeMessage } from "@/types/messages";

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

  const message: RuntimeMessage = { type: "INSERT_VALUE", field, value };
  chrome.tabs.sendMessage(tab.id, message).catch(() => {
    // Content script may not be injected on this page (e.g. chrome:// pages).
  });
}
