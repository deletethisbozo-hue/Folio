import { promises as fs } from "node:fs";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  ok ? pass++ : fail++;
};

console.log("\nFolio project file association");

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const main = await fs.readFile("electron/main.cjs", "utf8");
const renderer = await fs.readFile("web/src/main.tsx", "utf8");

const association = Array.isArray(pkg.build?.fileAssociations)
  ? pkg.build.fileAssociations.find((item: any) => item.ext === "folio")
  : null;

check("installer registers the .folio extension", Boolean(association));
check("the association is an editable Folio Project", association?.name === "Folio Project" && association?.role === "Editor");
check("Explorer launch arguments are parsed for .folio files", main.includes("folioProjectFromArgv") && main.includes('/\\.folio$/i'));
check("a second Folio launch opens the requested project in the existing window", main.includes('app.on("second-instance"') && main.includes("openProjectFileInRenderer"));
check("switching from Explorer asks the renderer to flush current work first", main.includes("window.__folioPrepareClose") && main.includes("saved === false"));
check("the renderer exposes a project-file open handler", renderer.includes("__folioOpenProjectFile") && renderer.includes("api.openProjectFile"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
