import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { loadProject, projectInfo, writableBookDir } from "./projects.ts";
import { extractSubtitle, extractTitle, splitOnH1 } from "./pipeline/util.ts";
import type { Section } from "./pipeline/types.ts";
import { removeMatter } from "./matter.ts";
import { atomicWriteUtf8 } from "./atomic-write.ts";
import { saveChapterOrder } from "./matter.ts";

export interface SectionDocument {
  id: string;
  title: string;
  subtitle?: string;
  kind: string;
  markdown: string;
  editable: boolean;
}

type SourceSection = {
  generated?: boolean;
  sourcePath?: string;
  sourceOrdinal?: number;
};

// The UI always reads a section before editing it. Keep the already-ingested
// section locations around so a later autosave/delete does not re-parse a
// 100k-word manuscript just to rediscover the path we resolved moments ago.
// Explicit project reloads still go through loadProject, and any operation that
// can change ids/ordinals refreshes or invalidates this cache.
const sectionCache = new Map<string, Map<string, Section>>();

function rememberSections(projectId: string, sections: Section[]): void {
  sectionCache.set(projectId, new Map(sections.map((section) => [section.id, section])));
}

function cachedSection(projectId: string, sectionId: string): Section | undefined {
  return sectionCache.get(projectId)?.get(sectionId);
}

function forgetSection(projectId: string, sectionId: string): void {
  sectionCache.get(projectId)?.delete(sectionId);
}

function documentFromSection(projectId: string, section: Section): SectionDocument {
  const source = resolveSourceForSection(projectId, section);
  return {
    id: section.id,
    title: section.title,
    subtitle: section.subtitle,
    kind: section.kind,
    markdown: section.markdown,
    editable: Boolean(source && projectInfo(projectId).editable),
  };
}

/** Resolve an already-ingested section without loading the whole project again.
 * Large manuscripts make a second load surprisingly expensive; all editor
 * operations already have the authoritative section in hand. */
function resolveSourceForSection(projectId: string, section: SourceSection | undefined): { path: string; ordinal?: number } | null {
  if (!section || section.generated || !section.sourcePath) return null;

  const info = projectInfo(projectId);
  if (!info.folder) return null;
  const folder = path.resolve(info.folder);
  const source = path.resolve(section.sourcePath);
  const rel = path.relative(folder, source);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return { path: source, ordinal: section.sourceOrdinal };
}

async function editableSection(projectId: string, sectionId: string): Promise<{ section: Section; source: { path: string; ordinal?: number } }> {
  let section = cachedSection(projectId, sectionId);
  let source = resolveSourceForSection(projectId, section);
  if (!section || section.generated || !source) {
    const { book } = await loadProject(projectId);
    rememberSections(projectId, book.sections);
    section = book.sections.find((item) => item.id === sectionId);
    source = resolveSourceForSection(projectId, section);
  }
  if (!section || section.generated) throw new Error("This section is generated and cannot be edited directly.");
  if (!source) throw new Error("Could not locate the source Markdown file for this section.");
  return { section, source };
}

export async function readSectionDocument(projectId: string, sectionId: string): Promise<SectionDocument> {
  const { book } = await loadProject(projectId);
  rememberSections(projectId, book.sections);
  const section = book.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error("Section not found.");
  return documentFromSection(projectId, section);
}

function preservedFrontMatter(raw: string): string {
  if (!raw.startsWith("---")) return "";
  const match = raw.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return match?.[0] ?? "";
}

export async function writeSectionDocument(projectId: string, sectionId: string, markdown: string): Promise<void> {
  // Copy-on-write happens before resolving the source. If that changes the
  // sample's root, editableSection notices the cached old path is no longer
  // inside the project and performs one fresh ingest.
  await writableBookDir(projectId);
  const { section, source } = await editableSection(projectId, sectionId);

  const raw = await fs.readFile(source.path, "utf8");
  const parsed = matter(raw);
  const prefix = preservedFrontMatter(raw);

  if (source.ordinal !== undefined) {
    const chapters = splitOnH1(parsed.content);
    const chapter = chapters[source.ordinal];
    if (!chapter) throw new Error("The source chapter moved on disk. Reload the book and try again.");
    const subtitle = section.subtitle ? `## ${section.subtitle}\n\n` : "";
    chapter.body = `${subtitle}${markdown.trim()}`.trim();
    const content = chapters.map((item) => `# ${item.title}\n\n${item.body.trim()}`.trim()).join("\n\n") + "\n";
    await atomicWriteUtf8(source.path, prefix + content, "utf8");
    section.markdown = markdown.trim();
    return;
  }

  const titleInfo = extractTitle(parsed.content);
  const subtitleInfo = extractSubtitle(titleInfo.title ? titleInfo.body : parsed.content);

  const header: string[] = [];
  if (titleInfo.title) header.push(`# ${titleInfo.title}`);
  if (subtitleInfo.subtitle && typeof parsed.data.subtitle !== "string") header.push(`## ${subtitleInfo.subtitle}`);
  const nextBody = [...header, markdown.trim()].filter(Boolean).join("\n\n") + "\n";
  await atomicWriteUtf8(source.path, prefix + nextBody, "utf8");
  section.markdown = markdown.trim();
}

