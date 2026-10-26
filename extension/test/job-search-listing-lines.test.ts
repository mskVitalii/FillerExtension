import { describe, expect, it } from "vitest";
import { createListingLineParser, parseListingLine } from "@/features/job-search/listing-lines";

const LINE = '{"title":"Go developer","company":"Acme","location":"Berlin","url":"https://jobs.lever.co/acme/1","salary":"","postedAt":"2026-10-20","snippet":"Go and Kubernetes."}';

describe("parseListingLine", () => {
  it("reads a posting object, also behind a list marker or with a trailing comma", () => {
    expect(parseListingLine(LINE)).toMatchObject({ title: "Go developer", url: "https://jobs.lever.co/acme/1", postedAt: "2026-10-20" });
    expect(parseListingLine(`- ${LINE}`)?.title).toBe("Go developer");
    expect(parseListingLine(`1. ${LINE},`)?.title).toBe("Go developer");
  });

  it("rejects prose, fences, broken JSON and postings without a real URL or title", () => {
    for (const line of ["Here are the roles:", "```json", '{"title":"x"', '{"title":"x","url":"jobs.lever.co/1"}', '{"title":"","url":"https://a/1"}']) {
      expect(parseListingLine(line)).toBeNull();
    }
  });

  it("fills missing or non-string fields with empty strings", () => {
    expect(parseListingLine('{"title":"x","url":"https://a/1","salary":50000}')).toEqual({
      title: "x",
      company: "",
      location: "",
      url: "https://a/1",
      salary: "",
      snippet: "",
      postedAt: "",
    });
  });
});

describe("createListingLineParser", () => {
  it("emits a line once its newline arrives, and the last one on end()", () => {
    const seen: string[] = [];
    const parser = createListingLineParser((listing) => seen.push(listing.url));
    const second = LINE.replace("acme/1", "acme/2");
    parser.push(LINE.slice(0, 30));
    expect(seen).toEqual([]);
    parser.push(`${LINE.slice(30)}\n${second.slice(0, 50)}`);
    expect(seen).toEqual(["https://jobs.lever.co/acme/1"]);
    parser.push(second.slice(50));
    parser.end();
    expect(seen).toEqual(["https://jobs.lever.co/acme/1", "https://jobs.lever.co/acme/2"]);
  });
});
