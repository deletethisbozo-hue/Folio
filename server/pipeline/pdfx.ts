import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFString, PDFHexString, decodePDFRawStream } from "pdf-lib";
import { run } from "./exec.ts";
import { makeTempDir, resolveAppResource } from "./paths.ts";

export interface PdfXReport { valid: boolean; standard: "PDF/X-3:2002"; embeddedFonts: number; errors: string[]; note: string; }
export function validateCmykProfile(profile: Buffer): void {
  if (profile.length < 128 || profile.length > 8 * 1024 * 1024 || profile.readUInt32BE(0) !== profile.length || profile.toString("ascii", 36, 40) !== "acsp" || profile.toString("ascii", 16, 20) !== "CMYK" || profile.toString("ascii", 12, 16) !== "prtr") throw new Error("Choose a valid CMYK printer ICC profile (maximum 8 MB).");
}

/** Independent inspection of concrete production requirements; no metadata-only pass. */
export async function inspectPdfX3(buffer: Buffer, expectedProfile: Buffer): Promise<PdfXReport> {
  const errors: string[] = [];
  const document = await PDFDocument.load(buffer, { updateMetadata: false });
  const context = document.context;
  const text = (value: unknown) => value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
  const info = context.trailerInfo.Info ? context.lookup(context.trailerInfo.Info) : null;
  if (!(info instanceof PDFDict) || text(info.get(PDFName.of("GTS_PDFXVersion"))) !== "PDF/X-3:2002") errors.push("The document does not declare PDF/X-3:2002.");
  if (document.isEncrypted) errors.push("PDF/X cannot be encrypted.");
  const intents = document.catalog.lookup(PDFName.of("OutputIntents"));
  let matchedProfile = false;
  if (intents instanceof PDFArray) for (let i = 0; i < intents.size(); i++) {
    const intent = intents.lookup(i);
    if (!(intent instanceof PDFDict) || intent.get(PDFName.of("S"))?.toString() !== "/GTS_PDFX") continue;
    const stream = intent.lookup(PDFName.of("DestOutputProfile"));
    if (stream instanceof PDFRawStream && Buffer.from(decodePDFRawStream(stream).decode()).equals(expectedProfile)) matchedProfile = true;
  }
  if (!matchedProfile) errors.push("The selected printer ICC profile is not embedded as the PDF/X output intent.");
  let embeddedFonts = 0;
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of("Type"))?.toString() === "/FontDescriptor") {
      if (["FontFile", "FontFile2", "FontFile3"].some((key) => object.lookup(PDFName.of(key)) instanceof PDFRawStream)) embeddedFonts++;
      else errors.push("A PDF font descriptor has no embedded font program.");
    }
    for (const key of ["CA", "ca"]) { const alpha = object.get(PDFName.of(key)); if (alpha instanceof PDFNumber && alpha.asNumber() < 1) errors.push("PDF/X-3 cannot retain live transparency."); }
    const mask = object.get(PDFName.of("SMask"));
    if (mask && mask.toString() !== "/None") errors.push("PDF/X-3 cannot retain a soft transparency mask.");
  }
  for (const page of document.getPages()) {
    const media = page.getMediaBox(), trim = page.getTrimBox(), bleed = page.getBleedBox();
    const contains = (outer: typeof media, inner: typeof media) => outer.x <= inner.x + .01 && outer.y <= inner.y + .01 && outer.x + outer.width >= inner.x + inner.width - .01 && outer.y + outer.height >= inner.y + inner.height - .01;
    if (!contains(media, bleed) || !contains(bleed, trim) || trim.width <= 0 || trim.height <= 0) errors.push("The PDF page boxes do not contain the trim and bleed correctly.");
  }
  return { valid: errors.length === 0, standard: "PDF/X-3:2002", embeddedFonts, errors: [...new Set(errors)], note: "Ghostscript conversion and Folio production checks completed. The printer must approve the selected ICC profile; these checks are not an independent ISO conformance certification." };
}

export async function defaultPdfXProfile(): Promise<Buffer> {
  return fs.readFile(process.env.FOLIO_GS_PROFILE || resolveAppResource("vendor", "ghostscript", "iccprofiles", "default_cmyk.icc"));
}

