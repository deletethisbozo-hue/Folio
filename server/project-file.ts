import path from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const FOLIO_PROJECT_EXTENSION = ".folio";
const FORMAT_VERSION = 1;

function normaliseRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeJoin(base: string, rel: string): string {
  const root = path.resolve(base);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Unsafe project entry: ${rel}`);
  }
  return target;
}

function openDatabase(projectFile: string, create = false): DatabaseSync {
  const db = new DatabaseSync(projectFile);
  db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS folio_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL
    );
  `);
  if (create) {
    const set = db.prepare("INSERT OR REPLACE INTO folio_meta(key, value) VALUES (?, ?)");
    set.run("format", "folio-project");
    set.run("version", String(FORMAT_VERSION));
  }
  const row = db.prepare("SELECT value FROM folio_meta WHERE key = 'format'").get() as { value?: string } | undefined;
  if (row?.value !== "folio-project") {
    db.close();
    throw new Error("That file is not a Folio project.");
  }
  return db;
}

export function ensureFolioProjectPath(value: string): string {
  const clean = path.resolve(value.trim());
  return clean.toLocaleLowerCase().endsWith(FOLIO_PROJECT_EXTENSION) ? clean : clean + FOLIO_PROJECT_EXTENSION;
}

export async function createEmptyFolioProject(projectFile: string): Promise<string> {
  const file = ensureFolioProjectPath(projectFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.access(file);
    throw new Error(`A project already exists at ${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = openDatabase(file, true);
  db.close();
  return file;
}

async function listFiles(root: string): Promise<Array<{ rel: string; full: string; size: number; mtime: number }>> {
  const result: Array<{ rel: string; full: string; size: number; mtime: number }> = [];
  async function walk(current: string, prefix = ""): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = normaliseRel(prefix ? `${prefix}/${entry.name}` : entry.name);
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        result.push({ rel, full, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  await walk(root);
  return result;
}

export async function syncDirectoryToFolioProject(projectFile: string, workingDir: string): Promise<void> {
  const file = ensureFolioProjectPath(projectFile);
  const files = await listFiles(workingDir);
  const db = openDatabase(file);
  try {
    const currentRows = db.prepare("SELECT path, size, mtime FROM files").all() as Array<{ path: string; size: number; mtime: number }>;
    const current = new Map(currentRows.map((row) => [row.path, row]));
    const incoming = new Set(files.map((entry) => entry.rel));
    const upsert = db.prepare("INSERT OR REPLACE INTO files(path, data, size, mtime) VALUES (?, ?, ?, ?)");
    const remove = db.prepare("DELETE FROM files WHERE path = ?");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of files) {
        const existing = current.get(entry.rel);
        if (existing && Number(existing.size) === entry.size && Math.abs(Number(existing.mtime) - entry.mtime) < 0.01) continue;
        const data = await fs.readFile(entry.full);
        upsert.run(entry.rel, data, entry.size, entry.mtime);
      }
      for (const row of currentRows) {
        if (!incoming.has(row.path)) remove.run(row.path);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function extractFolioProject(projectFile: string, workingDir: string): Promise<void> {
  const file = ensureFolioProjectPath(projectFile);
  const db = openDatabase(file);
  try {
    const rows = db.prepare("SELECT path, data, mtime FROM files ORDER BY path").all() as Array<{ path: string; data: Uint8Array; mtime: number }>;
    await fs.mkdir(workingDir, { recursive: true });
    for (const row of rows) {
      const rel = normaliseRel(row.path);
      const full = safeJoin(workingDir, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, Buffer.from(row.data));
      const when = new Date(Number(row.mtime) || Date.now());
      await fs.utimes(full, when, when).catch(() => undefined);
    }
  } finally {
    db.close();
  }
}

export async function importFolderIntoFolioProject(sourceDir: string, projectFile: string): Promise<string> {
  const file = await createEmptyFolioProject(projectFile);
  try {
    await syncDirectoryToFolioProject(file, sourceDir);
    return file;
  } catch (error) {
    await fs.rm(file, { force: true }).catch(() => undefined);
    throw error;
  }
}

export interface FolioProjectWatcher {
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

export function watchFolioProject(projectFile: string, workingDir: string): FolioProjectWatcher {
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let tail: Promise<void> = Promise.resolve();

  const queueSync = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      tail = tail.then(
        () => syncDirectoryToFolioProject(projectFile, workingDir),
        () => syncDirectoryToFolioProject(projectFile, workingDir),
      );
    }, 90);
  };

  try {
    watcher = watch(workingDir, { recursive: true }, queueSync);
    watcher.on("error", () => queueSync());
  } catch {
    watcher = null;
  }

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await tail;
    await syncDirectoryToFolioProject(projectFile, workingDir);
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    watcher?.close();
    watcher = null;
    await flush();
  };

  return { flush, close };
}
