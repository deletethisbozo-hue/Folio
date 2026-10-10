import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GlobalThemeLibraryEntry {
  id: string;
  label: string;
  baseTheme: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CustomFontRecord {
  id: string;
  family: string;
  originalName: string;
  filename: string;
  format: "truetype" | "opentype";
  createdAt: number;
}

let writeTail: Promise<void> = Promise.resolve();

function writableRoot(): string {
  return process.env.FOLIO_WRITABLE_ROOT
    ? path.resolve(process.env.FOLIO_WRITABLE_ROOT)
    : path.join(os.tmpdir(), "folio");
}

export function globalLibraryRoot(): string {
  return path.join(writableRoot(), "library");
}

function themesFile(): string {
  return path.join(globalLibraryRoot(), "themes.json");
}

function fontsDir(): string {
  return path.join(globalLibraryRoot(), "fonts");
}

function fontsIndexFile(): string {
  return path.join(globalLibraryRoot(), "fonts.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normaliseThemeEntry(value: unknown): GlobalThemeLibraryEntry | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const baseTheme = typeof value.baseTheme === "string" ? value.baseTheme.trim() : "";
  const config = isPlainObject(value.config) ? value.config : null;
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  if (!id || !label || !baseTheme || !config || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  return { id: id.slice(0, 160), label: label.slice(0, 128), baseTheme: baseTheme.slice(0, 80), config, createdAt, updatedAt };
}

function normaliseFontRecord(value: unknown): CustomFontRecord | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const family = typeof value.family === "string" ? value.family.trim() : "";
  const originalName = typeof value.originalName === "string" ? value.originalName.trim() : "";
  const filename = typeof value.filename === "string" ? value.filename.trim() : "";
  const format = value.format === "opentype" ? "opentype" : value.format === "truetype" ? "truetype" : null;
  const createdAt = Number(value.createdAt);
  if (!id || !family || !originalName || !filename || !format || !Number.isFinite(createdAt)) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.(?:ttf|otf)$/i.test(filename)) return null;
  return { id, family, originalName, filename, format, createdAt };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, file);
}

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeTail.then(operation, operation);
  writeTail = run.then(() => undefined, () => undefined);
  return run;
}

