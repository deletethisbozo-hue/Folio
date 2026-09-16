import { promises as fs } from "node:fs";

const path = "tests/ui-runtime.test.ts";
let text = await fs.readFile(path, "utf8");
const from = `  await stage("bring narrow qualification paragraph into view", () => page.evaluate(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p") ?? [])]
      .find((candidate) => candidate.textContent
        ?.replace(/\\u00ad/g, "")
        .replace(/\\u00a0/g, " ")
        .includes("W Polsce i na świecie najprawdopodobniej"));
    if (!paragraph) throw new Error("Polish qualification paragraph is missing after device change");
    paragraph.dataset.folioQaPolish = "true";
    paragraph.scrollIntoView({ block: "center" });
  }));`;
const to = `  await stage("wait for narrow qualification paragraph after device reload", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    return [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p") ?? [])]
      .some((candidate) => candidate.textContent
        ?.replace(/\\u00ad/g, "")
        .replace(/\\u00a0/g, " ")
        .includes("W Polsce i na świecie najprawdopodobniej"));
  }, { timeout: 30000 }));
  await stage("bring narrow qualification paragraph into view", () => page.evaluate(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p") ?? [])]
      .find((candidate) => candidate.textContent
        ?.replace(/\\u00ad/g, "")
        .replace(/\\u00a0/g, " ")
        .includes("W Polsce i na świecie najprawdopodobniej"));
    if (!paragraph) throw new Error("Polish qualification paragraph disappeared after device reload");
    paragraph.dataset.folioQaPolish = "true";
    paragraph.scrollIntoView({ block: "center" });
  }));`;

if (!text.includes(from)) throw new Error("Expected narrow qualification scroll stage was not found");
text = text.replace(from, to);
await fs.writeFile(path, text, "utf8");

for (const obsolete of [
  ".github/workflows/v2-device-reload-test-patch.yml",
  "scripts/patch-v2-device-reload-test.mjs",
]) await fs.rm(obsolete, { force: true });