/** Rename a chapter at its authoritative source, including chapters embedded in
 * one combined manuscript. Returns the re-ingested document because its slug/id
 * may change with the title. */
export async function updateSectionHeadingDocument(
  projectId: string,
  sectionId: string,
  change: { title?: string; subtitle?: string },
): Promise<SectionDocument> {
  await writableBookDir(projectId);
  let section = cachedSection(projectId, sectionId);
  let source = resolveSourceForSection(projectId, section);
  if (!section || section.kind !== "chapter" || section.generated || !source) {
    const loaded = await loadProject(projectId);
    rememberSections(projectId, loaded.book.sections);
    section = loaded.book.sections.find((item) => item.id === sectionId);
    source = resolveSourceForSection(projectId, section);
  }
  if (!section || section.kind !== "chapter" || section.generated) throw new Error("Only manuscript chapters can be renamed here.");
  const title = change.title === undefined ? section.title : change.title.trim();
  if (!title) throw new Error("Chapter title cannot be empty.");
  const subtitle = change.subtitle === undefined ? section.subtitle : change.subtitle.trim() || undefined;
  if (!source) throw new Error("Could not locate the source Markdown file for this chapter.");

  const raw = await fs.readFile(source.path, "utf8");
  const parsed = matter(raw);
  if (source.ordinal !== undefined) {
    const chapters = splitOnH1(parsed.content);
    const chapter = chapters[source.ordinal];
    if (!chapter) throw new Error("The source chapter moved on disk. Reload the book and try again.");
    chapter.title = title;
    const body = extractSubtitle(chapter.body).body.trim();
    chapter.body = [subtitle ? `## ${subtitle}` : "", body].filter(Boolean).join("\n\n");
    const content = chapters.map((item) => `# ${item.title}\n\n${item.body.trim()}`.trim()).join("\n\n") + "\n";
    await atomicWriteUtf8(source.path, preservedFrontMatter(raw) + content, "utf8");
  } else {
    let prefix = preservedFrontMatter(raw);
    const titleInfo = extractTitle(parsed.content);
    const subtitleInfo = extractSubtitle(titleInfo.title ? titleInfo.body : parsed.content);
    const titleInFrontMatter = prefix !== "" && typeof parsed.data.title === "string";
    const subtitleInFrontMatter = prefix !== "" && typeof parsed.data.subtitle === "string";
    if (titleInFrontMatter) prefix = replaceFrontMatterField(prefix, "title", title);
    if (subtitleInFrontMatter) prefix = replaceFrontMatterField(prefix, "subtitle", subtitle);
    const headings = [titleInFrontMatter ? "" : `# ${title}`, subtitleInFrontMatter || !subtitle ? "" : `## ${subtitle}`].filter(Boolean);
    const content = [...headings, subtitleInfo.body.trim()].filter(Boolean).join("\n\n") + "\n";
    await atomicWriteUtf8(source.path, prefix + content, "utf8");
  }

  const reloaded = await loadProject(projectId);
  rememberSections(projectId, reloaded.book.sections);
  const renamed = reloaded.book.sections.find((item) =>
    item.sourcePath === source.path && item.sourceOrdinal === source.ordinal,
  );
  if (!renamed) throw new Error("Chapter was renamed but could not be reloaded.");
  return documentFromSection(projectId, renamed);
}

function replaceFrontMatterField(prefix: string, key: string, value: string | undefined): string {
  const line = new RegExp(`^${key}\\s*:\\s*.*(?:\\r?\\n|$)`, "m");
  if (line.test(prefix)) return prefix.replace(line, value ? `${key}: ${JSON.stringify(value)}\n` : "");
  if (!value) return prefix;
  return prefix.replace(/---[ \t]*(\r?\n?)$/, `${key}: ${JSON.stringify(value)}\n---$1`);
}

export async function renameSectionDocument(projectId: string, sectionId: string, nextTitle: string): Promise<SectionDocument> {
  return updateSectionHeadingDocument(projectId, sectionId, { title: nextTitle });
}

/** Reorder all chapters by stable section id. Standalone files keep their names;
 * combined manuscripts have their complete H1 blocks moved without rewriting
 * any chapter body. */
