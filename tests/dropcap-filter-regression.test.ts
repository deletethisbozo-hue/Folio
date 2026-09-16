/* Regression: export must make the same drop-cap decision as live preview.
   A chapter opening that starts with a dialogue dash must not turn that dash
   into a drop cap in HTML/EPUB/print pipelines. */
import { BOOK_FILTER, runPandoc } from "../server/pipeline/pandoc.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function renderOpening(text: string): Promise<string> {
  const markdown = `---\ndropcap: "true"\n---\n\n# Chapter {.chapter}\n\n${text}\n`;
  return runPandoc([
    "--from=markdown",
    "--to=html5",
    `--lua-filter=${BOOK_FILTER}`,
  ], markdown);
}

const normal = await renderOpening("A normal chapter opening still receives its cap.");
check(
  "ordinary letter-led chapter opening keeps a drop cap",
  /class="dropcap"[^>]*>A<\/span>/.test(normal),
  normal,
);

const quoted = await renderOpening("“A quoted chapter opening still receives its cap.”");
check(
  "opening quotation mark may ride with a real initial",
  normal.includes('class="dropcap"') && quoted.includes('class="dropcap"'),
  quoted,
);

const enDash = await renderOpening("– Dialog zaczyna rozdział od półpauzy i nie powinien dostać inicjału.");
check(
  "en-dash-led chapter opening never becomes a drop cap",
  !enDash.includes('class="dropcap"'),
  enDash,
);

const emDash = await renderOpening("— Dialogue starts with an em dash and must remain ordinary text.");
check(
  "em-dash-led chapter opening never becomes a drop cap",
  !emDash.includes('class="dropcap"'),
  emDash,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
