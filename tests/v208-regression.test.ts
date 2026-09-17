import { promises as fs } from "node:fs";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  ok ? pass++ : fail++;
};

console.log("\nFolio 2.0.8 UI/style regression contract");
const app = await fs.readFile("web/src/App.tsx", "utf8");
const mock = await fs.readFile("web/src/mockup-ui.ts", "utf8");
const main = await fs.readFile("web/src/main.tsx", "utf8");
const start = await fs.readFile("web/src/StartScreen.tsx", "utf8");

check("top command bar no longer duplicates Add", !app.includes('data-command="add"'));
check("workspace top bar offers New Project", app.includes('data-command="new-project"') && app.includes('>New Project</button>'));
check("workspace wordmark returns to dashboard", app.includes('aria-label="Back to dashboard"') && main.includes('onDashboard={showDashboard}'));
check("workspace New Project opens the existing creation dialog", app.includes('showNewBook && <NewBookDialog'));
check("dashboard no longer renders the redundant standalone F mark", !start.includes('className="start-mark"'));
check("sidebar owns a real React Add Section control", app.includes('className="library-add-section"') && app.includes('className="library-add-section" onClick={() => setShowContent(true)}'));
check("mockup runtime no longer proxies Add Section through a hidden top command", !mock.includes('.library-add-section') && !mock.includes('library.insertBefore(add, footer)'));
check("every customization category exposes an explicit Theme Default reset", app.includes('className="customize-reset-button"') && app.includes('Reset to Theme Default') && app.includes('const resetCategory = () =>'));
check("Body size can return directly to Theme default", app.includes('value={ty.fontSize ?? ""}') && app.includes('<option value="">Theme default</option><option value="0.92em">Small</option>'));
check("Body alignment can return directly to Theme default", app.includes('value={ty.bodyAlign ?? ""}') && app.includes('bodyAlign: (e.target.value || undefined)'));
check("Paragraph-after-break can return directly to Theme default", app.includes('value={ty.paragraphAfterBreakIndent ?? ""}') && app.includes('paragraphAfterBreakIndent: e.target.value || undefined'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
