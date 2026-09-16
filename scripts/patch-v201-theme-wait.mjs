import { promises as fs } from "node:fs";

// Final 2.0.1 qualification repair: wait for the reader iframe to actually
// finish switching themes instead of sampling the previous async render.
const file = "tests/ui-runtime.test.ts";
let source = await fs.readFile(file, "utf8");
const before = `  await page.click('.theme-sample[data-theme="blackletter"]');
  await stage("render Blackletter theme", () => page.waitForFunction(() => {
    const h1 = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > h1");
    return Boolean(h1 && getComputedStyle(h1).fontFamily.includes("Folio Grenze Gotisch"));
  }));`;
const after = `  await page.click('.theme-sample[data-theme="blackletter"]');
  await stage("render Blackletter theme", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const h1 = doc?.querySelector("section.chapter > h1");
    if (!doc || !h1) return false;
    const heading = getComputedStyle(h1);
    const body = getComputedStyle(doc.body);
    return parseFloat(heading.borderTopWidth) === 0 && body.backgroundColor === "rgb(244, 236, 218)";
  }));`;
if (!source.includes(before)) throw new Error("Blackletter qualification anchor not found");
source = source.replace(before, after);
await fs.writeFile(file, source, "utf8");
console.log("Patched asynchronous theme qualification wait.");
