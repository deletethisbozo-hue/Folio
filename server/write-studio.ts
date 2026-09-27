import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { projectInfo, writableBookDir } from "./projects.ts";

export type RevisionKind = "auto" | "snapshot";

export interface WritingTargets {
  book: number | null;
  daily: number | null;
  session: number | null;
  chapters: Record<string, number>;
}

export interface ResearchNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WritingComment {
  id: string;
  sectionId: string;
  quote: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionSummary {
  id: string;
  sectionId: string;
  kind: RevisionKind;
  label?: string;
  createdAt: string;
  wordCount: number;
  chars: number;
  hash: string;
}

export interface WriteStudioState {
  version: 1;
  targets: WritingTargets;
  dailyProgress: Record<string, number>;
  research: ResearchNote[];
  comments: WritingComment[];
  revisions: RevisionSummary[];
}

const EMPTY_TARGETS: WritingTargets = { book: null, daily: null, session: null, chapters: {} };
const DATA_DIR = ".folio-data";
const META_FILE = "write-studio.json";
const HISTORY_DIR = "history";
const AUTO_THROTTLE_MS = 2 * 60 * 1000;
const AUTO_TOTAL_LIMIT = 80;
const AUTO_SECTION_LIMIT = 24;

const mutationTails = new Map<string, Promise<void>>();

function defaultState(): WriteStudioState {
  return {
    version: 1,
    targets: { ...EMPTY_TARGETS, chapters: {} },
    dailyProgress: {},
    research: [],
    comments: [],
    revisions: [],
  };
}

function normaliseState(value: Partial<WriteStudioState> | null | undefined): WriteStudioState {
  const base = defaultState();
  return {
    ...base,
    ...(value ?? {}),
    version: 1,
    targets: {
      ...base.targets,
      ...(value?.targets ?? {}),
      chapters: { ...(value?.targets?.chapters ?? {}) },
    },
    dailyProgress: { ...(value?.dailyProgress ?? {}) },
    research: Array.isArray(value?.research) ? value!.research! : [],
    comments: Array.isArray(value?.comments) ? value!.comments! : [],
    revisions: Array.isArray(value?.revisions) ? value!.revisions! : [],
  };
}

function wordCount(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

function revisionHash(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function readStateAt(folder: string): Promise<WriteStudioState> {
  try {
    const raw = await fs.readFile(path.join(folder, DATA_DIR, META_FILE), "utf8");
    return normaliseState(JSON.parse(raw) as Partial<WriteStudioState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultState();
    throw error;
  }
}

async function writablePaths(projectId: string): Promise<{ folder: string; dataDir: string; historyDir: string; metaFile: string }> {
  const folder = await writableBookDir(projectId);
  const dataDir = path.join(folder, DATA_DIR);
  const historyDir = path.join(dataDir, HISTORY_DIR);
  await fs.mkdir(historyDir, { recursive: true });
  return { folder, dataDir, historyDir, metaFile: path.join(dataDir, META_FILE) };
}

async function saveState(projectId: string, state: WriteStudioState): Promise<void> {
  const { metaFile, dataDir } = await writablePaths(projectId);
  await fs.mkdir(dataDir, { recursive: true });
  const temp = metaFile + ".tmp";
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, metaFile);
}

async function mutateState<T>(projectId: string, mutate: (state: WriteStudioState) => Promise<T> | T): Promise<T> {
  const previous = mutationTails.get(projectId) ?? Promise.resolve();
  let resolveTail!: () => void;
  const tail = new Promise<void>((resolve) => { resolveTail = resolve; });
  mutationTails.set(projectId, previous.catch(() => undefined).then(() => tail));
  await previous.catch(() => undefined);
  try {
    const folder = projectInfo(projectId).folder;
    const state = folder ? await readStateAt(folder) : defaultState();
    const result = await mutate(state);
    await saveState(projectId, state);
    return result;
  } finally {
    resolveTail();
    if (mutationTails.get(projectId) === tail) mutationTails.delete(projectId);
  }
}

function pruneDailyProgress(state: WriteStudioState): void {
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  for (const date of Object.keys(state.dailyProgress)) {
    const time = Date.parse(date + "T00:00:00Z");
    if (Number.isFinite(time) && time < cutoff) delete state.dailyProgress[date];
  }
}

async function removeRevisionFiles(projectId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { historyDir } = await writablePaths(projectId);
  await Promise.all(ids.map((id) => fs.rm(path.join(historyDir, id + ".json"), { force: true }).catch(() => undefined)));
}

async function trimAutoRevisions(projectId: string, state: WriteStudioState): Promise<void> {
  const autos = state.revisions.filter((item) => item.kind === "auto").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const remove = new Set<string>();

  if (autos.length > AUTO_TOTAL_LIMIT) {
    for (const item of autos.slice(0, autos.length - AUTO_TOTAL_LIMIT)) remove.add(item.id);
  }

  const bySection = new Map<string, RevisionSummary[]>();
  for (const item of autos) {
    const list = bySection.get(item.sectionId) ?? [];
    list.push(item);
    bySection.set(item.sectionId, list);
  }
  for (const list of bySection.values()) {
    if (list.length > AUTO_SECTION_LIMIT) {
      for (const item of list.slice(0, list.length - AUTO_SECTION_LIMIT)) remove.add(item.id);
    }
  }

  if (!remove.size) return;
  state.revisions = state.revisions.filter((item) => !remove.has(item.id));
  await removeRevisionFiles(projectId, [...remove]);
}

async function writeRevisionFile(projectId: string, id: string, markdown: string): Promise<void> {
  const { historyDir } = await writablePaths(projectId);
  await fs.writeFile(path.join(historyDir, id + ".json"), JSON.stringify({ markdown }), "utf8");
}

async function appendRevision(
  projectId: string,
  state: WriteStudioState,
  sectionId: string,
  markdown: string,
  kind: RevisionKind,
  label?: string,
): Promise<RevisionSummary> {
  const now = new Date().toISOString();
  const summary: RevisionSummary = {
    id: crypto.randomUUID(),
    sectionId,
    kind,
    label: label?.trim() || undefined,
    createdAt: now,
    wordCount: wordCount(markdown),
    chars: markdown.length,
    hash: revisionHash(markdown),
  };
  await writeRevisionFile(projectId, summary.id, markdown);
  state.revisions.push(summary);
  state.revisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  await trimAutoRevisions(projectId, state);
  return summary;
}

export async function readWriteStudio(projectId: string): Promise<WriteStudioState> {
  const folder = projectInfo(projectId).folder;
  if (!folder) return defaultState();
  const state = await readStateAt(folder);
  pruneDailyProgress(state);
  state.revisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return state;
}

export async function setWritingTargets(projectId: string, targets: Partial<WritingTargets>): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    state.targets = {
      book: targets.book === undefined ? state.targets.book : targets.book,
      daily: targets.daily === undefined ? state.targets.daily : targets.daily,
      session: targets.session === undefined ? state.targets.session : targets.session,
      chapters: targets.chapters === undefined ? state.targets.chapters : { ...targets.chapters },
    };
    return state;
  });
}