export async function convertPdfX3(source: Buffer, options: { profile: Buffer; name: string; title: string }): Promise<{ buffer: Buffer; report: PdfXReport }> {
  validateCmykProfile(options.profile);
  const executable = process.env.FOLIO_GS_BIN || resolveAppResource("vendor", "ghostscript", "bin", process.platform === "win32" ? "gswin64c.exe" : "gs");
  const version = await run(executable, ["--version"], { timeoutMs: 10_000, maxOutputBytes: 100_000 });
  if (version.code !== 0 || version.stdout.trim() !== "10.08.0") throw new Error("The pinned Ghostscript 10.08.0 publishing runtime is unavailable. Repair Folio's publishing tools.");
  const dir = await makeTempDir("pdfx-");
  const input = path.join(dir, "input.pdf"), output = path.join(dir, "output.pdf"), profile = path.join(dir, "printer.icc"), definition = path.join(dir, "pdfx.ps");
  const ps = (value: string) => `<${Buffer.from(value, "utf8").toString("hex")}>`;
  try {
    await fs.writeFile(input, source); await fs.writeFile(profile, options.profile);
    await fs.writeFile(definition, `%!PS\n[ /GTS_PDFXVersion (PDF/X-3:2002) /Title ${ps(options.title)} /Trapped /False /DOCINFO pdfmark\n` +
      `[ /_objdef {folio_icc} /type /stream /OBJ pdfmark\n[{folio_icc} << /N 4 >> /PUT pdfmark\n[{folio_icc} ${ps(profile.replace(/\\/g, "/"))} (r) file /PUT pdfmark\n` +
      `[ /_objdef {folio_intent} /type /dict /OBJ pdfmark\n[{folio_intent} << /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (Custom) /Info ${ps(options.name)} /RegistryName (http://www.color.org) /DestOutputProfile {folio_icc} >> /PUT pdfmark\n[{Catalog} << /OutputIntents [{folio_intent}] >> /PUT pdfmark\n`);
    const env = { ...process.env, PATH: resolveAppResource("java", "bin") + path.delimiter + (process.env.PATH ?? "") };
    const args = ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", `--permit-file-read=${profile}`, "-sDEVICE=pdfwrite", "-sProcessColorModel=DeviceCMYK", "-sColorConversionStrategy=CMYK", `-sOutputICCProfile=${profile}`, "-dPDFX=3", "-dCompatibilityLevel=1.3", "-dPDFACompatibilityPolicy=2", "-dEmbedAllFonts=true", "-dSubsetFonts=true", "-dPreserveAnnots=false", `-sOutputFile=${output}`, definition, input];
    const result = await run(executable, args, { env, timeoutMs: 180_000, maxOutputBytes: 4 * 1024 * 1024 });
    if (result.code !== 0 || /not permitted|not allowed|non.?conform|cannot.*PDF.?X|reverting/i.test(result.stdout + result.stderr)) throw new Error(`PDF/X conversion failed: ${(result.stderr || result.stdout).slice(-2000)}`);
    const buffer = await fs.readFile(output);
    const report = await inspectPdfX3(buffer, options.profile);
    if (!report.valid) throw new Error(`PDF/X production checks failed: ${report.errors.join("; ")}`);
    const before = await PDFDocument.load(source, { updateMetadata: false }), after = await PDFDocument.load(buffer, { updateMetadata: false });
    if (before.getPageCount() !== after.getPageCount()) throw new Error("PDF/X conversion changed the page count.");
    for (let i = 0; i < before.getPageCount(); i++) {
      const original = before.getPage(i).getTrimBox(), converted = after.getPage(i).getTrimBox();
      if (Math.abs(original.width - converted.width) > .1 || Math.abs(original.height - converted.height) > .1) throw new Error("PDF/X conversion changed the page trim size.");
    }
    const extract = async (file: string) => {
      const text = await run(executable, ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=txtwrite", "-sOutputFile=-", file], { env, timeoutMs: 90_000, maxOutputBytes: 64 * 1024 * 1024 });
      if (text.code !== 0) throw new Error("PDF/X text preservation check could not complete.");
      return text.stdout.normalize("NFC").replace(/\s/g, "");
    };
    if (await extract(input) !== await extract(output)) throw new Error("PDF/X conversion changed or rasterized the book's searchable text.");
    return { buffer, report };
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
