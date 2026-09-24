import { describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { bakePictureShapes, type RasterizeRequest } from "@/features/cv-template/docx-shapes";
import { adaptedCvFileName } from "@/features/cv-template/adapt";
import type { Profile } from "@/types/profile";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

/** The picture markup Word writes for Picture Format → Crop to Shape (trimmed from a real CV). */
function picture(geometry: string, srcRect = '<a:srcRect l="41" r="41"/>'): string {
  return (
    '<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="2799908" cy="1873012"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:blipFill><a:blip r:embed="rId7" cstate="print"/>' +
    srcRect +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2986917" cy="1998113"/></a:xfrm>' +
    geometry +
    '<a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
  );
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const PNG = new Uint8Array([137, 80, 78, 71, 9, 9]);

function makeDocx(body: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>',
    ),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${NS}><w:body>${body}</w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>' +
        "</Relationships>",
    ),
    "word/media/image1.jpeg": JPEG,
  });
}

describe("bakePictureShapes", () => {
  it("bakes a Crop-to-Shape rounded rectangle into a PNG and makes the picture a plain rect", async () => {
    const rasterize = vi.fn(async (_: RasterizeRequest) => PNG);
    const out = unzipSync(await bakePictureShapes(makeDocx(picture('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>')), rasterize));

    const request = rasterize.mock.calls[0][0];
    expect(new Uint8Array(await request.image.arrayBuffer())).toEqual(JPEG);
    expect(request.crop).toEqual({ l: 0.00041, t: 0, r: 0.00041, b: 0 });
    expect(request.aspect).toBeCloseTo(2986917 / 1998113);
    expect(request.shape).toEqual({ kind: "roundRect", adj: 16667 }); // Word's default corner

    const document = strFromU8(out["word/document.xml"]);
    expect(document).toContain('r:embed="rIdFillerShape1"');
    expect(document).toContain('prst="rect"');
    expect(document).not.toContain("srcRect"); // the crop is in the PNG now
    expect(document.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(out["word/media/filler-shape-1.png"]).toEqual(PNG);
    expect(out["word/media/image1.jpeg"]).toEqual(JPEG); // original left in place
    expect(strFromU8(out["word/_rels/document.xml.rels"])).toContain(
      'Id="rIdFillerShape1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/filler-shape-1.png"',
    );
    expect(strFromU8(out["[Content_Types].xml"])).toContain('Extension="png" ContentType="image/png"');
  });

  it("reads a custom corner radius and circular crops", async () => {
    const rasterize = vi.fn(async (_: RasterizeRequest) => PNG);
    await bakePictureShapes(
      makeDocx(
        picture('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>') +
          picture('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>', ""),
      ),
      rasterize,
    );
    expect(rasterize.mock.calls.map(([r]) => r.shape)).toEqual([{ kind: "roundRect", adj: 30000 }, { kind: "ellipse" }]);
    expect(rasterize.mock.calls[1][0].crop).toEqual({ l: 0, t: 0, r: 0, b: 0 });
  });

  it("returns the input untouched when no picture has a mask, or the image can't be decoded", async () => {
    const plain = makeDocx(picture('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'));
    const rasterize = vi.fn(async (_: RasterizeRequest) => PNG);
    expect(await bakePictureShapes(plain, rasterize)).toBe(plain);
    expect(rasterize).not.toHaveBeenCalled();

    const emf = makeDocx(picture('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'));
    expect(await bakePictureShapes(emf, async () => Promise.reject(new Error("undecodable")))).toBe(emf);
  });
});

describe("adaptedCvFileName", () => {
  const profile = { fullName: "Jane Doe", firstName: "", lastName: "" } as Profile;

  it("names the file after the company", () => {
    expect(adaptedCvFileName(profile, "pdf", "Staffbase")).toBe("Jane Doe CV - Staffbase.pdf");
    expect(adaptedCvFileName(profile, "docx")).toBe("Jane Doe CV.docx");
  });

  it("strips characters a download file name can't hold", () => {
    expect(adaptedCvFileName(profile, "pdf", 'AT&T / "Labs": R&D?')).toBe("Jane Doe CV - AT&T Labs R&D.pdf");
  });
});