export async function addDailyProgress(projectId: string, date: string, delta: number): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid writing-progress date.");
    if (!Number.isFinite(delta) || Math.abs(delta) > 100000) throw new Error("Invalid writing-progress delta.");
    state.dailyProgress[date] = Math.max(0, (state.dailyProgress[date] ?? 0) + Math.round(delta));
    pruneDailyProgress(state);
    return state;
  });
}

export async function createResearchNote(projectId: string, title: string, body: string): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    const now = new Date().toISOString();
    state.research.unshift({
      id: crypto.randomUUID(),
      title: title.trim() || "Untitled note",
      body,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
    return state;
  });
}

export async function updateResearchNote(projectId: string, noteId: string, patch: Partial<Pick<ResearchNote, "title" | "body" | "pinned">>): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    const note = state.research.find((item) => item.id === noteId);
    if (!note) throw new Error("Research note not found.");
    if (patch.title !== undefined) note.title = patch.title.trim() || "Untitled note";
    if (patch.body !== undefined) note.body = patch.body;
    if (patch.pinned !== undefined) note.pinned = Boolean(patch.pinned);
    note.updatedAt = new Date().toISOString();
    state.research.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return state;
  });
}

export async function deleteResearchNote(projectId: string, noteId: string): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    state.research = state.research.filter((item) => item.id !== noteId);
    return state;
  });
}

export async function createWritingComment(projectId: string, sectionId: string, quote: string, body: string): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    const cleanQuote = quote.trim();
    if (!cleanQuote) throw new Error("Select manuscript text before adding a comment.");
    const now = new Date().toISOString();
    state.comments.unshift({
      id: crypto.randomUUID(),
      sectionId,
      quote: cleanQuote.slice(0, 2000),
      body: body.trim(),
      resolved: false,
      createdAt: now,
      updatedAt: now,
    });
    return state;
  });
}

export async function updateWritingComment(projectId: string, commentId: string, patch: Partial<Pick<WritingComment, "body" | "resolved">>): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    const comment = state.comments.find((item) => item.id === commentId);
    if (!comment) throw new Error("Comment not found.");
    if (patch.body !== undefined) comment.body = patch.body.trim();
    if (patch.resolved !== undefined) comment.resolved = Boolean(patch.resolved);
    comment.updatedAt = new Date().toISOString();
    return state;
  });
}

export async function deleteWritingComment(projectId: string, commentId: string): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    state.comments = state.comments.filter((item) => item.id !== commentId);
    return state;
  });
}

export async function createSnapshot(projectId: string, sectionId: string, markdown: string, label?: string): Promise<WriteStudioState> {
  return mutateState(projectId, async (state) => {
    await appendRevision(projectId, state, sectionId, markdown, "snapshot", label);
    return state;
  });
}

export async function maybeRecordAutoRevision(projectId: string, sectionId: string, markdown: string): Promise<void> {
  if (!markdown.trim()) return;
  await mutateState(projectId, async (state) => {
    const hash = revisionHash(markdown);
    const latest = state.revisions
      .filter((item) => item.sectionId === sectionId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (latest?.hash === hash) return;
    const latestAuto = state.revisions
      .filter((item) => item.sectionId === sectionId && item.kind === "auto")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (latestAuto && Date.now() - Date.parse(latestAuto.createdAt) < AUTO_THROTTLE_MS) return;
    await appendRevision(projectId, state, sectionId, markdown, "auto");
  });
}

export async function readRevisionMarkdown(projectId: string, revisionId: string): Promise<{ revision: RevisionSummary; markdown: string }> {
  const state = await readWriteStudio(projectId);
  const revision = state.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new Error("Revision not found.");
  const folder = projectInfo(projectId).folder;
  if (!folder) throw new Error("Project folder not available.");
  const raw = await fs.readFile(path.join(folder, DATA_DIR, HISTORY_DIR, revisionId + ".json"), "utf8");
  const parsed = JSON.parse(raw) as { markdown?: unknown };
  if (typeof parsed.markdown !== "string") throw new Error("Revision data is invalid.");
  return { revision, markdown: parsed.markdown };
}
