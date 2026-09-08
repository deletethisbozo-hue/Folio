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
