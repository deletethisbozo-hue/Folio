import { createHash } from "node:crypto";
import path from "node:path";
import { readEpubEntries, writeEpub } from "./epub-zip.ts";

/** Deduplicate identical packaged raster/font bytes, preserving project sources. */
export async function optimizeEpubResources(source: Buffer): Promise<{ buffer: Buffer; removedAssets: number; bytesSaved: number }> {
  const unchanged = { buffer: source, removedAssets: 0, bytesSaved: 0 };
  const entries = await readEpubEntries(source);
  const packages = entries.filter((entry) => entry.name.endsWith(".opf"));
  // Interactive/multi-package EPUBs can refer to assets outside normal XML/CSS
  // links; leave those intact rather than guessing how a script resolves them.
  if (packages.length !== 1 || entries.some((entry) => /\.js$/i.test(entry.name) || /\.xhtml$/i.test(entry.name) && /<script\b|\bsrcset\s*=/i.test(Buffer.from(entry.data).toString()))) return unchanged;
  const opf = packages[0], directory = path.posix.dirname(opf.name);
  const originalOpf = Buffer.from(opf.data).toString("utf8");
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
  const items = new Map<string, { tag: string; id: string; type: string; cover: boolean }>();
  for (const match of originalOpf.matchAll(/<item\b[^>]*\/>/gi)) {
    const href = attr(match[0], "href"), id = attr(match[0], "id"), type = attr(match[0], "media-type");
    if (!href || !id || !type) continue;
    let filename: string;
    try { filename = path.posix.normalize(path.posix.join(directory, decodeURIComponent(href))); } catch { continue; }
    const cover = (attr(match[0], "properties") ?? "").split(/\s+/).includes("cover-image") || new RegExp(`<meta\\b[^>]*name=["']cover["'][^>]*content=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(originalOpf);
    items.set(filename, { tag: match[0], id, type, cover });
  }
  const canonical = new Map<string, string>(), redirects = new Map<string, string>(), ids = new Map<string, string>();
  for (const entry of entries) {
    const item = items.get(entry.name);
    if (!item || item.cover || !/\.(png|jpe?g|gif|webp|ttf|otf|woff2?)$/i.test(entry.name)) continue;
    if (/\.(ttf|otf|woff2?)$/i.test(entry.name) && entries.some((entry) => entry.name === "META-INF/encryption.xml")) continue;
    const fingerprint = item.type + ":" + createHash("sha256").update(entry.data).digest("hex");
    const previous = canonical.get(fingerprint);
    if (!previous) canonical.set(fingerprint, entry.name);
    else { redirects.set(entry.name, previous); ids.set(item.id, items.get(previous)!.id); }
  }
  if (!redirects.size) return unchanged;
  let rebuiltOpf = originalOpf;
  for (const duplicate of redirects.keys()) rebuiltOpf = rebuiltOpf.replace(items.get(duplicate)!.tag, "");
  opf.data = Buffer.from(rebuiltOpf);
  const replaceUrl = (filename: string, url: string) => {
    if (/^[a-z][a-z\d+.-]*:|^\/\/|^#/i.test(url)) return url;
    const split = url.search(/[?#]/), resource = split < 0 ? url : url.slice(0, split), suffix = split < 0 ? "" : url.slice(split);
    let absolute: string;
    try { absolute = path.posix.normalize(path.posix.join(path.posix.dirname(filename), decodeURIComponent(resource))); } catch { return url; }
    const target = redirects.get(absolute);
    return target ? path.posix.relative(path.posix.dirname(filename), target).split("/").map(encodeURIComponent).join("/") + suffix : url;
  };
  for (const entry of entries) {
    if (!/\.(?:xhtml|html|xml|opf|ncx|css)$/i.test(entry.name)) continue;
    let text = Buffer.from(entry.data).toString("utf8");
    text = text.replace(/\b(src|href|xlink:href)\s*=\s*(["'])(.*?)\2/gi, (_match, name: string, quote: string, url: string) => `${name}=${quote}${replaceUrl(entry.name, url)}${quote}`);
    text = text.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi, (_match, quote: string, url: string) => `url(${quote}${replaceUrl(entry.name, url)}${quote})`);
    if (entry === opf) text = text.replace(/\b(idref|content)\s*=\s*(["'])(.*?)\2/gi, (_match, name: string, quote: string, value: string) => `${name}=${quote}${ids.get(value) ?? value}${quote}`);
    entry.data = Buffer.from(text, "utf8");
  }
  const buffer = Buffer.from(writeEpub(entries.filter((entry) => !redirects.has(entry.name))));
  return buffer.length < source.length ? { buffer, removedAssets: redirects.size, bytesSaved: source.length - buffer.length } : unchanged;
}
