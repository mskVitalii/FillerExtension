import { strFromU8, strToU8, zipSync } from "fflate";
import { isTextPart, parseXml, readParts, serializeXml } from "./docx";

/**
 * Word's "Crop to Shape" (a photo with rounded corners or cut into a circle)
 * is a mask on the picture — `<a:prstGeom prst="roundRect">` over an
 * ordinary rectangular JPEG. Google Docs ignores that mask on import, so the
 * PDF it exports shows the photo square. Before conversion, this bakes the
 * mask into the image itself: the (cropped) photo is redrawn into a PNG with
 * transparent corners, the picture points at that PNG, and its shape becomes
 * a plain `rect`. Only the copy sent to Google Docs gets this — the .docx the
 * user downloads keeps Word's own mask.
 */

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

/** The masks Google Docs drops that are worth baking — a photo is practically always one of these. */
export type PictureShape = { kind: "roundRect"; adj: number } | { kind: "ellipse" };

export interface RasterizeRequest {
  image: Blob;
  /** Fractions (0–1) cut off each side of the source image — `<a:srcRect>`. */
  crop: { l: number; t: number; r: number; b: number };
  /** Displayed shape's width / height; the source is stretched to it, as `<a:stretch><a:fillRect/>` does. */
  aspect: number;
  shape: PictureShape;
}

export type Rasterize = (request: RasterizeRequest) => Promise<Uint8Array>;

/** Longest side of a baked photo. A CV photo prints at a few cm; this keeps the PNG from ballooning the upload. */
const MAX_SIDE = 1600;

