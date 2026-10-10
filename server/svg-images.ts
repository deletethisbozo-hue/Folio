import path from "node:path";

export function isSvgUpload(filename: string, mime = ""): boolean {
  return path.extname(filename).toLowerCase() === ".svg" || /^image\/svg\+xml$/i.test(mime);
}

export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  let source = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!/^<\?xml\b[\s\S]*?\?>\s*/i.test(source) && !/^<svg\b/i.test(source)) {
    if (!/^\s*<svg\b/i.test(source)) throw new Error("That SVG does not contain a valid <svg> root.");
  }
  source = source.replace(/^<\?xml\b[\s\S]*?\?>\s*/i, "");
  if (!/^<svg\b/i.test(source) || !/<\/svg>\s*$/i.test(source)) {
    throw new Error("That SVG does not contain a complete <svg> document.");
  }

  // SVG is displayed as an image, never as an active mini-webpage.
  source = source
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!ENTITY[\s\S]*?>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z0-9:_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|xlink:href)\s*=\s*("|')(?!(?:#))[^"']*\1/gi, "")
    .replace(/\s+style\s*=\s*("|')([^"']*(?:javascript:|https?:|file:|url\s*\()[^"']*)\1/gi, "");

  // CSS imports / remote URL fetches inside <style> are not needed for book art.
  source = source.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_whole, css: string) => {
    const safe = css.replace(/@import[^;]+;?/gi, "").replace(/url\s*\((?!\s*['"]?#)[^)]+\)/gi, "none");
    return safe.trim() ? `<style>${safe}</style>` : "";
  });

  if (/\b(?:javascript:|file:)/i.test(source)) {
    throw new Error("That SVG contains an unsafe external or executable reference.");
  }
  return Buffer.from(source, "utf8");
}

export function normalizeImageUpload(
  filename: string,
  mime: string,
  buffer: Buffer,
  label: string,
): { ext: ".png" | ".jpg" | ".svg"; buffer: Buffer } {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png" && /^image\/png$/i.test(mime || "image/png")) return { ext: ".png", buffer };
  if ((ext === ".jpg" || ext === ".jpeg") && /^image\/jpeg$/i.test(mime || "image/jpeg")) return { ext: ".jpg", buffer };
  if (isSvgUpload(filename, mime)) return { ext: ".svg", buffer: sanitizeSvgBuffer(buffer) };
  throw new Error(`${label} must be PNG, JPEG or SVG.`);
}
