import { promises as fs } from "node:fs";

async function read(path) { return fs.readFile(path, "utf8"); }
async function write(path, content) { await fs.writeFile(path, content, "utf8"); }
function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Patch anchor missing: ${label}`);
  return content.replace(from, to);
}

// 1) Restore the Cathedral design the user actually approved. Keep numbering
// structural so Chapter Heading UI can still hide/replace the label.
await write("themes/cathedral/theme.css", `/* Cathedral — restored Gothic arch opening with structural Roman numbering. */
body{font-family:Baskerville,Georgia,serif;line-height:1.5;color:#202831;background:#f3f1e9}
main.book{counter-reset:nave}
section.chapter{counter-increment:nave}
section.chapter>h1{text-align:center;margin:.9em 0 2.25em;padding:1em .55em .75em;border:1px solid #536270;border-top:6px double #293543;border-radius:50% 50% 0 0/24% 24% 0 0;font-family:"Old English Text MT",Georgia,serif;font-size:1.95em;font-weight:400;color:#202831}
section.chapter>h1::before{content:counter(nave,upper-roman);display:block;margin-bottom:.85em;font:500 .36em Georgia,serif;letter-spacing:.3em;color:#536270}
.chapter-subtitle{margin:-2.5em 0 2.1em}.chapter-subtitle p{font-style:normal;font-variant:small-caps;letter-spacing:.1em;color:#536270}
.dropcap{font-family:"Old English Text MT",Georgia,serif;color:#293543}
.scene-break{color:#536270;font-size:1.2em}
.tp-author{font-variant:small-caps;letter-spacing:.16em}
section.titlepage>h1{font-family:"Old English Text MT",Georgia,serif;font-size:2.4em}
section.frontmatter>h1,section.backmatter>h1{text-align:center;font-family:"Old English Text MT",Georgia,serif}
@media print{section.chapter>h1{margin-top:1.35in}}
`);

let themes = await read("server/pipeline/themes.ts");
themes = replaceOnce(
  themes,
  'cathedral: { name: "cathedral", label: "Cathedral", description: "Tall architectural headings, stone-blue rules and Roman display type inspired by Gothic interiors.", sceneOrnament: "✠", dropcap: true, chapterLabel: "CHAPTER I", previewFont: "Baskerville, Georgia, serif", previewHeadingFont: "Cinzel, Georgia, serif", previewAccent: "#344654", previewPaper: "#f3f1e9" },',
  'cathedral: { name: "cathedral", label: "Cathedral", description: "Gothic arched chapter openings with stone-blue rules, blackletter display type and structural Roman numbering.", sceneOrnament: "✠", dropcap: true, chapterLabel: "I", previewFont: "Baskerville, Georgia, serif", previewHeadingFont: "Old English Text MT, Georgia, serif", previewAccent: "#293543", previewPaper: "#f3f1e9" },',
  "Cathedral theme metadata",
);
await write("server/pipeline/themes.ts", themes);

// 2) Make the Folio wordmark in the workspace visually identical to the home-screen wordmark.
let indexCss = await read("web/src/index.css");
indexCss = replaceOnce(
  indexCss,
  '.command-wordmark { width:152px; font:600 17px/1 Georgia,"Times New Roman",serif; letter-spacing:-.025em; color:var(--folio-text); }',
  '.command-wordmark { width:152px; font:700 20px/1 Georgia,"Times New Roman",serif; letter-spacing:-.02em; color:var(--folio-text); }',
  "workspace Folio wordmark",
);
indexCss = replaceOnce(
  indexCss,
  '.folio-wordmark { font-size: 11px; font-weight: 650; }',
  '.folio-wordmark { font:700 20px/1 Georgia,"Times New Roman",serif; letter-spacing:-.02em; }',
  "legacy Folio wordmark",
);
indexCss = replaceOnce(
  indexCss,
  '.preview-stage.print-stage { place-items:start center; overflow:auto; }',
  '.preview-stage.print-stage { place-items:stretch; overflow:hidden; padding:0; background:#e9edf2; }',
  "print stage layout",
);
indexCss = replaceOnce(
  indexCss,
  '.reader-device.device-print { width:min(95%,480px); aspect-ratio:.667; padding:13px; border-radius:3px; background:#b8b8b5; }',
  '.reader-device.device-print { width:100%; height:100%; max-height:none; aspect-ratio:auto; padding:0; margin:0; border:0; border-radius:0; background:#e9edf2; box-shadow:none; }\n.reader-device.device-print .reader-screen { height:100%; overflow:hidden; background:#e9edf2; box-shadow:none; }',
  "print preview shell",
);
await write("web/src/index.css", indexCss);

// 3) Persist Recent Books outside browser localStorage. Packaged Folio deliberately
// uses a random localhost port, so localStorage was silently changing origin every launch.
await write("server/recent-projects.ts", `import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RecentProjectRecord {
  folder: string;
  title: string;
  author: string;
  lastOpened: number;
}

const MAX_RECENT = 8;
let mutationTail: Promise<void> = Promise.resolve();

function storeDir(): string {
  return process.env.FOLIO_WRITABLE_ROOT
    ? path.resolve(process.env.FOLIO_WRITABLE_ROOT)
    : path.join(os.tmpdir(), "folio");
}

function storeFile(): string { return path.join(storeDir(), "recent-projects.json"); }
function folderKey(folder: string): string { return folder.replace(/[\\\\/]+$/, "").toLocaleLowerCase(); }

function validRecord(value: unknown): value is RecentProjectRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentProjectRecord>;
  return typeof item.folder === "string" && typeof item.title === "string" &&
    typeof item.author === "string" && typeof item.lastOpened === "number";
}

export async function readRecentProjects(): Promise<RecentProjectRecord[]> {
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validRecord).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, MAX_RECENT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

async function writeRecentProjects(items: RecentProjectRecord[]): Promise<void> {
  const dir = storeDir();
  await fs.mkdir(dir, { recursive: true });
  const file = storeFile();
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, JSON.stringify(items.slice(0, MAX_RECENT), null, 2), "utf8");
  await fs.rename(temp, file);
}

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(operation, operation);
  mutationTail = run.then(() => undefined, () => undefined);
  return run;
}

export async function rememberRecentProject(folder: string, title: string, author: string, now = Date.now()): Promise<RecentProjectRecord[]> {
  return serializeMutation(async () => {
    const current = await readRecentProjects();
    const key = folderKey(folder);
    const entry: RecentProjectRecord = {
      folder,
      title: title.trim() || "Untitled",
      author: author.trim() || "Unknown Author",
      lastOpened: now,
    };
    const next = [entry, ...current.filter((item) => folderKey(item.folder) !== key)]
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, MAX_RECENT);
    await writeRecentProjects(next);
    return next;
  });
}

export async function forgetRecentProject(folder: string): Promise<RecentProjectRecord[]> {
  return serializeMutation(async () => {
    const key = folderKey(folder);
    const next = (await readRecentProjects()).filter((item) => folderKey(item.folder) !== key);
    await writeRecentProjects(next);
    return next;
  });
}
`);

let serverApi = await read("server/api.ts");
serverApi = replaceOnce(
  serverApi,
  'import { registerImagePageApi } from "./image-page-api.ts";',
  'import { registerImagePageApi } from "./image-page-api.ts";\nimport { forgetRecentProject, readRecentProjects, rememberRecentProject } from "./recent-projects.ts";',
  "recent store import",
);
serverApi = replaceOnce(
  serverApi,
  '  app.get("/api/print-layouts", (_req, res) => res.json(LAYOUTS));\n',
  '  app.get("/api/print-layouts", (_req, res) => res.json(LAYOUTS));\n  app.get("/api/recent-projects", (_req, res) =>\n    wrap(res, async () => { res.json(await readRecentProjects()); }),\n  );\n  app.delete("/api/recent-projects", (req: Request, res: Response) =>\n    wrap(res, async () => {\n      const folder = String(req.body?.folder ?? "").trim();\n      if (!folder) throw new Error("No recent-project folder provided.");\n      res.json(await forgetRecentProject(folder));\n    }),\n  );\n',
  "recent routes",
);
serverApi = replaceOnce(
  serverApi,
  '      const id = await createProjectFromFolderPath(folder);\n      res.json(await buildSummary(id));',
  '      const id = await createProjectFromFolderPath(folder);\n      const summary = await buildSummary(id);\n      if (summary.folder) await rememberRecentProject(summary.folder, summary.meta.title, summary.meta.author);\n      res.json(summary);',
  "remember opened folder",
);
serverApi = replaceOnce(
  serverApi,
  '      await saveMeta(dir, meta);\n      await addChapter(dir, meta, String(req.body?.chapterTitle ?? "Chapter One"));\n      res.json(await buildSummary(id));',
  '      await saveMeta(dir, meta);\n      await addChapter(dir, meta, String(req.body?.chapterTitle ?? "Chapter One"));\n      const summary = await buildSummary(id);\n      if (summary.folder) await rememberRecentProject(summary.folder, summary.meta.title, summary.meta.author);\n      res.json(summary);',
  "remember new book",
);
serverApi = replaceOnce(
  serverApi,
  '      await saveMeta(dir, meta);\n      res.json(await buildSummary(req.params.id));',
  '      await saveMeta(dir, meta);\n      const summary = await buildSummary(req.params.id);\n      if (summary.folder) await rememberRecentProject(summary.folder, summary.meta.title, summary.meta.author);\n      res.json(summary);',
  "refresh recent metadata",
);
await write("server/api.ts", serverApi);

let webApi = await read("web/src/api.ts");
webApi = replaceOnce(
  webApi,
  '} from "./types";\n',
  '} from "./types";\nimport type { RecentProject } from "./recent-projects";\n',
  "RecentProject web type import",
);
webApi = replaceOnce(
  webApi,
  '  printLayouts: () => fetch("/api/print-layouts").then((r) => json<PrintLayout[]>(r)),\n\n  loadSample:',
  '  printLayouts: () => fetch("/api/print-layouts").then((r) => json<PrintLayout[]>(r)),\n  recentProjects: () => fetch("/api/recent-projects").then((r) => json<RecentProject[]>(r)),\n  forgetRecentProject: (folder: string) => fetch("/api/recent-projects", {\n    method: "DELETE",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({ folder }),\n  }).then((r) => json<RecentProject[]>(r)),\n\n  loadSample:',
  "recent project web API",
);
await write("web/src/api.ts", webApi);

let start = await read("web/src/StartScreen.tsx");
start = replaceOnce(start, 'import { useMemo, useState } from "react";', 'import { useEffect, useMemo, useState } from "react";', "StartScreen useEffect");
start = replaceOnce(
  start,
  'export default function StartScreen(props: { onOpenPath: (path: string) => void; onOpenSample: () => void }) {',
  'export default function StartScreen(props: { onOpenPath: (path: string) => Promise<void>; onOpenProject: (project: Awaited<ReturnType<typeof api.newBook>>) => void; onOpenSample: () => Promise<void> }) {',
  "StartScreen props",
);
start = replaceOnce(
  start,
  '  const tone = useMemo(() => window.localStorage.getItem("folio-ui-tone") === "midnight" ? "midnight" : "ivory", []);\n',
  '  const tone = useMemo(() => window.localStorage.getItem("folio-ui-tone") === "midnight" ? "midnight" : "ivory", []);\n\n  useEffect(() => {\n    let cancelled = false;\n    api.recentProjects().then((items) => {\n      if (!cancelled && items.length) setRecent(items);\n    }).catch(() => { /* localStorage remains a same-session fallback */ });\n    return () => { cancelled = true; };\n  }, []);\n',
  "load persistent recent projects",
);
start = replaceOnce(start, '      if (selected) props.onOpenPath(selected);', '      if (selected) await props.onOpenPath(selected);', "await open selected book");
start = replaceOnce(
  start,
  '      setRecent(readRecentProjects());\n      setShowCreate(false);\n      props.onOpenPath(summary.folder || newBook.path);',
  '      setRecent(readRecentProjects());\n      setShowCreate(false);\n      props.onOpenProject(summary);',
  "adopt newly created book without reopening",
);
start = replaceOnce(
  start,
  '  function removeRecent(event: React.MouseEvent, folder: string) {\n    event.stopPropagation();\n    setRecent(forgetRecentProject(folder));\n  }',
  '  async function openRecent(folder: string) {\n    if (busy !== null) return;\n    setBusy("open"); setError(null);\n    try { await props.onOpenPath(folder); }\n    catch (e) { setError(e instanceof Error ? e.message : String(e)); }\n    finally { setBusy(null); }\n  }\n\n  async function openBundledSample() {\n    if (busy !== null) return;\n    setBusy("open"); setError(null);\n    try { await props.onOpenSample(); }\n    catch (e) { setError(e instanceof Error ? e.message : String(e)); }\n    finally { setBusy(null); }\n  }\n\n  function removeRecent(event: React.MouseEvent, folder: string) {\n    event.stopPropagation();\n    setRecent(forgetRecentProject(folder));\n    void api.forgetRecentProject(folder).catch(() => {});\n  }',
  "recent actions",
);
start = replaceOnce(start, '<button className="start-button sample" disabled={busy !== null} onClick={props.onOpenSample}>Open Sample</button>', '<button className="start-button sample" disabled={busy !== null} onClick={() => void openBundledSample()}>Open Sample</button>', "sample button");
start = replaceOnce(start, '<button key={item.folder} className="recent-row" onClick={() => props.onOpenPath(item.folder)} title={item.folder}>', '<button key={item.folder} className="recent-row" disabled={busy !== null} onClick={() => void openRecent(item.folder)} title={item.folder}>', "recent row open");
await write("web/src/StartScreen.tsx", start);

// 4) Preload the project while the home screen is still mounted, then mount App
// with real project data. This removes the obsolete empty workspace flash.
let main = await read("web/src/main.tsx");
main = replaceOnce(main, 'import { api } from "./api";\n', 'import { api } from "./api";\nimport type { ProjectSummary } from "./types";\n', "main ProjectSummary import");
const oldRoot = `function FolioRoot() {
  const params = new URLSearchParams(window.location.search);
  const [workspaceOpen, setWorkspaceOpen] = useState(() => Boolean(params.get("book")?.trim() || params.get("sample") === "1"));

  function openPath(path: string) {
    const clean = path.trim();
    if (!clean) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("sample");
    url.searchParams.set("book", clean);
    window.history.replaceState(window.history.state, "", url);
    setWorkspaceOpen(true);
  }

  function openSample() {
    const url = new URL(window.location.href);
    url.searchParams.delete("book");
    url.searchParams.set("sample", "1");
    window.history.replaceState(window.history.state, "", url);
    setWorkspaceOpen(true);
  }

  return workspaceOpen ? <App /> : <StartScreen onOpenPath={openPath} onOpenSample={openSample} />;
}`;
const newRoot = `function FolioRoot() {
  const [workspaceProject, setWorkspaceProject] = useState<ProjectSummary | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  function adoptProject(summary: ProjectSummary) {
    setWorkspaceProject(summary);
    setWorkspaceOpen(true);
  }

  async function openPath(path: string) {
    const clean = path.trim();
    if (!clean) return;
    const summary = await api.openFolder(clean);
    adoptProject(summary);
  }

  async function openSample() {
    const summary = await api.loadSample();
    const url = new URL(window.location.href);
    url.searchParams.delete("book");
    url.searchParams.set("sample", "1");
    window.history.replaceState(window.history.state, "", url);
    adoptProject(summary);
  }

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const book = params.get("book")?.trim();
    if (book) void openPath(book).catch(() => {});
    else if (params.get("sample") === "1") void openSample().catch(() => {});
  }, []);

  return workspaceOpen && workspaceProject
    ? <App initialProject={workspaceProject} />
    : <StartScreen onOpenPath={openPath} onOpenProject={adoptProject} onOpenSample={openSample} />;
}`;
main = replaceOnce(main, oldRoot, newRoot, "FolioRoot preload flow");
await write("web/src/main.tsx", main);

let app = await read("web/src/App.tsx");
app = replaceOnce(
  app,
  'export default function App() {\n  const [themes, setThemes] = useState<Theme[]>([]);',
  'export default function App({ initialProject = null }: { initialProject?: ProjectSummary | null } = {}) {\n  const initialSection = initialProject?.sections.find((section) => section.kind === "chapter") ?? initialProject?.sections[0] ?? null;\n  const [themes, setThemes] = useState<Theme[]>([]);',
  "App initial project prop",
);
app = replaceOnce(app, '  const [project, setProject] = useState<ProjectSummary | null>(null);\n  const [meta, setMeta] = useState<BookMeta | null>(null);\n  const [typography, setTypography] = useState<Typography>({});\n  const [selectedId, setSelectedId] = useState<string | null>(null);', '  const [project, setProject] = useState<ProjectSummary | null>(initialProject);\n  const [meta, setMeta] = useState<BookMeta | null>(initialProject?.meta ?? null);\n  const [typography, setTypography] = useState<Typography>(initialProject?.typography ?? {});\n  const [selectedId, setSelectedId] = useState<string | null>(initialSection?.id ?? null);', "App initial state");
app = replaceOnce(
  app,
  '    const params = new URLSearchParams(window.location.search);\n    const bookPath = params.get("book")?.trim();\n    if (bookPath) void openFolder(bookPath);\n    else if (params.get("sample") === "1") void loadSample();',
  '    if (initialProject) return;\n    const params = new URLSearchParams(window.location.search);\n    const bookPath = params.get("book")?.trim();\n    if (bookPath) void openFolder(bookPath);\n    else if (params.get("sample") === "1") void loadSample();',
  "skip duplicate initial project load",
);
app = replaceOnce(
  app,
  '      const page = doc.querySelector(".pagedjs_page") as HTMLElement | null;\n      const width = page?.getBoundingClientRect().width || 576;\n      const scale = Math.min(1, (frame.clientWidth - 14) / width);\n      style.textContent = `.pagedjs_pages{transform:scale(${scale});transform-origin:top center;width:${100 / scale}%!important;margin-left:${(100 - 100 / scale) / 2}%!important}.pagedjs_page{margin:10px auto!important}`;',
  '      const page = doc.querySelector(".pagedjs_page") as HTMLElement | null;\n      const width = Math.max(1, page?.getBoundingClientRect().width || 576);\n      const available = Math.max(320, frame.clientWidth || previewStageRef.current?.clientWidth || 576);\n      const scale = Math.max(.35, Math.min(1, (available - 28) / width));\n      style.textContent = `html,body{background:#e9edf2!important}.pagedjs_pages{zoom:${scale};transform:none!important;width:max-content!important;min-width:100%!important;margin:0 auto!important;padding:8px 0 24px!important}.pagedjs_page{margin:10px auto!important}`;',
  "stable print preview scaling",
);
await write("web/src/App.tsx", app);

