import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertDocxToPdf } from "@/features/google-drive/convert";

interface Call {
  method: string;
  url: string;
  parents?: string[];
}

/**
 * The Drive round-trip itself can't run here (it needs a real Google
 * account), so this pins down the contract around it: which scopes are
 * asked for and when the consent prompt appears, the appDataFolder → My
 * Drive fallback, and that the temporary Google Doc is always deleted.
 */
describe("convertDocxToPdf", () => {
  let calls: Call[];
  let getAuthToken: ReturnType<typeof vi.fn>;

  function stubFetch(handler: (call: Call) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const call: Call = { method: init.method ?? "GET", url };
        if (init.body instanceof FormData) {
          const metadata = JSON.parse(await (init.body.get("metadata") as Blob).text()) as { parents?: string[] };
          call.parents = metadata.parents;
        }
        calls.push(call);
        return handler(call);
      }),
    );
  }

  beforeEach(() => {
    calls = [];
    getAuthToken = vi.fn(async ({ interactive }: { interactive: boolean }) => {
      if (!interactive) throw new Error("OAuth2 not granted or revoked.");
      return { token: "tok" };
    });
    vi.stubGlobal("chrome", { identity: { getAuthToken } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("asks for drive.file incrementally, exports a PDF and deletes the temporary doc", async () => {
    stubFetch((call) => {
      if (call.method === "POST") return Response.json({ id: "doc1" });
      if (call.url.includes("/export")) return new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } });
      return new Response(null, { status: 204 });
    });

    const pdf = await convertDocxToPdf(new Blob(["docx"]));

    expect(await pdf.text()).toBe("%PDF-1.7");
    expect(getAuthToken).toHaveBeenNthCalledWith(1, {
      interactive: false,
      scopes: ["https://www.googleapis.com/auth/drive.appdata", "https://www.googleapis.com/auth/drive.file"],
    });
    expect(getAuthToken).toHaveBeenLastCalledWith(expect.objectContaining({ interactive: true }));
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "DELETE"]);
    expect(calls[0].parents).toEqual(["appDataFolder"]);
    expect(calls[1].url).toContain("/files/doc1/export?mimeType=application%2Fpdf");
    expect(calls[2].url).toMatch(/\/files\/doc1$/);
  });

  it("falls back to My Drive when Drive refuses a Google Doc in appDataFolder, and skips the prompt once granted", async () => {
    getAuthToken.mockImplementation(async () => ({ token: "tok" }));
    stubFetch((call) => {
      if (call.method === "POST") return call.parents ? new Response("nope", { status: 403 }) : Response.json({ id: "doc2" });
      if (call.url.includes("/export")) return new Response("%PDF");
      return new Response(null, { status: 204 });
    });

    await convertDocxToPdf(new Blob(["docx"]));

    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.parents)).toEqual([["appDataFolder"], undefined]);
  });

  it("still deletes the temporary doc when the export fails", async () => {
    stubFetch((call) => {
      if (call.method === "POST") return Response.json({ id: "doc3" });
      if (call.url.includes("/export")) return new Response("boom", { status: 500 });
      return new Response(null, { status: 204 });
    });

    await expect(convertDocxToPdf(new Blob(["docx"]))).rejects.toThrow(/export failed \(500\)/);
    expect(calls[calls.length - 1]).toMatchObject({ method: "DELETE" });
  });

  it("reports a declined consent instead of hanging", async () => {
    getAuthToken.mockRejectedValue(new Error("The user did not approve access."));
    stubFetch(() => new Response(null));
    await expect(convertDocxToPdf(new Blob(["docx"]))).rejects.toThrow(/didn't grant/);
  });
});
