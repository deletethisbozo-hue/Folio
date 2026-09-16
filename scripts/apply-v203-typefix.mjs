import { promises as fs } from "node:fs";

const file = "web/src/rich-text.ts";
const before = await fs.readFile(file, "utf8");
const from = `    const image = element.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    const asset = image?.dataset.folioAsset?.trim();\n    if (!asset) return "";\n    const alt = escapeMarkdownAlt(image.alt.trim() || "Illustration");`;
const to = `    const image = element.querySelector<HTMLImageElement>("img[data-folio-asset]");\n    if (!image) return "";\n    const asset = image.dataset.folioAsset?.trim();\n    if (!asset) return "";\n    const alt = escapeMarkdownAlt(image.alt.trim() || "Illustration");`;
if (!before.includes(from)) throw new Error("Missing rich-text narrowing anchor");
await fs.writeFile(file, before.replace(from, to), "utf8");
console.log("Applied Folio 2.0.3 rich-text narrowing fix.");
