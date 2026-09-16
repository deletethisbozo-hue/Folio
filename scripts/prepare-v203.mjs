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

console.log("Prepared Folio 2.0.3 package metadata.");
