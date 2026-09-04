import { beforeEach, describe, expect, it } from "vitest";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { loadFixture } from "./load-fixture";

function makeFile(name = "cv.pdf") {
  return new File(["%PDF-1.4 fake"], name, { type: "application/pdf" });
}

describe("injectFileIntoPage against the manual test page", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("fills the page's one (unlabelled) file input even with no matching label — it's the only candidate", () => {
    const result = injectFileIntoPage(makeFile(), null, "cv");
    expect(result.nativeInputs).toBe(1);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.files?.[0]?.name).toBe("cv.pdf");
  });

  it("dispatches a drop on the dropzone labelled for a CV", () => {
    const zone = document.getElementById("dropzone")!;
    const seen: string[] = [];
    zone.addEventListener("drop", () => seen.push("drop"));

    const result = injectFileIntoPage(makeFile(), null, "cv");
    expect(result.dropZones).toBe(1);
    expect(seen).toEqual(["drop"]);
  });

  it("does not spray the file across unrelated file inputs when several exist and none match the kind", () => {
    // Simulate a page with a second, unrelated upload field (e.g. an ID
    // scan) alongside the CV one — the regression this guards is the old
    // "fill every input[type=file] on the page" behavior.
    const idUpload = document.createElement("input");
    idUpload.type = "file";
    idUpload.setAttribute("aria-label", "Upload a photo ID");
    document.body.append(idUpload);

    const result = injectFileIntoPage(makeFile(), null, "cv");
    // Neither input is CV-labelled once there's more than one candidate —
    // safer to fill nothing than guess wrong.
    expect(result.nativeInputs).toBe(0);
    expect(idUpload.files?.length ?? 0).toBe(0);
  });

  it("targets a CV-labelled input over an unrelated one when both exist", () => {
    const idUpload = document.createElement("input");
    idUpload.type = "file";
    idUpload.setAttribute("aria-label", "Upload a photo ID");
    document.body.append(idUpload);

    const cvUpload = document.createElement("input");
    cvUpload.type = "file";
    cvUpload.setAttribute("aria-label", "Upload your CV / Resume");
    document.body.append(cvUpload);

    const result = injectFileIntoPage(makeFile(), null, "cv");
    expect(result.nativeInputs).toBe(1);
    expect(cvUpload.files?.[0]?.name).toBe("cv.pdf");
    expect(idUpload.files?.length ?? 0).toBe(0);
  });
});
