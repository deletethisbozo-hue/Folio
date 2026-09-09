import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { loadProject, projectInfo, writableBookDir } from "./projects.ts";
import { extractSubtitle, extractTitle, splitOnH1 } from "./pipeline/util.ts";

export interface SectionDocument {
  id: string;
  title: string;
  subtitle?: string;
  kind: string;
  markdown: string;
  editable: boolean;
}

async function resolveSource(projectId: string, sectionId: string): Promise<{ path: string; ordinal?: number } | null> {
  const { book } = await loadProject(projectId);
  const section = book.sections.find((s) => s.id === sectionId);
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
  const source = await resolveSource(projectId, sectionId);
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

  const source = await resolveSource(projectId, sectionId);
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
export async function renameSectionDocument(projectId: string, sectionId: string, nextTitle: string): Promise<SectionDocument> {
  const title = nextTitle.trim();
  if (!title) throw new Error("Chapter title cannot be empty.");
  await writableBookDir(projectId);
  const { book } = await loadProject(projectId);
  const section = book.sections.find((item) => item.id === sectionId);
  if (!section || section.kind !== "chapter" || section.generated) throw new Error("Only manuscript chapters can be renamed here.");
  const source = await resolveSource(projectId, sectionId);
  if (!source) throw new Error("Could not locate the source Markdown file for this chapter.");

  const raw = await fs.readFile(source.path, "utf8");
  const parsed = matter(raw);
  if (source.ordinal !== undefined) {
    const chapters = splitOnH1(parsed.content);
    const chapter = chapters[source.ordinal];
    if (!chapter) throw new Error("The source chapter moved on disk. Reload the book and try again.");
    chapter.title = title;
    const content = chapters.map((item) => `# ${item.title}\n\n${item.body.trim()}`.trim()).join("\n\n") + "\n";
    await fs.writeFile(source.path, preservedFrontMatter(raw) + content, "utf8");
  } else if (raw.startsWith("---") && typeof parsed.data.title === "string") {
    const prefix = preservedFrontMatter(raw).replace(/^title\s*:\s*.*$/m, `title: ${JSON.stringify(title)}`);
    await fs.writeFile(source.path, prefix + parsed.content, "utf8");
  } else if (/^#\s+.+$/m.test(parsed.content)) {
    await fs.writeFile(source.path, preservedFrontMatter(raw) + parsed.content.replace(/^#\s+.+$/m, `# ${title}`), "utf8");
  } else {
    await fs.writeFile(source.path, preservedFrontMatter(raw) + `# ${title}\n\n${parsed.content.replace(/^\s+/, "")}`, "utf8");
  }

  const reloaded = await loadProject(projectId);
  const renamed = reloaded.book.sections.find((item) =>
    item.sourcePath === source.path && item.sourceOrdinal === source.ordinal,
  );
  if (!renamed) throw new Error("Chapter was renamed but could not be reloaded.");
  return readSectionDocument(projectId, renamed.id);
}

/**
 * Remove a chapter from the manuscript without destroying it irreversibly.
 * Standalone chapter files are moved to .folio-trash; a chapter living inside
 * a combined Markdown manuscript is extracted there before the source is
 * rewritten without that H1 section.
 */
export async function deleteSectionDocument(projectId: string, sectionId: string): Promise<void> {
  await writableBookDir(projectId);
  const { book } = await loadProject(projectId);
  const section = book.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error("Section not found.");
  if (section.kind !== "chapter" || section.generated) throw new Error("Only manuscript chapters can be deleted here.");

  const source = await resolveSource(projectId, sectionId);
  if (!source) throw new Error("Could not locate the source Markdown file for this chapter.");
  const info = projectInfo(projectId);
  if (!info.folder) throw new Error("This chapter has no writable book folder.");

  const trash = path.join(info.folder, ".folio-trash");
  await fs.mkdir(trash, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (source.ordinal === undefined) {
    const destination = path.join(trash, `${stamp}-${path.basename(source.path)}`);
    await fs.rename(source.path, destination);
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
