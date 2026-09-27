import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { loadProject, projectInfo, writableBookDir } from "./projects.ts";
import { updateSectionHeadingDocument, writeSectionDocument } from "./section-editor.ts";

export type RevisionKind = "auto" | "snapshot";
export type RevisionScope = "section" | "book";
const BOOK_REVISION_ID = "__book__";

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

export interface ResearchImage {
  id: string;
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  storedName: string;
  createdAt: string;
}

export interface WritingComment {
  id: string;
  sectionId: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionSummary {
  id: string;
  sectionId: string;
  scope: RevisionScope;
  kind: RevisionKind;
  label?: string;
  sectionCount?: number;
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
  researchImages: ResearchImage[];
  comments: WritingComment[];
  revisions: RevisionSummary[];
}

const EMPTY_TARGETS: WritingTargets = { book: null, daily: null, session: null, chapters: {} };
const DATA_DIR = ".folio-data";
const META_FILE = "write-studio.json";
const HISTORY_DIR = "history";
const RESEARCH_IMAGES_DIR = "research-images";
const AUTO_THROTTLE_MS = 2 * 60 * 1000;
const AUTO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AUTO_TOTAL_LIMIT = 80;
const AUTO_SECTION_LIMIT = 24;

const mutationTails = new Map<string, Promise<void>>();

function defaultState(): WriteStudioState {
  return {
    version: 1,
    targets: { ...EMPTY_TARGETS, chapters: {} },
    dailyProgress: {},
    research: [],
    researchImages: [],
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
    researchImages: Array.isArray(value?.researchImages) ? value!.researchImages! : [],
    comments: Array.isArray(value?.comments) ? value!.comments! : [],
    revisions: Array.isArray(value?.revisions)
      ? value!.revisions!.map((item) => ({ ...item, scope: item.scope ?? "section" }))
      : [],
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
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  mutationTails.set(projectId, current);
  await previous.catch(() => undefined);
  try {
    const folder = projectInfo(projectId).folder;
    const state = folder ? await readStateAt(folder) : defaultState();
    const result = await mutate(state);
    await saveState(projectId, state);
    return result;
  } finally {
    release();
    if (mutationTails.get(projectId) === current) mutationTails.delete(projectId);
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
  const cutoff = Date.now() - AUTO_RETENTION_MS;
  for (const item of autos) {
    if (Date.parse(item.createdAt) < cutoff) remove.add(item.id);
  }

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
    scope: "section",
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

export async function readWritingWordCounts(projectId: string): Promise<{ total: number; sections: Record<string, number> }> {
  const { book } = await loadProject(projectId);
  const sections: Record<string, number> = {};
  let total = 0;
  for (const section of book.sections) {
    const count = wordCount(section.markdown);
    sections[section.id] = count;
    if (section.kind === "chapter" || section.kind === "backmatter") total += count;
  }
  return { total, sections };
}

export async function readWriteStudio(projectId: string): Promise<WriteStudioState> {
  const folder = projectInfo(projectId).folder;
  if (!folder) return defaultState();
  const state = await readStateAt(folder);
  pruneDailyProgress(state);
  state.revisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return state;
}

export async function migrateWriteStudioSectionId(projectId: string, previousSectionId: string, nextSectionId: string): Promise<WriteStudioState> {
  if (!previousSectionId || !nextSectionId || previousSectionId === nextSectionId) return readWriteStudio(projectId);
  return mutateState(projectId, (state) => {
    const previousTarget = state.targets.chapters[previousSectionId];
    if (previousTarget !== undefined) {
      if (state.targets.chapters[nextSectionId] === undefined) state.targets.chapters[nextSectionId] = previousTarget;
      delete state.targets.chapters[previousSectionId];
    }
    state.comments = state.comments.map((item) =>
      item.sectionId === previousSectionId ? { ...item, sectionId: nextSectionId } : item,
    );
    state.revisions = state.revisions.map((item) =>
      item.scope === "section" && item.sectionId === previousSectionId ? { ...item, sectionId: nextSectionId } : item,
    );
    return state;
  });
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
    state.research.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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

export async function addResearchImage(
  projectId: string,
  filename: string,
  mimeType: ResearchImage["mimeType"],
  buffer: Buffer,
): Promise<WriteStudioState> {
  return mutateState(projectId, async (state) => {
    const id = crypto.randomUUID();
    const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
    const storedName = id + extension;
    const folder = await writableBookDir(projectId);
    const imageDir = path.join(folder, DATA_DIR, RESEARCH_IMAGES_DIR);
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, storedName), buffer);
    state.researchImages.unshift({
      id,
      filename: path.basename(filename).slice(0, 180) || "reference" + extension,
      mimeType,
      storedName,
      createdAt: new Date().toISOString(),
    });
    return state;
  });
}

export async function deleteResearchImage(projectId: string, imageId: string): Promise<WriteStudioState> {
  return mutateState(projectId, async (state) => {
    const image = state.researchImages.find((item) => item.id === imageId);
    if (!image) return state;
    const folder = await writableBookDir(projectId);
    await fs.rm(path.join(folder, DATA_DIR, RESEARCH_IMAGES_DIR, image.storedName), { force: true }).catch(() => undefined);
    state.researchImages = state.researchImages.filter((item) => item.id !== imageId);
    return state;
  });
}

export async function readResearchImage(projectId: string, imageId: string): Promise<{ image: ResearchImage; buffer: Buffer }> {
  const state = await readWriteStudio(projectId);
  const image = state.researchImages.find((item) => item.id === imageId);
  if (!image) throw new Error("Research image not found.");
  const folder = projectInfo(projectId).folder;
  if (!folder) throw new Error("Project folder not available.");
  const buffer = await fs.readFile(path.join(folder, DATA_DIR, RESEARCH_IMAGES_DIR, image.storedName));
  return { image, buffer };
}

export async function createWritingComment(
  projectId: string,
  sectionId: string,
  quote: string,
  body: string,
  prefix?: string,
  suffix?: string,
): Promise<WriteStudioState> {
  return mutateState(projectId, (state) => {
    const cleanQuote = quote.trim();
    if (!cleanQuote) throw new Error("Select manuscript text before adding a comment.");
    const now = new Date().toISOString();
    state.comments.unshift({
      id: crypto.randomUUID(),
      sectionId,
      quote: cleanQuote.slice(0, 2000),
      prefix: prefix?.slice(-160) || undefined,
      suffix: suffix?.slice(0, 160) || undefined,
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

type BookSnapshotEntry = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  source: string;
  sourceOrdinal?: number;
  markdown: string;
};

export async function createBookSnapshot(projectId: string, label?: string): Promise<WriteStudioState> {
  return mutateState(projectId, async (state) => {
    const info = projectInfo(projectId);
    if (!info.folder) throw new Error("Project folder not available.");
    const { book } = await loadProject(projectId);
    const root = path.resolve(info.folder);
    const entries: BookSnapshotEntry[] = book.sections
      .filter((section) => !section.generated && section.sourcePath)
      .map((section) => ({
        id: section.id,
        kind: section.kind,
        title: section.title,
        subtitle: section.subtitle,
        source: path.relative(root, path.resolve(section.sourcePath!)).split(path.sep).join("/"),
        sourceOrdinal: section.sourceOrdinal,
        markdown: section.markdown,
      }));

    const payload = JSON.stringify({ sections: entries });
    const summary: RevisionSummary = {
      id: crypto.randomUUID(),
      sectionId: BOOK_REVISION_ID,
      scope: "book",
      kind: "snapshot",
      label: label?.trim() || undefined,
      createdAt: new Date().toISOString(),
      wordCount: entries.reduce((sum, item) => sum + wordCount(item.markdown), 0),
      chars: payload.length,
      hash: revisionHash(payload),
      sectionCount: entries.length,
    };
    const { historyDir } = await writablePaths(projectId);
    await fs.writeFile(path.join(historyDir, summary.id + ".json"), payload, "utf8");
    state.revisions.push(summary);
    state.revisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return state;
  });
}

export async function restoreBookSnapshot(projectId: string, revisionId: string): Promise<{ restored: number; skipped: string[] }> {
  const state = await readWriteStudio(projectId);
  const revision = state.revisions.find((item) => item.id === revisionId && item.scope === "book");
  if (!revision) throw new Error("Book snapshot not found.");

  const info = projectInfo(projectId);
  if (!info.folder) throw new Error("Project folder not available.");
  const raw = await fs.readFile(path.join(info.folder, DATA_DIR, HISTORY_DIR, revisionId + ".json"), "utf8");
  const parsed = JSON.parse(raw) as { sections?: BookSnapshotEntry[] };
  if (!Array.isArray(parsed.sections)) throw new Error("Book snapshot data is invalid.");

  let restored = 0;
  const skipped: string[] = [];
  for (const saved of parsed.sections) {
    const current = await loadProject(projectId);
    const root = path.resolve(projectInfo(projectId).folder!);
    const match = current.book.sections.find((section) =>
      !section.generated
      && section.sourcePath
      && path.relative(root, path.resolve(section.sourcePath)).split(path.sep).join("/") === saved.source
      && section.sourceOrdinal === saved.sourceOrdinal,
    );
    if (!match) {
      skipped.push(saved.title);
      continue;
    }
    let targetId = match.id;
    if (saved.kind === "chapter" && (match.title !== saved.title || (match.subtitle ?? "") !== (saved.subtitle ?? ""))) {
      const previousSectionId = match.id;
      const renamed = await updateSectionHeadingDocument(projectId, previousSectionId, {
        title: saved.title,
        subtitle: saved.subtitle ?? "",
      });
      targetId = renamed.id;
      if (targetId !== previousSectionId) {
        await migrateWriteStudioSectionId(projectId, previousSectionId, targetId);
      }
    }
    await writeSectionDocument(projectId, targetId, saved.markdown);
    restored++;
  }
  return { restored, skipped };
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

export async function readRevisionMarkdown(projectId: string, revisionId: string): Promise<{ revision: RevisionSummary; markdown?: string; sections?: BookSnapshotEntry[] }> {
  const state = await readWriteStudio(projectId);
  const revision = state.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new Error("Revision not found.");
  const folder = projectInfo(projectId).folder;
  if (!folder) throw new Error("Project folder not available.");
  const raw = await fs.readFile(path.join(folder, DATA_DIR, HISTORY_DIR, revisionId + ".json"), "utf8");
  const parsed = JSON.parse(raw) as { markdown?: unknown; sections?: unknown };
  if (revision.scope === "book") {
    if (!Array.isArray(parsed.sections)) throw new Error("Book revision data is invalid.");
    return { revision, sections: parsed.sections as BookSnapshotEntry[] };
  }
  if (typeof parsed.markdown !== "string") throw new Error("Revision data is invalid.");
  return { revision, markdown: parsed.markdown };
}
