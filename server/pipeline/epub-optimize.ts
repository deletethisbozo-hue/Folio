import { createHash } from "node:crypto";
import path from "node:path";
import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from "@xmldom/xmldom";
import { parse as parseCss, walk as walkCss, generate as generateCss } from "css-tree";
import { readEpubEntries, writeEpub, type ZipEntry } from "./epub-zip.ts";

/** Deduplicate packaged bytes without treating book prose/code as URL syntax. */
export async function optimizeEpubResources(source: Buffer): Promise<{ buffer: Buffer; removedAssets: number; bytesSaved: number }> {
  const unchanged = { buffer: source, removedAssets: 0, bytesSaved: 0 };
  const entries = await readEpubEntries(source);
  const packages = entries.filter((entry) => entry.name.endsWith(".opf"));
  if (packages.length !== 1 || entries.some((entry) => /\.js$/i.test(entry.name))) return unchanged;
  const documents = new Map<ZipEntry, XmlDocument>();
  const elements = (document: XmlDocument) => Array.from(document.getElementsByTagName("*"));
  try {
    for (const entry of entries.filter((entry) => /\.(?:xhtml|html|xml|opf|ncx)$/i.test(entry.name))) {
      const document = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(Buffer.from(entry.data).toString(), "application/xml");
      if (elements(document).some((element) => element.localName === "script" || element.hasAttribute("srcset"))) return unchanged;
      documents.set(entry, document);
    }
  } catch { return unchanged; } // Unsupported input stays byte-for-byte; EPUBCheck still validates it.
  const opf = packages[0], opfDocument = documents.get(opf)!;
  const directory = path.posix.dirname(opf.name);
  const coverIds = new Set(elements(opfDocument).filter((element) => element.localName === "meta" && element.getAttribute("name") === "cover").map((element) => element.getAttribute("content")));
  const items = new Map<string, { element: XmlElement; id: string; type: string; cover: boolean }>();
  for (const element of elements(opfDocument).filter((element) => element.localName === "item" && element.parentNode?.localName === "manifest")) {
    const href = element.getAttribute("href"), id = element.getAttribute("id"), type = element.getAttribute("media-type");
    if (!href || !id || !type) continue;
    let filename: string;
    try { filename = path.posix.normalize(path.posix.join(directory, decodeURIComponent(href))); } catch { continue; }
    items.set(filename, { element, id, type, cover: (element.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image") || coverIds.has(id) });
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
  for (const duplicate of redirects.keys()) { const element = items.get(duplicate)!.element; element.parentNode?.removeChild(element); }
  const replaceUrl = (filename: string, url: string) => {
    if (/^[a-z][a-z\d+.-]*:|^\/\/|^#/i.test(url)) return url;
    const split = url.search(/[?#]/), resource = split < 0 ? url : url.slice(0, split), suffix = split < 0 ? "" : url.slice(split);
    let absolute: string;
    try { absolute = path.posix.normalize(path.posix.join(path.posix.dirname(filename), decodeURIComponent(resource))); } catch { return url; }
    const target = redirects.get(absolute);
    return target ? path.posix.relative(path.posix.dirname(filename), target).split("/").map(encodeURIComponent).join("/") + suffix : url;
  };
  const css = (filename: string, text: string, context: "stylesheet" | "declarationList") => {
    const ast = parseCss(text, { context, parseCustomProperty: true, onParseError(error) { throw error; } });
    walkCss(ast, (node) => {
      if (node.type === "Url") node.value = replaceUrl(filename, node.value);
      else if (node.type === "Raw" && /url\s*\(/i.test(node.value)) throw new Error("Unsupported CSS resource syntax");
    });
    return generateCss(ast);
  };
  try {
    for (const entry of entries) {
      if (entry.name.endsWith(".css")) entry.data = Buffer.from(css(entry.name, Buffer.from(entry.data).toString(), "stylesheet"));
      const document = documents.get(entry);
      if (!document) continue;
      for (const element of elements(document)) {
        for (const attribute of Array.from(element.attributes)) {
          if (["src", "href", "xlink:href"].includes(attribute.name)) attribute.value = replaceUrl(entry.name, attribute.value);
          else if (attribute.name === "style") attribute.value = css(entry.name, attribute.value, "declarationList");
          else if (entry === opf && (attribute.name === "idref" || attribute.name === "content" && element.localName === "meta" && element.getAttribute("name") === "cover")) attribute.value = ids.get(attribute.value) ?? attribute.value;
          else if (entry === opf && attribute.name === "refines" && attribute.value.startsWith("#")) attribute.value = "#" + (ids.get(attribute.value.slice(1)) ?? attribute.value.slice(1));
        }
        if (element.localName === "style") element.textContent = css(entry.name, element.textContent ?? "", "stylesheet");
      }
      entry.data = Buffer.from(new XMLSerializer().serializeToString(document));
    }
  } catch { return unchanged; }
  const buffer = Buffer.from(writeEpub(entries.filter((entry) => !redirects.has(entry.name))));
  return buffer.length < source.length ? { buffer, removedAssets: redirects.size, bytesSaved: source.length - buffer.length } : unchanged;
}