// 5) Strengthen real UI tests so this cannot pass CI while remaining broken in the packaged app.
let printTest = await read("tests/print-preview-ui.test.ts");
printTest = replaceOnce(
  printTest,
  '  const printPages = await page.$eval("iframe", (frame) => frame.contentDocument?.querySelectorAll(".pagedjs_page").length ?? 0);\n  check("switching Reader → Print displays physical paginated pages", printPages > 0, `${printPages} pages`);',
  '  const printPages = await page.$eval("iframe", (frame) => frame.contentDocument?.querySelectorAll(".pagedjs_page").length ?? 0);\n  const printRect = await page.$eval("iframe", (frame) => {\n    const pageNode = frame.contentDocument?.querySelector(".pagedjs_page") as HTMLElement | null;\n    const rect = pageNode?.getBoundingClientRect();\n    return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };\n  });\n  check("switching Reader → Print displays physical paginated pages", printPages > 0, `${printPages} pages`);\n  check("print page is visibly sized, not merely present in hidden DOM", printRect.width > 120 && printRect.height > 160, `${printRect.width.toFixed(1)}×${printRect.height.toFixed(1)}`);',
  "visible print page test",
);
await write("tests/print-preview-ui.test.ts", printTest);

await write("tests/recent-persistence.test.ts", `import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgetRecentProject, readRecentProjects, rememberRecentProject } from "../server/recent-projects.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(\`  \${ok ? "✓" : "✗"} \${label}\${detail ? \` — \${detail}\` : ""}\`);
  ok ? pass++ : fail++;
};

console.log("\\nPersistent Recent Books");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-recents-test-"));
process.env.FOLIO_WRITABLE_ROOT = root;
try {
  await rememberRecentProject("C:\\\\Books\\\\One", "One", "Writer", 1000);
  await rememberRecentProject("C:\\\\Books\\\\Two", "Two", "Writer", 2000);
  const firstRead = await readRecentProjects();
  check("stores recent books outside browser origin storage", firstRead.length === 2 && firstRead[0].title === "Two");

  // Re-read from disk rather than from an in-memory cache. This models a new
  // renderer origin on the next packaged launch, which previously lost history.
  const disk = JSON.parse(await fs.readFile(path.join(root, "recent-projects.json"), "utf8"));
  check("writes a durable recent-projects.json file", Array.isArray(disk) && disk.length === 2);

  await rememberRecentProject("c:\\\\books\\\\one\\\\", "One Revised", "New Writer", 3000);
  const deduped = await readRecentProjects();
  check("deduplicates Windows paths in persistent history", deduped.length === 2 && deduped[0].title === "One Revised");

  await forgetRecentProject("C:\\\\BOOKS\\\\TWO");
  const removed = await readRecentProjects();
  check("removing a recent book persists", removed.length === 1 && removed[0].title === "One Revised");
} finally {
  delete process.env.FOLIO_WRITABLE_ROOT;
  await fs.rm(root, { recursive: true, force: true });
}

console.log(\`\\n\${pass} passed, \${fail} failed\`);
process.exit(fail === 0 ? 0 : 1);
`);

