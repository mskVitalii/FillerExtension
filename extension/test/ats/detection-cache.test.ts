import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATS_ADAPTERS, activeAtsAdapter, withAtsCache, type AtsAdapter } from "@/features/autofill/ats";

let detectCalls = 0;
const probe: AtsAdapter = {
  id: "probe",
  detect: () => {
    detectCalls++;
    return document.body.dataset.probe === "yes";
  },
};

beforeEach(() => {
  detectCalls = 0;
  ATS_ADAPTERS.unshift(probe);
  document.body.innerHTML = "";
  delete document.body.dataset.probe;
});

afterEach(() => {
  ATS_ADAPTERS.splice(ATS_ADAPTERS.indexOf(probe), 1);
  history.replaceState(null, "", "/");
});

describe("withAtsCache", () => {
  it("detects once per run instead of once per field", () => {
    withAtsCache(() => {
      for (let i = 0; i < 50; i++) activeAtsAdapter();
    });
    expect(detectCalls).toBe(1);
  });

  it("stays live outside a run, so a page that changes is seen", () => {
    expect(activeAtsAdapter()).toBeNull();
    document.body.dataset.probe = "yes";
    expect(activeAtsAdapter()).toBe(probe);
  });

  it("forgets the answer once the run ends, including an async one", async () => {
    await withAtsCache(async () => {
      expect(activeAtsAdapter()).toBeNull();
      await Promise.resolve();
      document.body.dataset.probe = "yes";
      expect(activeAtsAdapter()).toBeNull(); // memoised for this run
    });
    expect(activeAtsAdapter()).toBe(probe);
  });

  it("re-detects when an SPA changes the URL mid-run", () => {
    withAtsCache(() => {
      activeAtsAdapter();
      history.replaceState(null, "", "/step-2");
      activeAtsAdapter();
      activeAtsAdapter();
    });
    expect(detectCalls).toBe(2);
  });

  it("nests: the inner run doesn't clear the outer one's memo", () => {
    withAtsCache(() => {
      activeAtsAdapter();
      withAtsCache(() => activeAtsAdapter());
      activeAtsAdapter();
    });
    expect(detectCalls).toBe(1);
  });

  it("releases the memo when the run throws", () => {
    expect(() =>
      withAtsCache(() => {
        activeAtsAdapter();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    document.body.dataset.probe = "yes";
    expect(activeAtsAdapter()).toBe(probe);
  });
});
