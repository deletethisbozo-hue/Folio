import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { loadProject, projectInfo, writableBookDir } from "./projects.ts";
import { extractSubtitle, extractTitle } from "./pipeline/util.ts";

export interface SectionDocument {
  id: string;
  title: string;
  subtitle?: string;
  kind: string;
  markdown: string;
  editable: boolean;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "output") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(md|markdown)$/i.test(entry.name)) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function findSourceFile(projectId: string, sectionId: string): Promise<string | null> {
  const { book } = await loadProject(projectId);
  const section = book.sections.find((s) => s.id === sectionId);
  if (!section || section.generated) return null;

  const info = projectInfo(projectId);
  if (!info.folder) return null;

  let titleFallback: string | null = null;
  for (const file of await markdownFiles(info.folder)) {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const parsed = matter(raw);
    const fromTitle = extractTitle(parsed.content);
    const title =
      (typeof parsed.data.title === "string" && parsed.data.title.trim()) ||
      fromTitle.title ||
      path.basename(file, path.extname(file));
    if (title !== section.title) continue;

    const fromSubtitle = extractSubtitle(fromTitle.title ? fromTitle.body : parsed.content);
    if (normalize(fromSubtitle.body) === normalize(section.markdown)) return file;
    titleFallback ??= file;
  }
  return titleFallback;
}

export async function readSectionDocument(projectId: string, sectionId: string): Promise<SectionDocument> {
  const { book } = await loadProject(projectId);
  const section = book.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error("Section not found.");
  const source = await findSourceFile(projectId, sectionId);
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
  await writableBookDir(projectId);
  const { book } = await loadProject(projectId);
  const section = book.sections.find((s) => s.id === sectionId);
  if (!section || section.generated) throw new Error("This section is generated and cannot be edited directly.");

  const source = await findSourceFile(projectId, sectionId);
  if (!source) throw new Error("Could not locate the source Markdown file for this section.");

  const raw = await fs.readFile(source, "utf8");
  const parsed = matter(raw);
  const titleInfo = extractTitle(parsed.content);
  const subtitleInfo = extractSubtitle(titleInfo.title ? titleInfo.body : parsed.content);
  const prefix = preservedFrontMatter(raw);

  const header: string[] = [];
  if (titleInfo.title) header.push(`# ${titleInfo.title}`);
  if (subtitleInfo.subtitle && typeof parsed.data.subtitle !== "string") header.push(`## ${subtitleInfo.subtitle}`);
  const nextBody = [...header, markdown.trim()].filter(Boolean).join("\n\n") + "\n";
  await fs.writeFile(source, prefix + nextBody, "utf8");
}
