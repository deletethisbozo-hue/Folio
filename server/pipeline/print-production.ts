import { PDFDocument } from "pdf-lib";
import { getTrim } from "../print.ts";

/** Page content stays in its original coordinate system, retaining links/destinations. */
export async function applyPrintPageBoxes(buffer: Buffer, trim: string, bleedMm = 0): Promise<Buffer> {
  if (!Number.isFinite(bleedMm) || bleedMm < 0 || bleedMm > 6) throw new Error("Bleed must be between 0 and 6 mm.");
  const paper = getTrim(trim);
  const w = paper.w * 72, h = paper.h * 72, b = bleedMm * 72 / 25.4;
  const document = await PDFDocument.load(buffer, { updateMetadata: false });
  for (const page of document.getPages()) {
    if (Math.abs(page.getWidth() - w) > 1 || Math.abs(page.getHeight() - h) > 1) throw new Error("Rendered PDF page size differs from the selected paper profile.");
    page.setMediaBox(-b, -b, w + 2 * b, h + 2 * b);
    page.setCropBox(-b, -b, w + 2 * b, h + 2 * b);
    page.setBleedBox(-b, -b, w + 2 * b, h + 2 * b);
    page.setTrimBox(0, 0, w, h);
  }
  return Buffer.from(await document.save({ useObjectStreams: true }));
}

/** 1-based pages; null is a deliberately blank padding page. */
export function bookletOrder(pageCount: number, signaturePages = 16, rtl = false): Array<[number | null, number | null]> {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Page count must be a positive integer.");
  if (!Number.isInteger(signaturePages) || signaturePages < 4 || signaturePages > 64 || signaturePages % 4) throw new Error("Signature size must be a multiple of four, from 4 to 64 pages.");
  const result: Array<[number | null, number | null]> = [];
  for (let start = 0; start < pageCount; start += signaturePages) {
    const length = signaturePages;
    const at = (index: number) => start + index <= pageCount ? start + index : null;
    for (let sheet = 0; sheet < length / 4; sheet++) {
      const front: [number | null, number | null] = [at(length - 2 * sheet), at(1 + 2 * sheet)];
      const back: [number | null, number | null] = [at(2 + 2 * sheet), at(length - 1 - 2 * sheet)];
      result.push(rtl ? [front[1], front[0]] : front, rtl ? [back[1], back[0]] : back);
    }
  }
  return result;
}

export async function createPrintSpreads(buffer: Buffer, options: { mode: "facing" | "booklet"; signaturePages?: number; rtl?: boolean }): Promise<Buffer> {
  const source = await PDFDocument.load(buffer, { updateMetadata: false });
  const output = await PDFDocument.create();
  const count = source.getPageCount();
  const first = source.getPage(0).getMediaBox();
  const trim = source.getPage(0).getTrimBox();
  const leftBleed = trim.x - first.x;
  const rightBleed = first.x + first.width - trim.x - trim.width;
  const bottomBleed = trim.y - first.y;
  const sheetWidth = 2 * trim.width + leftBleed + rightBleed;
  const order: Array<[number | null, number | null]> = options.mode === "booklet" ? bookletOrder(count, options.signaturePages, options.rtl) : [
    options.rtl ? [1, null] : [null, 1],
    ...Array.from({ length: Math.ceil((count - 1) / 2) }, (_, i): [number | null, number | null] => {
      const pair: [number | null, number | null] = [2 + i * 2, 3 + i * 2 <= count ? 3 + i * 2 : null];
      return options.rtl ? [pair[1], pair[0]] : pair;
    }),
  ];
  const pages = new Map<number, Awaited<ReturnType<typeof output.embedPage>>>();
  for (const pair of order) {
    const sheet = output.addPage([sheetWidth, first.height]);
    sheet.setCropBox(0, 0, sheetWidth, first.height);
    sheet.setBleedBox(0, 0, sheetWidth, first.height);
    sheet.setTrimBox(leftBleed, bottomBleed, 2 * trim.width, trim.height);
    for (let side = 0; side < pair.length; side++) {
      const number = pair[side];
      if (number === null) continue;
      let embedded = pages.get(number);
      if (!embedded) {
        const page = source.getPage(number - 1), box = page.getMediaBox(), pageTrim = page.getTrimBox();
        if (Math.abs(box.width - first.width) > 0.01 || Math.abs(box.height - first.height) > 0.01 || Math.abs(pageTrim.width - trim.width) > 0.01 || Math.abs(pageTrim.height - trim.height) > 0.01) throw new Error("Print spreads require uniform page and trim sizes.");
        if (!page.node.Contents()) continue;
        // Remove the two unprinted inner bleeds at the fold; retain outer bleed.
        embedded = await output.embedPage(page, { left: side === 0 ? box.x : pageTrim.x, right: side === 0 ? pageTrim.x + pageTrim.width : box.x + box.width, bottom: box.y, top: box.y + box.height });
        pages.set(number, embedded);
      }
      sheet.drawPage(embedded, { x: side === 0 ? 0 : leftBleed + trim.width, y: 0 });
    }
  }
  if (source.getTitle()) output.setTitle(source.getTitle()!);
  if (source.getAuthor()) output.setAuthor(source.getAuthor()!);
  return Buffer.from(await output.save({ useObjectStreams: true }));
}
