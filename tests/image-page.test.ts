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

console.log("\nFull-page illustrations");
const fixture = await makeBookFixture();
try {
  const before = await loadBook(fixture.bookDir);

  const front = await addFullPageImage(fixture.bookDir, before.book.meta, {
    filename: "world-map.png",
    buffer: PNG,
    alt: "world-map.png",
    placement: "frontmatter",
  });
  const body = await addFullPageImage(fixture.bookDir, before.book.meta, {
    filename: "chapter-plate.png",
    buffer: PNG,
    alt: "chapter-plate.png",
    placement: "body",
  });

  check("front-matter image asset is copied", await fs.stat(path.join(fixture.bookDir, ...front.asset.split("/"))).then((s) => s.isFile()).catch(() => false), front.asset);
  check("body image asset is copied", await fs.stat(path.join(fixture.bookDir, ...body.asset.split("/"))).then((s) => s.isFile()).catch(() => false), body.asset);
  check("front-matter artwork is listed in front matter", front.entry.startsWith("frontmatter/"), front.entry);
  check("body artwork is stored in the manuscript sequence", !front.entry.includes(body.entry) && !body.entry.startsWith("frontmatter/"), body.entry);

  // Simulate a Folio <=3.2.4 page where both title and Markdown alt text could
  // retain the upload filename. Ingest must heal both without depending on CSS.
  const legacyPagePath = path.join(fixture.bookDir, ...front.entry.split("/"));
  const legacyRaw = await fs.readFile(legacyPagePath, "utf8");
  await fs.writeFile(
    legacyPagePath,
    legacyRaw
      .replace(/title: .+/, 'title: "legacy-world-map.png"')
      .replace(/!\[[^\]]*\]/, "![legacy-world-map.png]"),
    "utf8",
  );

  const loaded = await loadBook(fixture.bookDir);
  const pages = loaded.book.sections.filter((section) => section.className?.split(/\s+/).includes("image-page"));
  const frontPage = pages.find((section) => section.kind === "frontmatter");
  const bodyPage = pages.find((section) => section.kind === "chapter");

  check("front artwork re-ingests as front matter", frontPage?.kind === "frontmatter");
  check("body artwork re-ingests inside the manuscript", bodyPage?.kind === "chapter");
  check("legacy filename title is neutralized on ingest", frontPage?.title === "Full-page Image", frontPage?.title ?? "missing");
  check("full-page artwork hides headings and stays out of TOC", pages.length === 2 && pages.every((page) => page.showTitle === false && page.toc === false));
  check("legacy full-page caption is removed on ingest", Boolean(frontPage?.markdown.includes("![](") && !frontPage.markdown.includes("legacy-world-map.png")));
  check("new body full-page artwork has no caption", Boolean(bodyPage?.markdown.includes("![](") && !bodyPage.markdown.includes("chapter-plate.png")));
  check("both pages keep contain-fit semantics", pages.every((page) => page.markdown.includes(".full-page-image") && page.markdown.includes(".fit-contain")));

  const html = await renderHtml(loaded.book, "html");
  check("reader preview renders both dedicated image-page sections", (html.match(/class="[^"]*image-page/g) ?? []).length >= 2);
  check("reader preview embeds both image resources", (html.match(/data:image\/png;base64/g) ?? []).length >= 2);
  check("HTML export never exposes upload filenames", !html.includes("legacy-world-map.png") && !html.includes("chapter-plate.png"));
  check("HTML full-page artwork has no visible figcaption", !/<figcaption[^>]*>[^<]*(?:world-map|chapter-plate|legacy-world-map)/i.test(html));

  const epub = await renderEpub(loaded.book, "universal");
  const entries = await readEpubEntries(epub.buffer);
  const xhtml = entries
    .filter((entry) => /\.xhtml$/i.test(entry.name))
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
    .join("\n");
  check("EPUB contains full-page image structure", (xhtml.match(/image-page/g) ?? []).length >= 2 && xhtml.includes("full-page-image"));
  check("EPUB never exposes upload filenames as text", !xhtml.includes("legacy-world-map.png") && !xhtml.includes("chapter-plate.png"));
  check("EPUB full-page artwork has no visible filename figcaption", !/<figcaption[^>]*>[^<]*(?:world-map|chapter-plate|legacy-world-map)/i.test(xhtml));
  check("EPUB packages both artwork assets", entries.filter((entry) => /\.(png|jpg|jpeg)$/i.test(entry.name)).length >= 2);
} finally {
  await fixture.cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
