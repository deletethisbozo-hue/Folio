import { promises as fs } from "node:fs";

const path = "tests/ui-runtime.test.ts";
let text = await fs.readFile(path, "utf8");
const from = `  const dropcapBeforeDeviceChange = await page.evaluate(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap")));
  await page.select('select[aria-label="Preview device"]', "phone-6-1");
  await stage("narrow justified composition", () => page.waitForFunction(() => {
    const paragraph = document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p");
    return Boolean(paragraph?.classList.contains("folio-composed") && paragraph.querySelector(".folio-composed-line"));
  }));
  check("narrow readers honor the selected justification and keep final lines natural", true);
  await stage("drop cap survives device change", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap"))));
  check("drop caps survive switching preview devices", dropcapBeforeDeviceChange);`;
const to = `  const dropcapBeforeDeviceChange = await page.evaluate(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap")));
  await page.select('select[aria-label="Preview device"]', "phone-6-1");
  await stage("switch large corpus to phone", () => page.waitForSelector('.reader-device.device-phone-6-1[data-device-family="phone"]'));
  await stage("bring narrow qualification paragraph into view", () => page.evaluate(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p") ?? [])]
      .find((candidate) => candidate.textContent
        ?.replace(/\\u00ad/g, "")
        .replace(/\\u00a0/g, " ")
        .includes("W Polsce i na świecie najprawdopodobniej"));
    if (!paragraph) throw new Error("Polish qualification paragraph is missing after device change");
    paragraph.dataset.folioQaPolish = "true";
    paragraph.scrollIntoView({ block: "center" });
  }));
  await stage("narrow justified composition", () => page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p") ?? [])]
      .find((candidate) => candidate.textContent
        ?.replace(/\\u00ad/g, "")
        .replace(/\\u00a0/g, " ")
        .includes("W Polsce i na świecie najprawdopodobniej"));
    if (!paragraph?.classList.contains("folio-composed")) return false;
    const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
    return lines.length > 1 && lines.at(-1)?.classList.contains("folio-line-natural") === true;
  }, { timeout: 30000 }));
  check("narrow readers honor the selected justification and keep final lines natural", true);
  await stage("bring narrow first paragraph into view", () => page.evaluate(() => {
    const first = document.querySelector("iframe")?.contentDocument?.querySelector<HTMLElement>("section.chapter > p");
    if (!first) throw new Error("First chapter paragraph is missing after device change");
    first.scrollIntoView({ block: "center" });
  }));
  await stage("drop cap survives device change", () => page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p .dropcap")), { timeout: 30000 }));
  check("drop caps survive switching preview devices", dropcapBeforeDeviceChange);`;

if (!text.includes(from)) throw new Error("Expected narrow preview test block was not found");
text = text.replace(from, to);
await fs.writeFile(path, text, "utf8");

for (const obsolete of [
  ".github/workflows/v2-ui-narrow-test-patch.yml",
  "scripts/patch-v2-ui-narrow-test.mjs",
]) await fs.rm(obsolete, { force: true });
