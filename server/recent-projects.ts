import { promises as fs } from "node:fs";
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
function folderKey(folder: string): string { return folder.replace(/[\\/]+$/, "").toLocaleLowerCase(); }

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
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
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