export async function reorderChapterDocuments(projectId: string, order: string[]): Promise<void> {
  await writableBookDir(projectId);
  const { book } = await loadProject(projectId);
  rememberSections(projectId, book.sections);
  const chapters = book.sections.filter((section) => section.kind === "chapter" && !section.generated);
  if (order.length !== chapters.length || new Set(order).size !== order.length || chapters.some((chapter) => !order.includes(chapter.id))) {
    throw new Error("Chapter order must contain every chapter exactly once.");
  }
  const arranged = order.map((id) => chapters.find((chapter) => chapter.id === id)!);
  if (arranged.some((chapter) => !chapter.sourcePath)) throw new Error("A chapter has no reorderable source file.");
  const paths = new Set(arranged.map((chapter) => chapter.sourcePath!));
  const info = projectInfo(projectId);
  if (!info.folder) throw new Error("This book has no writable folder.");

  if (paths.size === 1 && arranged.every((chapter) => chapter.sourceOrdinal !== undefined)) {
    const sourcePath = arranged[0].sourcePath!;
    const raw = await fs.readFile(sourcePath, "utf8");
    const parsed = matter(raw);
    const blocks = splitOnH1(parsed.content);
    const content = arranged.map((chapter) => {
      const block = blocks[chapter.sourceOrdinal!];
      if (!block) throw new Error("The manuscript changed on disk. Reload and try again.");
      return `# ${block.title}\n\n${block.body.trim()}`.trim();
    }).join("\n\n") + "\n";
    await atomicWriteUtf8(sourcePath, preservedFrontMatter(raw) + content, "utf8");
    sectionCache.delete(projectId);
    return;
  }
  if (arranged.some((chapter) => chapter.sourceOrdinal !== undefined)) {
    throw new Error("Chapters from mixed source layouts cannot be reordered together.");
  }
  const relative = arranged.map((chapter) => path.relative(info.folder!, chapter.sourcePath!).split(path.sep).join("/"));
  await saveChapterOrder(info.folder, book.meta, relative);
  sectionCache.delete(projectId);
}

/** Remove an authored chapter/front-matter/back-matter section without
 * destroying it irreversibly. Standalone sources move to .folio-trash; matter
 * is also removed from book.yaml. A chapter inside a combined manuscript is
 * extracted to trash before that H1 section is removed from the source. */
export async function deleteSectionDocument(projectId: string, sectionId: string): Promise<void> {
  await writableBookDir(projectId);

  let section = cachedSection(projectId, sectionId);
  // Cached source paths from the bundled sample become invalid after its first
  // copy-on-write. Resolve them now; if they no longer belong to the project,
  // one fresh ingest repairs the cache. Normal selected-section deletes stay O(1).
  let source = resolveSourceForSection(projectId, section);
  if (!section || (!section.generated && !source)) {
    const loaded = await loadProject(projectId);
    rememberSections(projectId, loaded.book.sections);
    section = loaded.book.sections.find((item) => item.id === sectionId);
    source = resolveSourceForSection(projectId, section);
  }
  if (!section) throw new Error("Section not found.");

  if (section.generated && (section.kind === "titlepage" || section.kind === "copyright")) {
    const info = projectInfo(projectId);
    if (!info.folder) throw new Error("This book has no writable folder.");
    await removeMatter(info.folder, section.kind);
    forgetSection(projectId, sectionId);
    return;
  }
  if (section.generated) throw new Error("This generated page cannot be deleted here.");
  if (!(["chapter", "frontmatter", "backmatter"] as string[]).includes(section.kind)) {
    throw new Error("This section cannot be deleted here.");
  }

  if (!source) throw new Error("Could not locate the source Markdown file for this chapter.");
  const info = projectInfo(projectId);
  if (!info.folder) throw new Error("This chapter has no writable book folder.");

  const trash = path.join(info.folder, ".folio-trash");
  await fs.mkdir(trash, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (source.ordinal === undefined) {
    const destination = path.join(trash, `${stamp}-${path.basename(source.path)}`);
    await fs.rename(source.path, destination);
    if (section.kind === "frontmatter" || section.kind === "backmatter") {
      const entry = path.relative(info.folder, source.path).split(path.sep).join("/");
      await removeMatter(info.folder, entry);
    }
    forgetSection(projectId, sectionId);
    return;
  }

  const raw = await fs.readFile(source.path, "utf8");
  const parsed = matter(raw);
  const chapters = splitOnH1(parsed.content);
  const removed = chapters[source.ordinal];
  if (!removed) throw new Error("The source chapter moved on disk. Reload the book and try again.");

  const safe = removed.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "chapter";
  await atomicWriteUtf8(path.join(trash, `${stamp}-${safe}.md`), `# ${removed.title}\n\n${removed.body.trim()}\n`, "utf8");
  chapters.splice(source.ordinal, 1);
  const content = chapters.map((item) => `# ${item.title}\n\n${item.body.trim()}`.trim()).join("\n\n");
  await atomicWriteUtf8(source.path, preservedFrontMatter(raw) + (content ? content + "\n" : ""), "utf8");
  // Every later sourceOrdinal changed, so stale cached locations are unsafe.
  sectionCache.delete(projectId);
}
