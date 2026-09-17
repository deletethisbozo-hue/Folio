import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import yaml from "js-yaml";
import type { BookMeta } from "./pipeline/types.ts";
import { addMatter, readConfig } from "./matter.ts";
import { atomicWriteUtf8 } from "./atomic-write.ts";

export type ImagePageFit = "contain" | "cover";

export interface AddImagePageOptions {
  filename: string;
  buffer: Buffer;
  title?: string;
  alt?: string;
  fit?: ImagePageFit;
}

function safeExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return ".png";
  if (ext === ".jpg" || ext === ".jpeg") return ".jpg";
  throw new Error("Full-page images must be PNG or JPEG.");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function markdownAlt(value: string): string {
  return value.replace(/([\\\]])/g, "\\$1");
}

async function existingImagePageTitles(bookDir: string): Promise<Set<string>> {
  const cfg = await readConfig(bookDir) as { frontmatter?: string[] } | null;
  const entries = Array.isArray(cfg?.frontmatter) ? cfg.frontmatter : [];
  const titles = new Set<string>();

  for (const entry of entries) {
    try {
      const file = path.join(bookDir, ...String(entry).replace(/\\/g, "/").split("/"));
      const raw = await fs.readFile(file, "utf8");
      const frontmatter = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatter) continue;
      const data = (yaml.load(frontmatter[1]) ?? {}) as Record<string, unknown>;
      const classes = String(data.class ?? "").split(/\s+/).filter(Boolean);
      if (!classes.includes("image-page")) continue;
      const title = String(data.title ?? "").trim();
      if (title) titles.add(title.toLocaleLowerCase());
    } catch {
      // A stale config entry should not prevent the user from adding artwork.
    }
  }

  return titles;
}

async function uniqueImagePageTitle(bookDir: string, requested: string): Promise<string> {
  const titles = await existingImagePageTitles(bookDir);
  if (!titles.has(requested.toLocaleLowerCase())) return requested;
  let index = 2;
  while (titles.has(`${requested} ${index}`.toLocaleLowerCase())) index += 1;
  return `${requested} ${index}`;
}

/**
 * Add a dedicated image page to front matter.
 *
 * The image is copied into book/assets and the structural page itself is still a
 * normal front-matter Markdown file, so it participates in ordering, preview,
 * EPUB and print without introducing a second private document model.
 *
 * Full-page artwork is always contain-fit. Older callers can still pass `cover`
 * for API compatibility, but Folio never crops maps, family trees or fixed art.
 * The uploaded filename is deliberately not promoted into book-facing metadata:
 * it remains a technical storage detail, not a visible page title.
 */
export async function addFullPageImage(
  bookDir: string,
  meta: BookMeta,
  options: AddImagePageOptions,
): Promise<{ entry: string; asset: string }> {
  const ext = safeExt(options.filename);
  const requestedTitle = "Full-page Image";
  const title = await uniqueImagePageTitle(bookDir, requestedTitle);
  const alt = options.alt?.trim() || "Full-page illustration";

  const assetsDir = path.join(bookDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const assetFile = `${slug(title)}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const asset = path.posix.join("assets", assetFile);
  const assetPath = path.join(assetsDir, assetFile);
  await fs.writeFile(assetPath, options.buffer);

  try {
    const { entry } = await addMatter(bookDir, meta, {
      type: "full-page-image",
      placement: "frontmatter",
      title,
    });
    const pagePath = path.join(bookDir, ...entry.split("/"));
    const content = [
      "---",
      `title: ${yamlString(title)}`,
      "class: image-page",
      "toc: false",
      "showTitle: false",
      "---",
      "",
      `![${markdownAlt(alt)}](${asset}){.full-page-image .fit-contain}`,
      "",
    ].join("\n");
    await atomicWriteUtf8(pagePath, content, "utf8");
    return { entry, asset };
  } catch (error) {
    await fs.rm(assetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
