import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { BookMeta } from "./pipeline/types.ts";
import { addMatter } from "./matter.ts";
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

/**
 * Add a dedicated image page to front matter.
 *
 * The image is copied into book/assets and the structural page itself is still a
 * normal front-matter Markdown file, so it participates in ordering, preview,
 * EPUB and print without introducing a second private document model.
 */
export async function addFullPageImage(
  bookDir: string,
  meta: BookMeta,
  options: AddImagePageOptions,
): Promise<{ entry: string; asset: string }> {
  const ext = safeExt(options.filename);
  const title = options.title?.trim() || "Map";
  const alt = options.alt?.trim() || title;
  const fit: ImagePageFit = options.fit === "cover" ? "cover" : "contain";

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
      `![${markdownAlt(alt)}](${asset}){.full-page-image .fit-${fit}}`,
      "",
    ].join("\n");
    await atomicWriteUtf8(pagePath, content, "utf8");
    return { entry, asset };
  } catch (error) {
    await fs.rm(assetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
