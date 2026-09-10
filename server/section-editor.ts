import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { loadProject, projectInfo, writableBookDir } from "./projects.ts";
import { extractSubtitle, extractTitle, splitOnH1 } from "./pipeline/util.ts";
import { removeMatter } from "./matter.ts";
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

export async function readSectionDocument(projectId: string, sectionId: string): Promise<SectionDocument> {
  const { book } = await loadProject(projectId);
  const section = book.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error("Section not found.");
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

function preservedFrontMatter(raw: string): string {
  if (!raw.startsWith("---")) return "";
  const match = raw.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return match?.[0] ?? "";
}

export async function writeSectionDocument(projectId: string, sectionId: string, markdown: string): Promise<void> {
  // Copy-on-write happens before resolving the source. For the bundled sample,
  // this changes the project's root, so the freshly ingested sourcePath points
  // into user-writable temp storage instead of app.asar.
  await writableBookDir(projectId);
  const { book } = await loadProject(projectId);
  const section = book.sections.find((s) => s.id === sectionId);
  if (!section || section.generated) throw new Error("This section is generated and cannot be edited directly.");

  const source = resolveSourceForSection(projectId, section);
  if (!source) throw new Error("Could not locate the source Markdown file for this section.");

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
    await fs.writeFile(source.path, prefix + content, "utf8");
    return;
  }

  const titleInfo = extractTitle(parsed.content);
  const subtitleInfo = extractSubtitle(titleInfo.title ? titleInfo.body : parsed.content);

  const header: string[] = [];
  if (titleInfo.title) header.push(`# ${titleInfo.title}`);
  if (subtitleInfo.subtitle && typeof parsed.data.subtitle !== "string") header.push(`## ${subtitleInfo.subtitle}`);
  const nextBody = [...header, markdown.trim()].filter(Boolean).join("\n\n") + "\n";
  await fs.writeFile(source.path, prefix + nextBody, "utf8");
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
  const { book } = await loadProject(projectId);
  const section = book.sections.find((item) => item.id === sectionId);
  if (!section || section.kind !== "chapter" || section.generated) throw new Error("Only manuscript chapters can be renamed here.");
  const title = change.title === undefined ? section.title : change.title.trim();
  if (!title) throw new Error("Chapter title cannot be empty.");
  const subtitle = change.subtitle === undefined ? section.subtitle : change.subtitle.trim() || undefined;
  const source = resolveSourceForSection(projectId, section);
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
    await fs.writeFile(source.path, preservedFrontMatter(raw) + content, "utf8");
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
    await fs.writeFile(source.path, prefix + content, "utf8");
  }

  const reloaded = await loadProject(projectId);
  const renamed = reloaded.book.sections.find((item) =>
    item.sourcePath === source.path && item.sourceOrdinal === source.ordinal,
  );
  if (!renamed) throw new Error("Chapter was renamed but could not be reloaded.");
  return readSectionDocument(projectId, renamed.id);
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
    await fs.writeFile(sourcePath, preservedFrontMatter(raw) + content, "utf8");
    return;
  }
  if (arranged.some((chapter) => chapter.sourceOrdinal !== undefined)) {
    throw new Error("Chapters from mixed source layouts cannot be reordered together.");
  }
  const relative = arranged.map((chapter) => path.relative(info.folder!, chapter.sourcePath!).split(path.sep).join("/"));
  await saveChapterOrder(info.folder, book.meta, relative);
}

/** Remove an authored chapter/front-matter/back-matter section without
 * destroying it irreversibly. Standalone sources move to .folio-trash; matter
 * is also removed from book.yaml. A chapter inside a combined manuscript is
 * extracted to trash before that H1 section is removed from the source. */
export async function deleteSectionDocument(projectId: string, sectionId: string): Promise<void> {
  await writableBookDir(projectId);
  const { book } = await loadProject(projectId);
  const section = book.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error("Section not found.");
  if (section.generated && (section.kind === "titlepage" || section.kind === "copyright")) {
    const info = projectInfo(projectId);
    if (!info.folder) throw new Error("This book has no writable folder.");
    await removeMatter(info.folder, section.kind);
    return;
  }
  if (section.generated) throw new Error("This generated page cannot be deleted here.");
  if (!(["chapter", "frontmatter", "backmatter"] as string[]).includes(section.kind)) {
    throw new Error("This section cannot be deleted here.");
  }

  const source = resolveSourceForSection(projectId, section);
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
    return;
  }

  const raw = await fs.readFile(source.path, "utf8");
  const parsed = matter(raw);
  const chapters = splitOnH1(parsed.content);
  const removed = chapters[source.ordinal];
  if (!removed) throw new Error("The source chapter moved on disk. Reload the book and try again.");

  const safe = removed.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "chapter";
  await fs.writeFile(path.join(trash, `${stamp}-${safe}.md`), `# ${removed.title}\n\n${removed.body.trim()}\n`, "utf8");
  chapters.splice(source.ordinal, 1);
  const content = chapters.map((item) => `# ${item.title}\n\n${item.body.trim()}`.trim()).join("\n\n");
  await fs.writeFile(source.path, preservedFrontMatter(raw) + (content ? content + "\n" : ""), "utf8");
}
