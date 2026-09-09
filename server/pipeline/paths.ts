import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const inferredRoot = path.basename(here) === "pipeline" ? path.resolve(here, "..", "..") : path.resolve(here, "..");
export const ROOT = process.env.FOLIO_ROOT ? path.resolve(process.env.FOLIO_ROOT) : inferredRoot;
export const RESOURCE_ROOT = process.env.FOLIO_RESOURCE_ROOT
  ? path.resolve(process.env.FOLIO_RESOURCE_ROOT)
  : ROOT;

/**
 * Resolve a runtime asset in one place. In development assets live at repo root;
 * electron-builder copies them outside app.asar for packaged builds so Pandoc
 * and Chromium can read real filesystem paths.
 */
export function resolveAppResource(...segments: string[]): string {
  return path.join(RESOURCE_ROOT, ...segments);
}

export const THEMES_DIR = resolveAppResource("themes");
export const FILTERS_DIR = resolveAppResource("server", "filters");
export const OUTPUT_DIR = path.join(ROOT, "output");
export const VENDOR_DIR = path.join(ROOT, "vendor");
export const MATTER_TEMPLATES_DIR = resolveAppResource("templates", "matter");

export function themeCss(theme: string): string {
  return path.join(THEMES_DIR, theme, "theme.css");
}

/** Shared base CSS + the theme's own CSS, in load order. */
export function themeCssFiles(theme: string): string[] {
  return [path.join(THEMES_DIR, "base.css"), themeCss(theme)];
}

export function printCss(theme: string): string {
  return path.join(THEMES_DIR, theme, "print.css");
}

/** Create a fresh temp working directory for one render. Caller cleans up. */
export async function makeTempDir(prefix = "book-formatter-"): Promise<string> {
  const base = process.env.FOLIO_WRITABLE_ROOT
    ? path.join(path.resolve(process.env.FOLIO_WRITABLE_ROOT), "temp")
    : path.join(os.tmpdir(), "folio");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
