import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};
const context = { profile: { city: "Berlin", country: "Germany" }, cvText: "Go developer", personalLegend: "", languageLevels: [] as { language: string }[] };
const suggestSearchQuery = vi.fn();
const suggestSearchTags = vi.fn();

vi.mock("@/features/storage/local", () => ({
  getLocal: async (key: string) => store[key],
  setLocal: async (key: string, value: unknown) => {
    store[key] = value;
  },
}));
vi.mock("@/features/profile/context", () => ({ getApplicantContext: async () => context }));
vi.mock("@/features/openai/suggest-search-query", () => ({ suggestSearchQuery: () => suggestSearchQuery() }));
vi.mock("@/features/openai/suggest-search-tags", () => ({ suggestSearchTags: () => suggestSearchTags() }));

const { getSearchSuggestion } = await import("@/features/job-search/suggestion-cache");

describe("getSearchSuggestion", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    context.cvText = "Go developer";
    suggestSearchQuery.mockReset().mockResolvedValue({ what: "go developer", where: "Berlin, Germany" });
    suggestSearchTags.mockReset().mockResolvedValue(["go developer", "golang engineer"]);
  });

  it("asks the AI once per CV, then serves the cache", async () => {
    expect(await getSearchSuggestion(true)).toMatchObject({ what: "go developer", tags: ["go developer", "golang engineer"], cached: false });
    expect(await getSearchSuggestion(true)).toMatchObject({ what: "go developer", tags: ["go developer", "golang engineer"], cached: true });
    expect(await getSearchSuggestion(false)).toMatchObject({ cached: true });
    expect(suggestSearchQuery).toHaveBeenCalledTimes(1);
    expect(suggestSearchTags).toHaveBeenCalledTimes(1);
  });

  it("only fetches the missing tags when the query is cached without them", async () => {
    await getSearchSuggestion(false);
    expect(suggestSearchTags).not.toHaveBeenCalled();
    expect(await getSearchSuggestion(true)).toMatchObject({ tags: ["go developer", "golang engineer"], cached: false });
    expect(suggestSearchQuery).toHaveBeenCalledTimes(1);
  });

  it("misses when the CV changes", async () => {
    await getSearchSuggestion(true);
    context.cvText = "Rust developer";
    await getSearchSuggestion(true);
    expect(suggestSearchQuery).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache an empty answer", async () => {
    suggestSearchQuery.mockResolvedValue({ what: "", where: "" });
    suggestSearchTags.mockResolvedValue([]);
    await getSearchSuggestion(true);
    await getSearchSuggestion(true);
    expect(suggestSearchQuery).toHaveBeenCalledTimes(2);
  });
});
