import { promises as fs } from "node:fs";

async function patch(path, from, to, label) {
  const current = await fs.readFile(path, "utf8");
  if (!current.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  await fs.writeFile(path, current.replace(from, to), "utf8");
}

await patch(
  "tests/ui-runtime.test.ts",
  '    return css.textAlign + "|" + css.borderTopWidth + "|" + css.fontFamily;',
  '    return [css.textAlign, css.borderTopWidth, css.borderBottomWidth, css.borderRadius, css.fontFamily, css.fontSize, css.textTransform].join("|");',
  "first theme runtime signature",
);

const ui = await fs.readFile("tests/ui-runtime.test.ts", "utf8");
const firstChanged = ui.indexOf('[css.textAlign, css.borderTopWidth, css.borderBottomWidth');
const secondOld = '    return css.textAlign + "|" + css.borderTopWidth + "|" + css.fontFamily;';
const secondIndex = ui.indexOf(secondOld, firstChanged + 1);
if (secondIndex < 0) throw new Error("Missing second theme runtime signature");
await fs.writeFile(
  "tests/ui-runtime.test.ts",
  ui.slice(0, secondIndex) + '    return [css.textAlign, css.borderTopWidth, css.borderBottomWidth, css.borderRadius, css.fontFamily, css.fontSize, css.textTransform].join("|");' + ui.slice(secondIndex + secondOld.length),
  "utf8",
);

await patch(
  "web/src/StartScreen.tsx",
  '<div className="start-version">2.0</div>',
  '<div className="start-version">2.0.1</div>',
  "start screen patch version",
);

await patch(
  "web/src/StartScreen.tsx",
  '                        setRecent(forgetRecentProject(item.folder));',
  '                        setRecent(forgetRecentProject(item.folder));\n                        void api.forgetRecentProject(item.folder).catch(() => {});',
  "keyboard recent removal persistence",
);

console.log("Folio 2.0.1 follow-up applied.");
