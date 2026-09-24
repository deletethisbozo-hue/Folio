import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RecentProjectRecord {
  path: string;
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
function pathKey(projectPath: string): string { return projectPath.replace(/[\\/]+$/, "").toLocaleLowerCase(); }
function isFolioProjectFile(projectPath: string): boolean {
  return /\.folio$/i.test(projectPath.trim().replace(/[\\/]+$/, ""));
}

function normaliseRecord(value: unknown): RecentProjectRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RecentProjectRecord> & { folder?: unknown };
  const projectPath = typeof item.path === "string" ? item.path : typeof item.folder === "string" ? item.folder : null;
  if (!projectPath || !isFolioProjectFile(projectPath) || typeof item.title !== "string" || typeof item.author !== "string" || typeof item.lastOpened !== "number") return null;
  return { path: projectPath, title: item.title, author: item.author, lastOpened: item.lastOpened };
}

export async function readRecentProjects(): Promise<RecentProjectRecord[]> {
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normaliseRecord).filter((item): item is RecentProjectRecord => Boolean(item)).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, MAX_RECENT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

async function writeRecentProjects(items: RecentProjectRecord[]): Promise<void> {
  const dir = storeDir();
  await fs.mkdir(dir, { recursive: true });
  const file = storeFile();
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
  await fs.writeFile(temp, JSON.stringify(items.slice(0, MAX_RECENT), null, 2), "utf8");
  await fs.rename(temp, file);
}

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(operation, operation);
  mutationTail = run.then(() => undefined, () => undefined);
  return run;
}

export async function rememberRecentProject(projectPath: string, title: string, author: string, now = Date.now()): Promise<RecentProjectRecord[]> {
  return serializeMutation(async () => {
    const current = await readRecentProjects();
    if (!isFolioProjectFile(projectPath)) return current;
    const key = pathKey(projectPath);
    const entry: RecentProjectRecord = {
      path: projectPath,
      title: title.trim() || "Untitled",
      author: author.trim() || "Unknown Author",
      lastOpened: now,
    };
    const next = [entry, ...current.filter((item) => pathKey(item.path) !== key)]
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, MAX_RECENT);
    await writeRecentProjects(next);
    return next;
  });
}

export async function forgetRecentProject(projectPath: string): Promise<RecentProjectRecord[]> {
  return serializeMutation(async () => {
    const key = pathKey(projectPath);
    const next = (await readRecentProjects()).filter((item) => pathKey(item.path) !== key);
    await writeRecentProjects(next);
    return next;
  });
}