let runner = await read("tests/run-all.ts");
runner = replaceOnce(runner, '  "recent-projects.test.ts",\n  "image-page.test.ts",', '  "recent-projects.test.ts",\n  "recent-persistence.test.ts",\n  "image-page.test.ts",', "recent persistence suite order");
await write("tests/run-all.ts", runner);

let packaged = await read("scripts/packaged-ui-smoke.mjs");
packaged = replaceOnce(
  packaged,
  '  const devices = await page.$$eval(\'select[aria-label="Preview device"] option\', (items) => items.length);\n  if (devices < 6) throw new Error("Packaged preview contains only " + devices + " device modes.");',
  '  const devices = await page.$$eval(\'select[aria-label="Preview device"] option\', (items) => items.length);\n  if (devices < 6) throw new Error("Packaged preview contains only " + devices + " device modes.");\n  await page.select(\'select[aria-label="Preview device"]\', "print");\n  await page.waitForFunction(() => {\n    const frame = document.querySelector("iframe");\n    const printed = frame?.contentDocument?.querySelector(".pagedjs_page");\n    const rect = printed?.getBoundingClientRect();\n    return Boolean(rect && rect.width > 120 && rect.height > 160);\n  }, { timeout: 45000 });\n  await page.select(\'select[aria-label="Preview device"]\', "kindle-6-8");\n  await page.waitForFunction(() => {\n    const doc = document.querySelector("iframe")?.contentDocument;\n    return Boolean(doc?.querySelector("section.chapter") && !doc.querySelector(".pagedjs_pages"));\n  }, { timeout: 20000 });',
  "packaged print UI smoke",
);
packaged = packaged.replace("Packaged Folio 2.0 UI passed:", "Packaged Folio 2.0.1 UI passed:");
await write("scripts/packaged-ui-smoke.mjs", packaged);