/** Canvas implementation (Side Panel). Tests pass their own — jsdom has no canvas. */
export const canvasRasterize: Rasterize = async ({ image, crop, aspect, shape }) => {
  const bitmap = await createImageBitmap(image);
  try {
    const sx = bitmap.width * crop.l;
    const sy = bitmap.height * crop.t;
    const sw = bitmap.width * (1 - crop.l - crop.r);
    const sh = bitmap.height * (1 - crop.t - crop.b);
    // Output at the source's own resolution (never upscaled), in the shape's proportions.
    let width = Math.min(sw, MAX_SIDE);
    let height = width / aspect;
    if (height > MAX_SIDE) {
      height = MAX_SIDE;
      width = height * aspect;
    }
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context.");
    ctx.beginPath();
    if (shape.kind === "ellipse") {
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else {
      // DrawingML roundRect: corner radius = min(w, h) × adj / 100000, adj pinned to [0, 50000].
      const adj = Math.min(Math.max(shape.adj, 0), 50000);
      ctx.roundRect(0, 0, width, height, (Math.min(width, height) * adj) / 100000);
    }
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
};

function child(parent: Element | null | undefined, ns: string, localName: string): Element | null {
  if (!parent) return null;
  return Array.from(parent.children).find((c) => c.namespaceURI === ns && c.localName === localName) ?? null;
}

function pictureShape(prstGeom: Element): PictureShape | null {
  const prst = prstGeom.getAttribute("prst");
  if (prst === "ellipse") return { kind: "ellipse" };
  if (prst !== "roundRect") return null;
  const gd = Array.from(prstGeom.getElementsByTagNameNS(A_NS, "gd")).find((g) => g.getAttribute("name") === "adj");
  const val = /^val\s+(-?\d+)$/.exec(gd?.getAttribute("fmla")?.trim() ?? "");
  return { kind: "roundRect", adj: val ? Number(val[1]) : 16667 };
}

/** `<a:srcRect l="41" r="41"/>` — thousandths of a percent. Negative values (padding) aren't bakeable. */
function cropOf(srcRect: Element | null): RasterizeRequest["crop"] | null {
  const side = (name: string) => Number(srcRect?.getAttribute(name) ?? 0) / 100000;
  const crop = { l: side("l"), t: side("t"), r: side("r"), b: side("b") };
  if (Object.values(crop).some((v) => !Number.isFinite(v) || v < 0)) return null;
  if (crop.l + crop.r >= 1 || crop.t + crop.b >= 1) return null;
  return crop;
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

/** Relationship targets are relative to the part's folder (`media/image1.jpeg` → `word/media/image1.jpeg`), or absolute from the package root. */
function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = partPath.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

function ensurePngContentType(parts: Record<string, Uint8Array>): void {
  const path = "[Content_Types].xml";
  const xml = strFromU8(parts[path]);
  const doc = parseXml(xml);
  const defaults = Array.from(doc.getElementsByTagNameNS(CT_NS, "Default"));
  if (defaults.some((d) => d.getAttribute("Extension")?.toLowerCase() === "png")) return;
  const entry = doc.createElementNS(CT_NS, "Default");
  entry.setAttribute("Extension", "png");
  entry.setAttribute("ContentType", "image/png");
  doc.documentElement.insertBefore(entry, doc.documentElement.firstChild);
  parts[path] = strToU8(serializeXml(doc, xml));
}

/**
 * Returns the .docx with every rounded/elliptical picture mask baked into
 * its image (see the module comment), or the input bytes unchanged when
 * there's nothing to bake. A picture that can't be baked — an image format
 * the browser can't decode (EMF/WMF), an unusual crop — is left as it was.
 */
export async function bakePictureShapes(bytes: Uint8Array, rasterize: Rasterize = canvasRasterize): Promise<Uint8Array> {
  const parts = readParts(bytes);
  let baked = 0;
  for (const partPath of Object.keys(parts).filter(isTextPart)) {
    const xml = strFromU8(parts[partPath]);
    if (!/prst="(roundRect|ellipse)"/.test(xml)) continue;
    const relsPath = relsPathFor(partPath);
    if (!parts[relsPath]) continue;
    const relsXml = strFromU8(parts[relsPath]);
    const rels = parseXml(relsXml);
    const relById = new Map(
      Array.from(rels.getElementsByTagNameNS(PKG_REL_NS, "Relationship")).map((r) => [r.getAttribute("Id") ?? "", r]),
    );

    const doc = parseXml(xml);
    let partChanged = false;
    for (const pic of Array.from(doc.getElementsByTagNameNS(PIC_NS, "pic"))) {
      const spPr = child(pic, PIC_NS, "spPr");
      const prstGeom = child(spPr, A_NS, "prstGeom");
      const shape = prstGeom && pictureShape(prstGeom);
      if (!shape) continue;
      const blipFill = child(pic, PIC_NS, "blipFill");
      const blip = child(blipFill, A_NS, "blip");
      const srcRect = child(blipFill, A_NS, "srcRect");
      const ext = child(child(spPr, A_NS, "xfrm"), A_NS, "ext");
      const crop = cropOf(srcRect);
      const cx = Number(ext?.getAttribute("cx"));
      const cy = Number(ext?.getAttribute("cy"));
      const rel = relById.get(blip?.getAttributeNS(R_NS, "embed") ?? "");
      if (!blip || !crop || !(cx > 0 && cy > 0) || !rel || rel.getAttribute("TargetMode") === "External") continue;
      const media = parts[resolveTarget(partPath, rel.getAttribute("Target") ?? "")];
      if (!media) continue;

      let png: Uint8Array;
      try {
        png = await rasterize({ image: new Blob([new Uint8Array(media)]), crop, aspect: cx / cy, shape });
      } catch {
        continue;
      }
      baked += 1;
      const mediaPath = `word/media/filler-shape-${baked}.png`;
      parts[mediaPath] = png;
      const relId = `rIdFillerShape${baked}`;
      const newRel = rels.createElementNS(PKG_REL_NS, "Relationship");
      newRel.setAttribute("Id", relId);
      newRel.setAttribute("Type", IMAGE_REL);
      // Every text part lives directly in word/, so its rels resolve relative to word/.
      newRel.setAttribute("Target", mediaPath.slice("word/".length));
      rels.documentElement.appendChild(newRel);

      blip.setAttributeNS(R_NS, "r:embed", relId);
      srcRect?.remove(); // the crop is in the PNG now
      prstGeom.setAttribute("prst", "rect");
      for (const avLst of Array.from(prstGeom.children)) prstGeom.removeChild(avLst);
      prstGeom.appendChild(doc.createElementNS(A_NS, "a:avLst"));
      partChanged = true;
    }
    if (partChanged) {
      parts[partPath] = strToU8(serializeXml(doc, xml));
      parts[relsPath] = strToU8(serializeXml(rels, relsXml));
    }
  }
  if (baked === 0) return bytes;
  ensurePngContentType(parts);
  return zipSync(parts, { level: 6 });
}
