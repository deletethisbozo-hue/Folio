import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  customFontByFamily,
  customFontPath,
  installCustomFont,
  readCustomFonts,
  readThemeLibrary,
  writeThemeLibrary,
} from "../server/global-library.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

function minimalTtf(family: string): Buffer {
  const familyBytes = Buffer.alloc(family.length * 2);
  for (let i = 0; i < family.length; i++) familyBytes.writeUInt16BE(family.charCodeAt(i), i * 2);

  const nameTable = Buffer.alloc(18 + familyBytes.length);
  nameTable.writeUInt16BE(0, 0); // format
  nameTable.writeUInt16BE(1, 2); // count
  nameTable.writeUInt16BE(18, 4); // string storage offset
  nameTable.writeUInt16BE(3, 6); // Windows
  nameTable.writeUInt16BE(1, 8); // Unicode BMP
  nameTable.writeUInt16BE(0x0409, 10); // en-US
  nameTable.writeUInt16BE(1, 12); // family name
  nameTable.writeUInt16BE(familyBytes.length, 14);
  nameTable.writeUInt16BE(0, 16);
  familyBytes.copy(nameTable, 18);

  const out = Buffer.alloc(28 + nameTable.length);
  out.writeUInt32BE(0x00010000, 0); // TrueType sfnt
  out.writeUInt16BE(1, 4); // one table
  out.write("name", 12, "ascii");
  out.writeUInt32BE(28, 20);
  out.writeUInt32BE(nameTable.length, 24);
  nameTable.copy(out, 28);
  return out;
}

console.log("\nPersistent Theme + Custom Font Library");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-global-library-test-"));
process.env.FOLIO_WRITABLE_ROOT = root;

try {
  const theme = {
    id: "custom-goth",
    label: "Goth",
    baseTheme: "blackletter",
    config: { enabled: true, name: "Goth", headingFont: "Folio Test Custom" },
    createdAt: 1000,
    updatedAt: 2000,
  };
  await writeThemeLibrary([theme]);
  const themes = await readThemeLibrary();
  check("theme survives a fresh disk read", themes.length === 1 && themes[0].config.headingFont === "Folio Test Custom");

  const diskThemes = JSON.parse(await fs.readFile(path.join(root, "library", "themes.json"), "utf8"));
  check("theme library lives below FOLIO_WRITABLE_ROOT, not browser storage", Array.isArray(diskThemes) && diskThemes[0].label === "Goth");

  const installed = await installCustomFont("folio-test.ttf", minimalTtf("Folio Test Custom"));
  check("custom TTF family is read from its internal name table", installed.family === "Folio Test Custom");

  const fonts = await readCustomFonts();
  check("custom font index survives a fresh disk read", fonts.length === 1 && fonts[0].family === "Folio Test Custom");

  const resolved = await customFontByFamily("Folio Test Custom");
  const fontBytes = resolved ? await fs.readFile(customFontPath(resolved)) : Buffer.alloc(0);
  check("custom font bytes are stored under the persistent library", Boolean(resolved) && fontBytes.length > 28);

  const index = JSON.parse(await fs.readFile(path.join(root, "library", "fonts.json"), "utf8"));
  check("custom font metadata is durable across renderer-origin changes", Array.isArray(index) && index[0].filename === installed.filename);
} finally {
  delete process.env.FOLIO_WRITABLE_ROOT;
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