// 6) Version and qualification/release routing for the patch release.
const pkg = JSON.parse(await read("package.json"));
pkg.version = "2.0.1";
await write("package.json", JSON.stringify(pkg, null, 2) + "\n");
const lock = JSON.parse(await read("package-lock.json"));
lock.version = "2.0.1";
if (lock.packages?.[""]) lock.packages[""].version = "2.0.1";
await write("package-lock.json", JSON.stringify(lock, null, 2) + "\n");

for (const workflow of [".github/workflows/v2-suite.yml", ".github/workflows/v2-windows-qualification.yml"]) {
  let yml = await read(workflow);
  yml = yml.replace('branches: ["release/v2.0.0"]', 'branches: ["release/v2.0.0", "release/v2.0.1"]');
  await write(workflow, yml);
}

let release = await read(".github/workflows/windows-release.yml");
release = release.replaceAll("2.0.0", "2.0.1");
release = release.replace(
  'Folio 2.0 is a major workflow and publishing update:',
  'Folio 2.0.1 fixes four visible 2.0 regressions: Cathedral is restored to its approved Gothic arch design; Print PDF Preview now uses a stable full-pane visible page layout; Recent Books persists across packaged launches even though Electron uses a changing localhost port; and the Folio wordmark is consistent between the home screen and workspace. The patch also removes the obsolete empty-workspace flash when opening a book. Folio 2.0 remains a major workflow and publishing update:',
);
await write(".github/workflows/windows-release.yml", release);

console.log("Folio 2.0.1 patch prepared.");
