/* Drop cap seating: the top of the capital must line up with the top of the
   first line of body text, in every theme and at both cap sizes. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getBrowser, closeBrowser } from "../server/pipeline/render-pdf.ts";
import { alignDropCaps } from "../server/pipeline/dropcap.ts";
import { composeProfessionalParagraphs } from "../server/pipeline/compositor.ts";
import { THEMES_DIR } from "../server/pipeline/paths.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const base = await fs.readFile(path.join(THEMES_DIR, "base.css"), "utf8");
const printBase = await fs.readFile(path.join(THEMES_DIR, "print-base.css"), "utf8");

// Filler, not from any book. It only has to be long enough that the cap has
// three real lines to sit against and the wrap behaves like a finished page.
const BODY =
  "he clock in the hallway struck an hour that does not exist, and nobody in the house " +
  "thought to mention it. The rest of this paragraph is here so the capital has real lines " +
  "beside it and the text wraps the way it will on a finished page rather than in a toy fixture. " +
  "There is deliberately enough additional prose here to continue beyond even the largest cap, " +
  "so the test can prove the first line after the initial returns to the full text measure.";

async function pageHtml(theme: string, print: boolean, printSize?: string): Promise<string> {
  const themeCss = await fs.readFile(path.join(THEMES_DIR, theme, "theme.css"), "utf8");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${base}
${themeCss}
${print ? printBase : ""}
${printSize ? `:root{--folio-dropcap-print-size:${printSize};}` : ""}
body { width: 4.75in; margin: 0; padding: 20px; }
</style></head><body class="book-formatter"><main class="book">
<section class="level1 chapter"><h1>Chapter 3</h1>
<p><span class="dropcap">T</span>${BODY}</p>
</section></main></body></html>`;
}

const browser = await getBrowser();
const p = await browser.newPage();

/** Ink-top delta between the cap and the first body line, in px. */
async function measure(): Promise<{ delta: number; font: string; capPx: number; linesBeside: number }> {
  return p.evaluate(() => {
    const cap = document.querySelector<HTMLElement>(".dropcap")!;
    const para = cap.closest("p")!;
    const cv = document.createElement("canvas").getContext("2d")!;

    const csC = getComputedStyle(cap);
    cv.font = `${csC.fontStyle} ${csC.fontWeight} ${csC.fontSize} ${csC.fontFamily}`;
    const mC = cv.measureText(cap.textContent!);
    const ascC = mC.fontBoundingBoxAscent;
    const descC = mC.fontBoundingBoxDescent;
    const lhC = csC.lineHeight === "normal" ? ascC + descC : parseFloat(csC.lineHeight);
    const rC = cap.getBoundingClientRect();
    const inkC =
      rC.top + parseFloat(csC.paddingTop || "0") + (lhC - (ascC + descC)) / 2 + ascC - mC.actualBoundingBoxAscent;

    const it = document.createNodeIterator(para, NodeFilter.SHOW_TEXT);
    let body: Text | null = null;
    let n: Node | null;
    while ((n = it.nextNode())) {
      const t = n as Text;
      if (cap.contains(t)) continue;
      if (t.data.trim().length > 2) {
        body = t;
        break;
      }
    }
    const rg = document.createRange();
    rg.setStart(body!, 0);
    rg.setEnd(body!, 20);
    const rects = rg.getClientRects();
    const rB = rects[0];

    const csB = getComputedStyle(para);
    cv.font = `${csB.fontStyle} ${csB.fontWeight} ${csB.fontSize} ${csB.fontFamily}`;
    const mB = cv.measureText("Hh");
    const ascB = mB.fontBoundingBoxAscent;
    const descB = mB.fontBoundingBoxDescent;
    const lhB = csB.lineHeight === "normal" ? ascB + descB : parseFloat(csB.lineHeight);
    const inkB = rB.top + (lhB - (ascB + descB)) / 2 + ascB - mB.actualBoundingBoxAscent;

    // How many body lines sit alongside the cap — the seat shouldn't change.
    const all = document.createRange();
    all.selectNodeContents(para);
    const capBottom = rC.bottom;
    const linesBeside = Array.from(all.getClientRects()).filter((r) => r.top < capBottom - 1 && r.left > rC.right - 1).length;

    return {
      delta: Math.round((inkC - inkB) * 100) / 100,
      // getComputedStyle returns the SPECIFIED stack, not the family that
      // actually resolved, so the ratio of ink ascent to font ascent is the
      // honest way to show these themes really do render in different faces.
      font: `cap/asc ${(mC.actualBoundingBoxAscent / ascC).toFixed(3)}`,
      capPx: Math.round(parseFloat(csC.fontSize) * 10) / 10,
      linesBeside,
    };
  });
}

