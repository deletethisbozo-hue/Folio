import { promises as fs } from "node:fs";
import path from "node:path";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { addFullPageImage } from "../server/image-pages.ts";
import { renderHtml } from "../server/pipeline/render-html.ts";
import { renderEpub } from "../server/pipeline/render-epub.ts";
import { readEpubEntries } from "../server/pipeline/epub-zip.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAQAAABWESUoAAAADElEQVR42mNk+M8AAAICAQB7CY8fAAAAAElFTkSuQmCC",
  "base64",
);

console.log("\nFull-page front matter images");
const fixture = await makeBookFixture();
try {
  const before = await loadBook(fixture.bookDir);
  const result = await addFullPageImage(fixture.bookDir, before.book.meta, {
    filename: "world-map.png",
    buffer: PNG,
    title: "World Map",
    alt: "Map of the story world",
    fit: "contain",
  });

  check("image asset is copied into the book assets folder", await fs.stat(path.join(fixture.bookDir, ...result.asset.split("/"))).then((s) => s.isFile()).catch(() => false), result.asset);
  check("image page is listed in front matter", result.entry.startsWith("frontmatter/"), result.entry);

  // Simulate a project created by an older Folio build, where the uploaded
  // filename was accidentally persisted as the image-page title.
  const legacyPagePath = path.join(fixture.bookDir, ...result.entry.split("/"));
  const legacyRaw = await fs.readFile(legacyPagePath, "utf8");
  await fs.writeFile(legacyPagePath, legacyRaw.replace(/title: .+/, 'title: "legacy-world-map.png"'), "utf8");

  const loaded = await loadBook(fixture.bookDir);
  const page = loaded.book.sections.find((section) => section.className === "image-page");
  check("image page re-ingests as front matter", page?.kind === "frontmatter");
  check("legacy filename title is neutralized on ingest", page?.title === "Full-page Image", page?.title ?? "missing");
  check("image page hides its heading and stays out of TOC", page?.showTitle === false && page?.toc === false);
  check("image page keeps semantic alt text and contain fit", Boolean(page?.markdown.includes("Map of the story world") && page.markdown.includes(".full-page-image") && page.markdown.includes(".fit-contain")));

  const html = await renderHtml(loaded.book, "html");
  check("reader preview renders the dedicated image-page section", /class="[^"]*image-page/.test(html));
  check("reader preview embeds the image resource", html.includes("data:image/png;base64"));
  check("HTML export never exposes a legacy image-page filename", !html.includes("legacy-world-map.png"));

  const epub = await renderEpub(loaded.book, "universal");
  const entries = await readEpubEntries(epub.buffer);
  const xhtml = entries
    .filter((entry) => /\.xhtml$/i.test(entry.name))
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
    .join("\n");
  check("EPUB contains the image-page structure", xhtml.includes("image-page") && xhtml.includes("full-page-image"));
  check("EPUB never exposes a legacy image-page filename as text", !xhtml.includes("legacy-world-map.png"));
  check("EPUB packages the map image", entries.some((entry) => /world-map|assets\/media|media\//i.test(entry.name) && /\.(png|jpg|jpeg)$/i.test(entry.name)), entries.filter((entry) => /\.(png|jpg|jpeg)$/i.test(entry.name)).map((entry) => entry.name).join(", "));
} finally {
  await fixture.cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
