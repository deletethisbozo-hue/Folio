import { promises as fs } from "node:fs";

async function jsonVersion(file) {
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  data.version = "2.0.3";
  if (data.packages?.[""]) data.packages[""].version = "2.0.3";
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function replace(file, fn) {
  const before = await fs.readFile(file, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`No 2.0.3 change made in ${file}`);
  await fs.writeFile(file, after, "utf8");
}

await jsonVersion("package.json");
await jsonVersion("package-lock.json");

await replace("web/src/StartScreen.tsx", (text) => text.replace('<div className="start-version">2.0.2</div>', '<div className="start-version">2.0.3</div>'));

await replace("scripts/packaged-ui-smoke.mjs", (text) => text.replaceAll("2.0.2", "2.0.3"));

await replace(".github/workflows/windows-release.yml", (text) => {
  let next = text.replaceAll("2.0.2", "2.0.3");
  const oldNotes = '--notes "Folio 2.0.3 fixes visible 2.0.1 regressions: the Folio display face is used consistently for bold UI labels, Export is restored as a proper publishing control, Full-page Image behaves like the rest of Add Content and reliably opens image selection, Print Preview paginates the selected live section instead of reflowing the entire manuscript on every update, and Revenant is removed from the curated theme set. The release remains gated by typecheck, the complete formatter/UI suite on Linux and Windows, visual/typesetting QA, the full Print PDF matrix, packaged executable smoke tests, EPUB/PDF/print export checks and SHA-256 hashing."';
  const newNotes = '--notes "Folio 2.0.3 is a visual and front-matter quality release. The studio has a stronger hierarchy and a clearly branded Folio wordmark, cover controls are cleaned up, and cover artwork is shown with the same complete contain-fit treatment across every preview profile. Editable front matter can now insert, persist, reload and remove PNG/JPEG illustrations as real book assets instead of dropping images during rich-text conversion. The release remains gated by typecheck, the complete formatter/UI suite on Linux and Windows, visual/typesetting QA, the full Print PDF matrix, packaged executable smoke tests, EPUB/PDF/print export checks and SHA-256 hashing."';
  if (!next.includes(oldNotes)) throw new Error("Windows release notes anchor was not found");
  return next.replace(oldNotes, newNotes);
});

console.log("Prepared Folio 2.0.3 release metadata.");
