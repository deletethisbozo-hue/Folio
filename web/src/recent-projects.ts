import type { BookMeta, ProjectSummary } from "./types";

export interface RecentProject {
  folder: string;
  title: string;
  author: string;
  lastOpened: number;
}

const STORAGE_KEY = "folio-recent-projects-v1";
const MAX_RECENT = 8;
let trackingInstalled = false;

function folderKey(folder: string): string {
  return folder.replace(/[\\/]+$/, "").toLocaleLowerCase();
}

export function mergeRecentProjects(
  current: RecentProject[],
  summary: ProjectSummary,
  now = Date.now(),
): RecentProject[] {
  if (summary.source !== "folder" || !summary.folder) return current;
  const key = folderKey(summary.folder);
  const entry: RecentProject = {
    folder: summary.folder,
    title: summary.meta.title || "Untitled",
    author: summary.meta.author || "Unknown Author",
    lastOpened: now,
  };
  return [entry, ...current.filter((item) => folderKey(item.folder) !== key)]
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, MAX_RECENT);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecentProjects(): RecentProject[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentProject => {
        if (!item || typeof item !== "object") return false;
        const value = item as Partial<RecentProject>;
        return typeof value.folder === "string" && typeof value.title === "string" &&
          typeof value.author === "string" && typeof value.lastOpened === "number";
      })
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecentProject(summary: ProjectSummary, now = Date.now()): RecentProject[] {
  const next = mergeRecentProjects(readRecentProjects(), summary, now);
  const store = storage();
  try { store?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local history is best-effort */ }
  return next;
}

export function forgetRecentProject(folder: string): RecentProject[] {
  const key = folderKey(folder);
  const next = readRecentProjects().filter((item) => folderKey(item.folder) !== key);
  const store = storage();
  try { store?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local history is best-effort */ }
  return next;
}

function syncCurrentProjectUrl(summary: ProjectSummary): void {
  if (summary.source !== "folder" || !summary.folder || typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("book", summary.folder);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* A stale browser URL must never stop a book from opening. */
  }
}

type TrackableApi = {
  openFolder: (folderPath: string) => Promise<ProjectSummary>;
  newBook: (folderPath: string, title: string, author: string) => Promise<ProjectSummary>;
  saveMeta: (projectId: string, meta: BookMeta) => Promise<ProjectSummary>;
};

/**
 * Keep the start screen history in one place regardless of whether a book was
 * opened from the start screen, the in-workspace Open button, or just created.
 * The API object is shared by every UI module, so installing this once at boot
 * also keeps the ?book= deep link aligned with whichever project is actually open.
 */
export function installRecentProjectTracking(client: TrackableApi): void {
  if (trackingInstalled) return;
  trackingInstalled = true;

  const openFolder = client.openFolder;
  client.openFolder = async (folderPath) => {
    const summary = await openFolder(folderPath);
    rememberRecentProject(summary);
    syncCurrentProjectUrl(summary);
    return summary;
  };

  const newBook = client.newBook;
  client.newBook = async (folderPath, title, author) => {
    const summary = await newBook(folderPath, title, author);
    rememberRecentProject(summary);
    syncCurrentProjectUrl(summary);
    return summary;
  };

  const saveMeta = client.saveMeta;
  client.saveMeta = async (projectId, meta) => {
    const summary = await saveMeta(projectId, meta);
    // Refresh the card title/author while preserving the fact that this is the
    // currently active project. A metadata edit counts as current activity.
    rememberRecentProject(summary);
    return summary;
  };
}
