import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { BookMeta } from "./pipeline/types.ts";
import { addMatter, addStandaloneChapterPage } from "./matter.ts";
import { atomicWriteUtf8 } from "./atomic-write.ts";
import { normalizeImageUpload } from "./svg-images.ts";

export type ImagePageFit = "contain" | "cover";
export type ImagePagePlacement = "frontmatter" | "body";

export interface AddImagePageOptions {
  filename: string;
  buffer: Buffer;
  mime?: string;
  title?: string;
  alt?: string;
  fit?: ImagePageFit;
  placement?: ImagePagePlacement;
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

function imagePageMarkdown(asset: string): string {
  // Intentionally blank alt text. Pandoc promotes Markdown image alt text into
  // a visible figure caption, which previously leaked the uploaded filename
  // onto full-page artwork. These pages are fixed decorative/structural art and
  // must never acquire a visible caption.
  return `![](${asset}){.full-page-image .fit-contain}`;
}

/**
 * Add a dedicated full-page illustration either to front matter or to the
 * manuscript sequence.
 *
 * The image is copied into book/assets and the structural page remains ordinary
 * Markdown with class: image-page, so preview, EPUB and print share one model.
 * Full-page artwork is always contain-fit and never exposes the source filename
 * as book-facing metadata or a figure caption.
 */
export async function addFullPageImage(
  bookDir: string,
  meta: BookMeta,
  options: AddImagePageOptions,
): Promise<{ entry: string; asset: string; placement: ImagePagePlacement }> {
  const normalized = normalizeImageUpload(options.filename, options.mime ?? "", options.buffer, "Full-page images");
  const ext = normalized.ext;
  const title = "Full-page Image";
  const placement: ImagePagePlacement = options.placement === "body" ? "body" : "frontmatter";

  const assetsDir = path.join(bookDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const assetFile = `${slug(title)}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const asset = path.posix.join("assets", assetFile);
  const assetPath = path.join(assetsDir, assetFile);
  await fs.writeFile(assetPath, normalized.buffer);

  const content = [
    "---",
    `title: ${yamlString(title)}`,
    "class: image-page",
    "toc: false",
    "showTitle: false",
    "---",
    "",
    imagePageMarkdown(asset),
    "",
  ].join("\n");

  try {
    let entry: string;
    if (placement === "body") {
      ({ entry } = await addStandaloneChapterPage(bookDir, meta, {
        filenameStem: "full-page-image",
        content,
      }));
    } else {
      const added = await addMatter(bookDir, meta, {
        type: "full-page-image",
        placement: "frontmatter",
        title,
      });
      entry = added.entry;
      const pagePath = path.join(bookDir, ...entry.split("/"));
      await atomicWriteUtf8(pagePath, content, "utf8");
    }
    return { entry, asset, placement };
  } catch (error) {
    await fs.rm(assetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