for (const print of [false, true]) {
  console.log(`\n${print ? "Print / reading PDF (3-line cap)" : "EPUB & preview (2-line cap)"}`);
  for (const theme of ["folio", "modern", "decorative"]) {
    await p.setContent(await pageHtml(theme, print), { waitUntil: "load" });
    const before = await measure();
    const adjusted = await alignDropCaps(p);
    const after = await measure();
    console.log(
      `    ${theme.padEnd(11)} ${after.font.padEnd(20)} ${String(after.capPx).padStart(5)}px  ` +
        `before ${String(before.delta).padStart(7)}px → after ${String(after.delta).padStart(6)}px  (${after.linesBeside} lines beside)`,
    );
    check(`${theme} seats within half a pixel`, Math.abs(after.delta) <= 0.5, `${after.delta}px`);
    check(`   ${theme} still seats ${print ? 3 : 2}+ lines beside the cap`, after.linesBeside >= (print ? 3 : 2), String(after.linesBeside));
    if (Math.abs(before.delta) > 0.5) check(`   ${theme} was actually corrected`, adjusted === 1);
  }
}


console.log("\nPrint compositor drop-cap size matrix");
const printSizes = [
  ["theme", undefined],
  ["small", "5em"],
  ["medium", "6em"],
  ["large", "7em"],
  ["xlarge", "8em"],
] as const;

for (const [label, size] of printSizes) {
  await p.setContent(await pageHtml("decorative", true, size), { waitUntil: "load" });
  await p.evaluate(async () => { try { await document.fonts.ready; } catch {} });
  await alignDropCaps(p);
  await composeProfessionalParagraphs(p, { typography: {} } as any);

  const geometry = await p.evaluate(() => {
    const cap = document.querySelector<HTMLElement>(".dropcap");
    const para = cap?.closest<HTMLElement>("p");
    if (!cap || !para) return null;

    const capStyle = getComputedStyle(cap);
    const capRect = cap.getBoundingClientRect();
    const canvas = document.createElement("canvas").getContext("2d");
    if (!canvas) return null;
    canvas.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${capStyle.fontSize} ${capStyle.fontFamily}`;
    const metrics = canvas.measureText(cap.textContent || "H");
    const asc = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
    const desc = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
    const lineHeight = capStyle.lineHeight === "normal"
      ? asc + desc
      : parseFloat(capStyle.lineHeight) || asc + desc;
    const baseline =
      capRect.top +
      parseFloat(capStyle.paddingTop || "0") +
      (lineHeight - (asc + desc)) / 2 +
      asc;
    const inkTop = baseline - metrics.actualBoundingBoxAscent;
    const inkBottom = baseline + metrics.actualBoundingBoxDescent;

    const capLines = Number(cap.dataset.folioDropcapLines || para.dataset.folioDropcapLines || 0);
    const wrappedLines = Number(cap.dataset.folioDropcapWrappedLines || 0);
    const lines = [...para.querySelectorAll<HTMLElement>(".folio-composed-line")];
    const offsets = lines.slice(0, capLines + 2).map((line) => parseFloat(getComputedStyle(line).marginLeft) || 0);
    const collisions: number[] = [];
    const inkRows: number[] = [];
    const rowRects: Array<{ index: number; top: number; bottom: number; left: number; right: number }> = [];

    lines.forEach((line, index) => {
      const content = line.querySelector<HTMLElement>(":scope > .folio-line-content") ?? line;
      const range = document.createRange();
      range.selectNodeContents(content);
      const textRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
      const rect = textRects[0] ?? content.getBoundingClientRect();
      rowRects.push({ index, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
      const vertical = rect.bottom > inkTop + 0.5 && rect.top < inkBottom - 0.5;
      const horizontal = rect.left < capRect.right - 0.5 && rect.right > capRect.left + 0.5;
      if (vertical) inkRows.push(index);
      if (vertical && horizontal) collisions.push(index);
    });

    const paraRect = para.getBoundingClientRect();
    return {
      capLines,
      wrappedLines,
      offsets,
      collisions,
      inkRows,
      rowRects: rowRects.slice(0, 7),
      paragraph: paraRect.toJSON(),
      paragraphLineHeight: parseFloat(getComputedStyle(para).lineHeight),
      fontSize: parseFloat(capStyle.fontSize),
      cap: capRect.toJSON(),
      inkTop,
      inkBottom,
    };
  });

  const firstLinesReserved = Boolean(
    geometry &&
    geometry.capLines >= 2 &&
    geometry.offsets.slice(0, geometry.capLines).every((offset) => offset > 1)
  );
  const releasesImmediatelyAfterCap = Boolean(
    geometry &&
    geometry.offsets.length > geometry.capLines &&
    geometry.offsets[geometry.capLines] <= 1
  );
  const safe = Boolean(
    geometry &&
    geometry.wrappedLines === geometry.capLines &&
    geometry.inkRows.filter((index) => index < geometry.capLines + 2).length === geometry.capLines &&
    firstLinesReserved &&
    releasesImmediatelyAfterCap &&
    geometry.collisions.length === 0
  );

  check(`Print compositor ${label} reserves exactly its measured lines with no text overlap`,
    safe,
    JSON.stringify(geometry));
  if (!safe) throw new Error(`Print compositor drop cap failed for ${label}`);
}

await p.close();
await closeBrowser();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
