import path from "node:path";
import { promises as fs } from "node:fs";
import yauzl from "yauzl";
import { commandExists, run } from "../pipeline/exec.ts";
import { VENDOR_DIR, makeTempDir, resolveAppResource } from "../pipeline/paths.ts";

export interface ValidationMessage {
  severity: "error" | "warning" | "info";
  text: string;
  code?: string;
  path?: string;
  line?: number;
  column?: number;
}

export interface ValidationReport {
  tool: "epubcheck" | "builtin";
  valid: boolean;
  complete: boolean;
  messages: ValidationMessage[];
  note?: string;
}

/** Read selected text entries from an EPUB buffer (in memory). */
function readEntries(buffer: Buffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, string>();
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on("entry", (entry) => {
        if (!wanted(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return zip.readEntry();
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            result.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(result));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/** Lightweight structural checks used when EPUBCheck (Java) is unavailable. */
async function builtinCheck(buffer: Buffer): Promise<ValidationReport> {
  const messages: ValidationMessage[] = [];
  const files = await readEntries(
    buffer,
    (n) => n === "mimetype" || n === "META-INF/container.xml" || n.endsWith(".opf") || n.endsWith(".ncx") || n.endsWith("nav.xhtml"),
  );

  const mimetype = files.get("mimetype");
  if (mimetype === undefined) messages.push({ severity: "error", text: "Missing mimetype file." });
  else if (mimetype.trim() !== "application/epub+zip")
    messages.push({ severity: "error", text: `mimetype must be "application/epub+zip" (found "${mimetype.trim()}").` });

  if (!files.has("META-INF/container.xml"))
    messages.push({ severity: "error", text: "Missing META-INF/container.xml." });

  const opfName = [...files.keys()].find((n) => n.endsWith(".opf"));
  if (!opfName) {
    messages.push({ severity: "error", text: "Missing OPF package document." });
  } else {
    const opf = files.get(opfName)!;
    if (!/<dc:title[ >]/.test(opf)) messages.push({ severity: "error", text: "OPF is missing <dc:title>." });
    if (!/<dc:language[ >]/.test(opf)) messages.push({ severity: "error", text: "OPF is missing <dc:language>." });
    if (!/<dc:identifier[ >]/.test(opf)) messages.push({ severity: "error", text: "OPF is missing <dc:identifier>." });
    if (!/properties="cover-image"/.test(opf) && !/name="cover"/.test(opf))
      messages.push({ severity: "warning", text: "No cover image declared in the OPF." });
  }

  const hasNcx = [...files.keys()].some((n) => n.endsWith(".ncx"));
  const hasNav = [...files.keys()].some((n) => n.endsWith("nav.xhtml"));
  if (!hasNav) messages.push({ severity: "warning", text: "No EPUB 3 navigation document (nav.xhtml) found." });
  if (!hasNcx)
    messages.push({ severity: "info", text: "No NCX found. EPUB 3 readers use nav.xhtml; older devices prefer NCX." });

  const hasError = messages.some((m) => m.severity === "error");
  return {
    tool: "builtin",
    complete: false,
    valid: !hasError,
    messages,
    note: "Structural check only. Full EPUBCheck requires its official distribution and a Java runtime.",
  };
}

async function findEpubcheckJar(): Promise<string | null> {
  const candidates = process.env.FOLIO_EPUBCHECK_JAR
    ? [process.env.FOLIO_EPUBCHECK_JAR]
    : [resolveAppResource("vendor", "epubcheck", "epubcheck.jar"), path.join(VENDOR_DIR, "epubcheck", "epubcheck.jar"), path.join(VENDOR_DIR, "epubcheck.jar")];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* next supported location */ }
  }
  return null;
}

async function findJava(): Promise<string | null> {
  const configured = process.env.FOLIO_JAVA_BIN;
  if (configured) {
    try { await fs.access(configured); return configured; } catch { return null; }
  }
  const bundled = resolveAppResource("java", "bin", process.platform === "win32" ? "java.exe" : "java");
  try { await fs.access(bundled); return bundled; } catch { /* development PATH fallback */ }
  return await commandExists("java") ? "java" : null;
}

/** Validate the report schema before presenting it as full conformance checking. */
export function parseEpubcheckReport(report: unknown, exitCode: number): ValidationReport {
  if (!report || typeof report !== "object" || !Array.isArray((report as { messages?: unknown }).messages)) {
    return { tool: "epubcheck", complete: false, valid: false, messages: [{ severity: "error", code: "CHECKER_REPORT", text: "EPUBCheck did not produce a usable diagnostic report." }] };
  }
  const rows = (report as { messages: unknown[] }).messages;
  const messages: ValidationMessage[] = rows.map((value) => {
    if (!value || typeof value !== "object") return { severity: "error", code: "CHECKER_REPORT", text: "EPUBCheck returned an invalid diagnostic entry." };
    const row = value as Record<string, unknown>;
    if (typeof row.message !== "string" || !["FATAL", "ERROR", "WARNING", "INFO", "USAGE", "SUPPRESSED"].includes(String(row.severity))) {
      return { severity: "error", code: "CHECKER_REPORT", text: "EPUBCheck returned a malformed diagnostic entry." };
    }
    const severity = row.severity === "ERROR" || row.severity === "FATAL" ? "error" : row.severity === "WARNING" ? "warning" : "info";
    const location = Array.isArray(row.locations) && row.locations[0] && typeof row.locations[0] === "object" ? row.locations[0] as Record<string, unknown> : {};
    const code = typeof row.ID === "string" ? row.ID : undefined;
    return {
      severity,
      text: `${code ?? ""} ${typeof row.message === "string" ? row.message : "Unknown EPUBCheck diagnostic"}`.trim(),
      ...(code ? { code } : {}),
      ...(typeof location.path === "string" ? { path: location.path } : {}),
      ...(typeof location.line === "number" ? { line: location.line } : {}),
      ...(typeof location.column === "number" ? { column: location.column } : {}),
    };
  });
  const checker = (report as { checker?: { nError?: number; nFatal?: number } }).checker;
  if ((exitCode !== 0 || Number(checker?.nError ?? 0) > 0 || Number(checker?.nFatal ?? 0) > 0) && !messages.some((message) => message.severity === "error")) {
    messages.push({ severity: "error", code: "CHECKER_EXIT", text: `EPUBCheck did not confirm validity (exit ${exitCode}).` });
  }
  return { tool: "epubcheck", complete: !messages.some((message) => message.code === "CHECKER_REPORT" || message.code === "CHECKER_EXIT"), valid: !messages.some((message) => message.severity === "error"), messages };
}

export interface EpubValidationOptions { requireFullValidation?: boolean; }

/** Run the official checker when available. Never label structural fallback as complete. */
export async function validateEpub(buffer: Buffer, options: EpubValidationOptions = {}): Promise<ValidationReport> {
  const jar = await findEpubcheckJar();
  const java = jar ? await findJava() : null;
  if (!jar || !java) {
    const structural = await builtinCheck(buffer);
    if (options.requireFullValidation) {
      structural.valid = false;
      structural.messages.unshift({ severity: "error", code: "CHECKER_UNAVAILABLE", text: "Full EPUBCheck validation is unavailable. The publishing runtime needs repair." });
    }
    return structural;
  }
  const dir = await makeTempDir("epubcheck-");
  const file = path.join(dir, "book.epub");
  const jsonOut = path.join(dir, "report.json");
  try {
    await fs.writeFile(file, buffer);
    const result = await run(java, ["-Xmx512m", "-jar", jar, file, "--json", jsonOut, "--quiet"], { timeoutMs: 60_000, maxOutputBytes: 5 * 1024 * 1024 });
    if ((await fs.stat(jsonOut)).size > 32 * 1024 * 1024) throw new Error("EPUBCheck report exceeds the diagnostic size limit.");
    const report = JSON.parse(await fs.readFile(jsonOut, "utf8"));
    return parseEpubcheckReport(report, result.code);
  } catch (error) {
    return { tool: "epubcheck", complete: false, valid: false, messages: [{ severity: "error", code: "CHECKER_FAILED", text: `EPUBCheck could not complete: ${error instanceof Error ? error.message : String(error)}` }] };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
