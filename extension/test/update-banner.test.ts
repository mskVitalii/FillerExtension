import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UpdateBanner } from "@/components/UpdateBanner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("UpdateBanner", () => {
  let storage: Record<string, unknown>;
  let manifest: Record<string, unknown>;
  let badge: string;
  let root: Root;
  let container: HTMLElement;
  const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
  const reload = vi.fn();

  beforeEach(() => {
    storage = {};
    manifest = { version: "1.1.15" };
    badge = "NEW";
    listeners.length = 0;
    reload.mockReset();
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => manifest, reload, id: "abc" },
      tabs: { create: vi.fn() },
      storage: {
        onChanged: {
          addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
          removeListener: () => undefined,
        },
        local: {
          get: async (keys: string | string[]) =>
            Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in storage).map((k) => [k, storage[k]])),
          set: async (items: Record<string, unknown>) => {
            Object.assign(storage, items);
            for (const fn of listeners) fn(Object.fromEntries(Object.keys(items).map((k) => [k, {}])), "local");
          },
        },
      },
      action: {
        setBadgeText: async ({ text }: { text: string }) => void (badge = text),
        setBadgeBackgroundColor: async () => undefined,
        setBadgeTextColor: async () => undefined,
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
  });

  const latest = {
    version: "1.1.16",
    tag: "extension-v1.1.16",
    name: "Filler 1.1.16",
    notesUrl: "https://github.com/mskVitalii/FillerExtension/releases/tag/extension-v1.1.16",
    zipUrl: "https://github.com/mskVitalii/FillerExtension/releases/download/extension-v1.1.16/extension.zip",
    publishedAt: null,
  };

  it("renders nothing when up to date", async () => {
    storage.updateCheck = { checkedAt: 1, etag: null, latest: { ...latest, version: "1.1.15" }, error: null };
    root.render(createElement(UpdateBanner));
    await flush();
    expect(container.textContent).toBe("");
  });

  it("offers the GitHub zip and notes for an unpacked install, and hides on dismiss", async () => {
    storage.updateCheck = { checkedAt: 1, etag: null, latest, error: null };
    root.render(createElement(UpdateBanner));
    await flush();
    expect(container.textContent).toContain("1.1.16");
    expect(container.textContent).toContain("1.1.15");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([latest.zipUrl, latest.notesUrl]);
    expect(container.querySelectorAll("ol li")).toHaveLength(3);

    container.querySelector<HTMLButtonElement>("button[aria-label]")!.click();
    await flush();
    expect(storage.updateDismissedVersion).toBe("1.1.16");
    expect(badge).toBe("");
    expect(container.textContent).toBe("");
  });

  it("offers Reload to update for a Web Store install, without GitHub links", async () => {
    manifest.update_url = "https://clients2.google.com/service/update2/crx";
    storage.updateCheck = { checkedAt: 1, etag: null, latest, error: null };
    storage.storeUpdateVersion = "1.2.0";
    root.render(createElement(UpdateBanner));
    await flush();
    expect(container.textContent).toContain("1.2.0");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    const reloadButton = [...container.querySelectorAll("button")].find((b) => !b.getAttribute("aria-label"));
    reloadButton!.click();
    expect(reload).toHaveBeenCalled();
  });
});
