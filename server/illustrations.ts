import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

function safeExt(filename: string): ".png" | ".jpg" {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return ".png";
  if (ext === ".jpg" || ext === ".jpeg") return ".jpg";
  throw new Error("Illustrations must be PNG or JPEG.");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "illustration";
}

export async function storeIllustration(
  bookDir: string,
  filename: string,
  buffer: Buffer,
): Promise<{ asset: string; file: string }> {
  const ext = safeExt(filename);
  const stem = slug(path.basename(filename, path.extname(filename)));
  const file = `${stem}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const assetsDir = path.join(bookDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, file), buffer);
  return { asset: path.posix.join("assets", file), file };
}

export function resolveIllustrationAsset(bookDir: string, asset: string): string {
  const normalized = asset.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^assets\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g)$/i.test(normalized)) {
    throw new Error("Invalid illustration asset path.");
  }
  return path.join(bookDir, ...normalized.split("/"));
}
