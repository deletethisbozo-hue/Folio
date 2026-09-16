import { promises as fs } from "node:fs";

async function patch(file, before, after) {
  const text = await fs.readFile(file, "utf8");
  if (!text.includes(before)) throw new Error(`Missing patch anchor in ${file}`);
  await fs.writeFile(file, text.replace(before, after), "utf8");
}

await patch(
  "server/pipeline/theme-fonts.ts",
  '  revenant: "garamond",\n',
  "",
);

await patch(
  "tests/folio-runtime.test.ts",
  'const expectedThemes = ["blackletter", "stanza", "witchlight", "revenant", "solstice", "literary", "nocturne", "obsidian", "grimoire", "ivory", "heritage", "decorative", "cathedral", "aubade"];',
  'const expectedThemes = ["blackletter", "stanza", "witchlight", "solstice", "literary", "nocturne", "obsidian", "grimoire", "ivory", "heritage", "decorative", "cathedral", "aubade"];',
);
await patch(
  "tests/folio-runtime.test.ts",
  'check("Folio 2.0 registers exactly the 14 curated themes", themes.body.length === expectedThemes.length && expectedThemes.every((name) => themes.body.some((theme: any) => theme.name === name)), themes.body.map((theme: any) => theme.name).join(", "));',
  'check("Folio 2.0 registers exactly the 13 curated themes", themes.body.length === expectedThemes.length && expectedThemes.every((name) => themes.body.some((theme: any) => theme.name === name)), themes.body.map((theme: any) => theme.name).join(", "));',
);

console.log("Removed remaining Revenant runtime/test references.");