export async function readThemeLibrary(): Promise<GlobalThemeLibraryEntry[]> {
  const value = await readJson(themesFile());
  if (!Array.isArray(value)) return [];
  return value.map(normaliseThemeEntry).filter((item): item is GlobalThemeLibraryEntry => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function writeThemeLibrary(value: unknown): Promise<GlobalThemeLibraryEntry[]> {
  if (!Array.isArray(value)) throw new Error("Theme library payload must be an array.");
  if (value.length > 250) throw new Error("Theme library is too large.");
  const entries = value.map(normaliseThemeEntry);
  if (entries.some((entry) => !entry)) throw new Error("Theme library contains an invalid entry.");
  const next = entries as GlobalThemeLibraryEntry[];
  return serializeWrite(async () => {
    await atomicJson(themesFile(), next);
    return next;
  });
}

export async function readCustomFonts(): Promise<CustomFontRecord[]> {
  const value = await readJson(fontsIndexFile());
  if (!Array.isArray(value)) return [];
  return value.map(normaliseFontRecord).filter((item): item is CustomFontRecord => Boolean(item))
    .sort((a, b) => a.family.localeCompare(b.family));
}

function decodeUtf16Be(data: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < data.length; i += 2) out += String.fromCharCode(data.readUInt16BE(i));
  return out;
}

function fontFamilyFromBuffer(data: Buffer): string {
  if (data.length < 12) throw new Error("Font file is too small.");
  const signature = data.toString("ascii", 0, 4);
  const sfnt = data.readUInt32BE(0);
  if (signature !== "OTTO" && sfnt !== 0x00010000) {
    throw new Error("Use a standalone TTF or OTF font. TTC/WOFF files are not supported yet.");
  }
  const numTables = data.readUInt16BE(4);
  let nameOffset = -1;
  let nameLength = 0;
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16;
    if (entry + 16 > data.length) break;
    if (data.toString("ascii", entry, entry + 4) === "name") {
      nameOffset = data.readUInt32BE(entry + 8);
      nameLength = data.readUInt32BE(entry + 12);
      break;
    }
  }
  if (nameOffset < 0 || nameOffset + Math.min(nameLength, 6) > data.length) throw new Error("Font has no readable name table.");
  const count = data.readUInt16BE(nameOffset + 2);
  const strings = nameOffset + data.readUInt16BE(nameOffset + 4);
  const candidates: Array<{ score: number; text: string }> = [];
  for (let i = 0; i < count; i++) {
    const record = nameOffset + 6 + i * 12;
    if (record + 12 > data.length) break;
    const platform = data.readUInt16BE(record);
    const language = data.readUInt16BE(record + 4);
    const nameId = data.readUInt16BE(record + 6);
    if (nameId !== 16 && nameId !== 1) continue;
    const length = data.readUInt16BE(record + 8);
    const offset = data.readUInt16BE(record + 10);
    const start = strings + offset;
    if (start < 0 || start + length > data.length) continue;
    const raw = data.subarray(start, start + length);
    let text = "";
    try {
      text = platform === 0 || platform === 3 ? decodeUtf16Be(raw) : raw.toString("latin1");
    } catch {
      continue;
    }
    text = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const score = (nameId === 16 ? 100 : 0) + (language === 0x0409 ? 20 : 0) + (platform === 3 ? 10 : platform === 0 ? 8 : 0);
    candidates.push({ score, text });
  }
  const family = candidates.sort((a, b) => b.score - a.score)[0]?.text;
  if (!family) throw new Error("Could not determine the font family name.");
  return family.slice(0, 96);
}

function fontExtension(data: Buffer): "ttf" | "otf" {
  if (data.toString("ascii", 0, 4) === "OTTO") return "otf";
  if (data.length >= 4 && data.readUInt32BE(0) === 0x00010000) return "ttf";
  throw new Error("Use a TTF or OTF font.");
}

export async function installCustomFont(originalName: string, data: Buffer): Promise<CustomFontRecord> {
  if (!data.length || data.length > 24 * 1024 * 1024) throw new Error("Font must be between 1 byte and 24 MB.");
  const family = fontFamilyFromBuffer(data);
  const ext = fontExtension(data);
  const digest = createHash("sha256").update(data).digest("hex").slice(0, 20);
  const id = "custom-" + digest;
  const filename = id + "." + ext;
  const format = ext === "otf" ? "opentype" : "truetype";
  const record: CustomFontRecord = { id, family, originalName: path.basename(originalName).slice(0, 180), filename, format, createdAt: Date.now() };

  return serializeWrite(async () => {
    await fs.mkdir(fontsDir(), { recursive: true });
    await fs.writeFile(path.join(fontsDir(), filename), data);
    const current = await readCustomFonts();
    const replaced = current.filter((font) => font.family.localeCompare(family, undefined, { sensitivity: "accent" }) !== 0 && font.id !== id);
    for (const font of current) {
      if (font.family.localeCompare(family, undefined, { sensitivity: "accent" }) === 0 && font.filename !== filename) {
        await fs.rm(path.join(fontsDir(), font.filename), { force: true });
      }
    }
    const next = [...replaced, record].sort((a, b) => a.family.localeCompare(b.family));
    await atomicJson(fontsIndexFile(), next);
    return record;
  });
}

export async function customFontById(id: string): Promise<CustomFontRecord | null> {
  return (await readCustomFonts()).find((font) => font.id === id) ?? null;
}

export async function customFontByFamily(family: string): Promise<CustomFontRecord | null> {
  return (await readCustomFonts()).find((font) => font.family === family) ?? null;
}

export function customFontPath(font: CustomFontRecord): string {
  return path.join(fontsDir(), font.filename);
}
