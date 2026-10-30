import { convertPdfX3, defaultPdfXProfile, validateCmykProfile } from "./pipeline/pdfx.ts";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BookMeta, PresetName } from "./pipeline/types.ts";
import {
  createProjectFromFiles,
  createProjectFromFolderPath,
  createProjectFromFolioFile,
  createProjectAtFolioPath,
  importFolderAsFolioProject,
  createSampleProject,
  closeProject,
  flushProjectContainer,
  hasProject,
  loadProject,
  projectInfo,
  setProjectCover,
  writableBookDir,
} from "./projects.ts";
import { themeList } from "./pipeline/themes.ts";
import { PRESETS } from "./presets.ts";
import { renderHtml } from "./pipeline/render-html.ts";
import { renderEpub } from "./pipeline/render-epub.ts";
import { inspectEpubSize } from "./pipeline/epub-size.ts";
import { renderDocx } from "./pipeline/render-docx.ts";
import { renderMarkdown } from "./pipeline/render-markdown.ts";
import { renderPdf } from "./pipeline/render-pdf.ts";
import { publishPreflight } from "./validate/preflight.ts";
import { validateEpub } from "./validate/epubcheck.ts";
import { slugify } from "./pipeline/util.ts";
import { pickFolder, pickFolioProjectFile } from "./pick-folder.ts";
import { renderPrintPdf, renderPrintPreviewHtml } from "./pipeline/render-print.ts";
import { TRIMS, LAYOUTS, DEFAULT_PRINT, type PrintOptions } from "./print.ts";
import {
  MATTER_TYPES,
  addChapter,
  addMatter,
  readConfig,
  removeMatter,
  reorderMatter,
  saveExportSettings,
  saveMeta,
  saveTypography,
  scaffold,
  type Placement,
} from "./matter.ts";
import { reorderChapterDocuments } from "./section-editor.ts";
import { isAppError } from "./errors.ts";
import { checkPandoc } from "./preflight.ts";
import { APP_NAME, APP_VERSION } from "./version.ts";
import { renderBlues } from "./pipeline/render-blues.ts";
import { currentRound, ensureRoundStarted, finishExport, prepareExport } from "./exporter.ts";
import { roundWarning } from "./versioning.ts";
import type { ArtifactType } from "./destinations.ts";
import { THEME_FONTS_DIR } from "./pipeline/paths.ts";
import { normalizeThemeFontStack } from "./pipeline/theme-fonts.ts";
import { registerIllustrationApi } from "./illustration-api.ts";
import { forgetRecentProject, readRecentProjects, rememberRecentProject } from "./recent-projects.ts";
import { customFontById, customFontPath, installCustomFont, readCustomFonts, readThemeLibrary, writeThemeLibrary } from "./global-library.ts";
import { builtinThemeFontFamilies } from "./pipeline/theme-fonts.ts";
import { runThemeTypographyQa } from "./pipeline/theme-qa.ts";
import { validateThemeConfig } from "../shared/theme-validation.ts";
import { readExportProgress, updateExportProgress } from "./export-progress.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 800 },
});

/** Build the full project summary the UI works from (loads fresh from disk). */
async function buildSummary(projectId: string, overrides?: Partial<BookMeta>) {
  const { book, warnings } = await loadProject(projectId, overrides);
  const info = projectInfo(projectId);
  let config: { frontmatter: string[]; backmatter: string[]; chapters: string | null } | null = null;
  let bluesOutput: string | null = null;
  if (info.folder) {
    const cfg = await readConfig(info.folder);
    if (cfg) {
      config = {
        frontmatter: cfg.frontmatter ?? [],
        backmatter: cfg.backmatter ?? [],
        chapters: (cfg.chapters as string) ?? null,
      };
      bluesOutput = typeof cfg.blues_output === "string" && cfg.blues_output.trim() ? cfg.blues_output : null;
    }
  }
  const bodyChars = book.sections
    .filter((s) => s.kind === "chapter" || s.kind === "backmatter")
    .reduce((n, s) => n + s.markdown.length, 0);
  return {
    projectId,
    meta: book.meta,
    sections: book.sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind, toc: s.toc })),
    warnings: warnings.map((w) => w.message),
    hasCover: Boolean(book.coverPath),
    bodyChars,
    fontFamilies: book.fonts.map((f) => f.family),
    typography: book.typography ?? {},
    source: info.source,
    folder: info.folder,
    projectFile: info.projectFile,
    editable: info.editable,
    config,
    bluesOutput,
  };
}

async function wrap(res: Response, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (isAppError(e)) {
      console.error(`[${e.code}] ${e.userMessage}${e.detail ? `\n${e.detail}` : ""}`);
      res.status(e.status).json({ error: e.userMessage, code: e.code, detail: e.detail });
      return;
    }
    console.error(e);
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

function bodyMeta(req: Request): Partial<BookMeta> {
  const overrides = (req.body?.meta ?? {}) as Partial<BookMeta>;
  if (req.body?.theme) overrides.theme = req.body.theme;
  return overrides;
}

/**
 * The editor sends the COMPLETE current typography override state.
 *
 * Missing keys therefore mean "use the theme default", not "keep whatever was
 * previously saved in book.yaml". Merging here made every Theme default control
 * sticky: JSON omits undefined keys, so an old body/heading/drop-cap override
 * was resurrected from disk during the very next preview render.
 */
function applyTypography(book: { typography: any }, req: Request): void {
  const ty = req.body?.typography;
  if (!ty || typeof ty !== "object" || Array.isArray(ty)) return;
  const normalized = { ...ty };
  if (normalized.dropcapSize === "medium" || normalized.dropcapSize === "xlarge") normalized.dropcapSize = "large";
  else if (normalized.dropcapSize !== undefined && normalized.dropcapSize !== "small" && normalized.dropcapSize !== "large") {
    delete normalized.dropcapSize;
  }
  book.typography = {
    ...normalized,
    ...(normalized.chapterTitle && typeof normalized.chapterTitle === "object" && !Array.isArray(normalized.chapterTitle)
      ? { chapterTitle: { ...normalized.chapterTitle } }
      : {}),
  };
}

/** Apply the editor's unsaved text without touching disk or the autosave path. */
function applyPreviewDraft(book: { sections: Array<{ id: string; markdown: string; kind?: string; chapterNumber?: number }> }, req: Request): string | null {
  const sectionId = typeof req.body?.previewSectionId === "string" ? req.body.previewSectionId : null;
  if (!sectionId) return null;
  const section = book.sections.find((item) => item.id === sectionId);
  if (section?.kind === "chapter") {
    section.chapterNumber = book.sections.filter((item) => item.kind === "chapter").findIndex((item) => item.id === sectionId) + 1;
  }
  if (section && typeof req.body?.draft === "string") section.markdown = req.body.draft;
  return section ? sectionId : null;
}

export function registerApi(app: Express): void {
  // Only the newest Print Preview request for a project should occupy Chromium.
  // A browser fetch abort by itself does not cancel server-side pagination.
  const printPreviewControllers = new Map<string, AbortController>();
  registerIllustrationApi(app);
  app.get("/theme-fonts/:file", (req, res) =>
    wrap(res, async () => {
      const name = String(req.params.file ?? "");
      if (!/^[a-z0-9][a-z0-9.-]*\.(?:ttf|otf)$/i.test(name)) {
        res.status(404).end();
        return;
      }
      const file = path.join(THEME_FONTS_DIR, name);
      res.setHeader("Content-Type", name.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(await fs.readFile(file));
    }),
  );
  app.get("/api/library/themes", (_req, res) =>
    wrap(res, async () => { res.json(await readThemeLibrary()); }),
  );
  app.put("/api/library/themes", (req: Request, res: Response) =>
    wrap(res, async () => {
      const entries = req.body?.themes ?? req.body;
      if (Array.isArray(entries)) {
        const knownThemes = themeList().map((theme) => theme.name);
        const customFonts = await readCustomFonts();
        const installedFonts = [...builtinThemeFontFamilies(), ...customFonts.map((font) => font.family)];
        for (const entry of entries) {
          const issues = validateThemeConfig(entry?.config, {
            baseTheme: entry?.baseTheme,
            knownBaseThemes: knownThemes,
            installedFonts,
          }).filter((issue) => issue.severity === "error");
          if (issues.length) throw new Error(`Theme "${String(entry?.label ?? "Untitled")}" is invalid: ${issues.map((issue) => issue.message).join(" ")}`);
        }
      }
      res.json(await writeThemeLibrary(entries));
    }),
  );
  app.get("/api/library/fonts", (_req, res) =>
    wrap(res, async () => { res.json(await readCustomFonts()); }),
  );
  app.post("/api/library/fonts", upload.single("font"), (req: Request, res: Response) =>
    wrap(res, async () => {
      const file = req.file;
      if (!file) throw new Error("Choose a TTF or OTF font file.");
      res.json(await installCustomFont(file.originalname, file.buffer));
    }),
  );
  app.get("/api/library/fonts/:id/file", (req: Request, res: Response) =>
    wrap(res, async () => {
      const font = await customFontById(String(req.params.id ?? ""));
      if (!font) {
        res.status(404).end();
        return;
      }
      res.setHeader("Content-Type", font.format === "opentype" ? "font/otf" : "font/ttf");
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.send(await fs.readFile(customFontPath(font)));
    }),
  );

  app.get("/api/health", (_req, res) =>
    wrap(res, async () => {
      res.json({ ok: true, name: APP_NAME, version: APP_VERSION, pandoc: await checkPandoc() });
    }),
  );
  app.get("/api/themes", (_req, res) => res.json(themeList().map((theme) => ({
    ...theme,
    previewFont: normalizeThemeFontStack(theme.previewFont),
    previewHeadingFont: normalizeThemeFontStack(theme.previewHeadingFont),
  }))));
  app.get("/api/presets", (_req, res) => res.json(Object.values(PRESETS)));
  app.get("/api/matter-types", (_req, res) => res.json(MATTER_TYPES));
  app.get("/api/trims", (_req, res) => res.json(TRIMS));
  app.get("/api/print-layouts", (_req, res) => res.json(LAYOUTS));
  app.get("/api/recent-projects", (_req, res) =>
    wrap(res, async () => { res.json(await readRecentProjects()); }),
  );
  app.delete("/api/recent-projects", (req: Request, res: Response) =>
    wrap(res, async () => {
      const projectPath = String(req.body?.path ?? req.body?.folder ?? "").trim();
      if (!projectPath) throw new Error("No recent-project path provided.");
      res.json(await forgetRecentProject(projectPath));
    }),
  );

  app.post("/api/sample", (_req, res) =>
    wrap(res, async () => {
      res.json(await buildSummary(createSampleProject()));
    }),
  );

  app.post("/api/projects", upload.array("files"), (req: Request, res: Response) =>
    wrap(res, async () => {
      const files = (req.files as Express.Multer.File[]) ?? [];
      let relPaths: string[] = [];
      try {
        relPaths = JSON.parse(req.body?.relPaths ?? "[]");
      } catch {
        /* fall back to basenames */
      }
      const id = await createProjectFromFiles(
        files.map((f, i) => ({ relPath: relPaths[i] || f.originalname, buffer: f.buffer })),
      );
      res.json(await buildSummary(id));
    }),
  );

  // Pop a native folder picker on the user's machine; returns the chosen path.
  app.post("/api/pick-folder", (req: Request, res: Response) =>
    wrap(res, async () => {
      const initial = typeof req.body?.initial === "string" ? req.body.initial : undefined;
      res.json({ path: await pickFolder(initial) });
    }),
  );

  app.post("/api/pick-project-file", (req: Request, res: Response) =>
    wrap(res, async () => {
      const mode = req.body?.mode === "save" ? "save" : "open";
      const initial = typeof req.body?.initial === "string" ? req.body.initial : undefined;
      const suggestedName = typeof req.body?.suggestedName === "string" ? req.body.suggestedName : undefined;
      res.json({ path: await pickFolioProjectFile(mode, initial, suggestedName) });
    }),
  );

  app.post("/api/projects/open-file", (req: Request, res: Response) =>
    wrap(res, async () => {
      const projectPath = String(req.body?.path ?? "").trim();
      if (!projectPath) throw new Error("No .folio project path provided.");
      const id = await createProjectFromFolioFile(projectPath);
      const summary = await buildSummary(id);
      if (summary.projectFile) await rememberRecentProject(summary.projectFile, summary.meta.title, summary.meta.author);
      res.json(summary);
    }),
  );

  app.post("/api/projects/import-folder", (req: Request, res: Response) =>
    wrap(res, async () => {
      const folder = String(req.body?.folder ?? "").trim();
      const projectPath = String(req.body?.path ?? "").trim();
      if (!folder) throw new Error("No source folder provided.");
      if (!projectPath) throw new Error("No destination .folio path provided.");
      const id = await importFolderAsFolioProject(folder, projectPath);
      const summary = await buildSummary(id);
      if (summary.projectFile) await rememberRecentProject(summary.projectFile, summary.meta.title, summary.meta.author);
      res.json(summary);
    }),
  );

  // Legacy direct-folder opening remains available for compatibility and migration tests.
  app.post("/api/projects/open-folder", (req: Request, res: Response) =>
    wrap(res, async () => {
      const folder = String(req.body?.path ?? "").trim();
      if (!folder) throw new Error("No folder path provided.");
      const id = await createProjectFromFolderPath(folder);
      const summary = await buildSummary(id);
      if (summary.folder) await rememberRecentProject(summary.folder, summary.meta.title, summary.meta.author);
      res.json(summary);
    }),
  );

  // Create a complete starter book inside a standalone .folio project file.
  app.post("/api/projects/new", (req: Request, res: Response) =>
    wrap(res, async () => {
      const projectPath = String(req.body?.path ?? "").trim();
      if (!projectPath) throw new Error("No .folio project path provided.");
      const id = await createProjectAtFolioPath(projectPath);
      const dir = await writableBookDir(id);
      const meta: BookMeta = {
        title: String(req.body?.title ?? path.basename(projectPath, path.extname(projectPath))).trim() || "Untitled",
        author: String(req.body?.author ?? "").trim() || "Unknown Author",
        language: String(req.body?.language ?? "en").trim() || "en",
        theme: "literary",
      };
      await saveMeta(dir, meta);
      await addChapter(dir, meta, String(req.body?.chapterTitle ?? "Chapter One"));
      await flushProjectContainer(id);
      const summary = await buildSummary(id);
      if (summary.projectFile) await rememberRecentProject(summary.projectFile, summary.meta.title, summary.meta.author);
      res.json(summary);
    }),
  );

  app.post("/api/projects/:id/flush", (req: Request, res: Response) =>
    wrap(res, async () => {
      await flushProjectContainer(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.post("/api/projects/:id/close", (req: Request, res: Response) =>
    wrap(res, async () => {
      await closeProject(req.params.id);
      res.json({ ok: true });
    }),
  );

  // Re-read the active project working copy.
  app.post("/api/projects/:id/reload", (req: Request, res: Response) =>
    wrap(res, async () => {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Create a starter book.yaml in the project folder.
  app.post("/api/projects/:id/scaffold", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      const dir = await writableBookDir(req.params.id);
      await scaffold(dir, book.meta);
      res.json(await buildSummary(req.params.id));
    }),
  );

  app.post("/api/projects/:id/chapters", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      const dir = await writableBookDir(req.params.id);
      await addChapter(dir, book.meta, String(req.body?.title ?? "New Chapter"));
      res.json(await buildSummary(req.params.id));
    }),
  );

  app.post("/api/projects/:id/chapters/reorder", (req: Request, res: Response) =>
    wrap(res, async () => {
      await reorderChapterDocuments(req.params.id, Array.isArray(req.body?.order) ? req.body.order.map(String) : []);
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Persist the Book Details metadata into book.yaml.
  app.post("/api/projects/:id/meta", (req: Request, res: Response) =>
    wrap(res, async () => {
      const meta = req.body?.meta as BookMeta | undefined;
      if (!meta) throw new Error("No metadata provided.");
      const dir = await writableBookDir(req.params.id);
      await saveMeta(dir, meta);
      const summary = await buildSummary(req.params.id);
      if (summary.folder) await rememberRecentProject(summary.folder, summary.meta.title, summary.meta.author);
      res.json(summary);
    }),
  );

  // Persist where this book's exports go (the blues review folder).
  app.post("/api/projects/:id/export-settings", (req: Request, res: Response) =>
    wrap(res, async () => {
      const dir = await writableBookDir(req.params.id);
      await saveExportSettings(dir, {
        blues_output: typeof req.body?.blues_output === "string" ? req.body.blues_output.trim() : undefined,
      });
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Persist the typography block into book.yaml.
  app.post("/api/projects/:id/typography", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      const dir = await writableBookDir(req.params.id);
      await saveTypography(dir, book.meta, req.body?.typography ?? {});
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Add a front/back matter section from a template.
  app.post("/api/projects/:id/matter", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      const dir = await writableBookDir(req.params.id);
      await addMatter(dir, book.meta, {
        type: String(req.body?.type ?? ""),
        placement: req.body?.placement as Placement | undefined,
        title: req.body?.title,
      });
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Remove a matter entry (unlists it; file stays on disk).
  app.delete("/api/projects/:id/matter", (req: Request, res: Response) =>
    wrap(res, async () => {
      const dir = await writableBookDir(req.params.id);
      await removeMatter(dir, String(req.body?.entry ?? ""));
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Reorder a placement's entries.
  app.post("/api/projects/:id/matter/reorder", (req: Request, res: Response) =>
    wrap(res, async () => {
      const dir = await writableBookDir(req.params.id);
      await reorderMatter(dir, req.body?.placement as Placement, (req.body?.order ?? []) as string[]);
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Replace the cover image.
  app.post("/api/projects/:id/cover", upload.single("cover"), (req: Request, res: Response) =>
    wrap(res, async () => {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      const file = req.file as Express.Multer.File | undefined;
      if (!file) throw new Error("No cover uploaded.");
      await setProjectCover(req.params.id, file.originalname, file.buffer);
      res.json(await buildSummary(req.params.id));
    }),
  );

  // Serve the current cover image (for the UI thumbnail).
  app.get("/api/projects/:id/cover", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id);
      if (!book.coverPath) {
        res.status(404).end();
        return;
      }
      const ext = path.extname(book.coverPath).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.send(await fs.readFile(book.coverPath));
    }),
  );

  // Live preview HTML for the iframe (reflowable ebook).
  app.post("/api/projects/:id/preview", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      applyTypography(book, req);
      const sectionId = applyPreviewDraft(book, req);
      if (sectionId) book.sections = book.sections.filter((section) => section.id === sectionId);
      res.json({ html: await renderHtml(book, "html") });
    }),
  );

  app.post("/api/projects/:id/theme-qa", (req: Request, res: Response) =>
    wrap(res, async () => {
      const baseTheme = typeof req.body?.baseTheme === "string" ? req.body.baseTheme : "";
      const knownThemes = themeList().map((theme) => theme.name);
      const customFonts = await readCustomFonts();
      const validation = validateThemeConfig(req.body?.config, {
        baseTheme,
        knownBaseThemes: knownThemes,
        installedFonts: [...builtinThemeFontFamilies(), ...customFonts.map((font) => font.family)],
      });
      if (validation.some((issue) => issue.severity === "error")) {
        res.status(400).json({ error: "Fix theme validation errors before running typography QA.", validation });
        return;
      }
      const { book } = await loadProject(req.params.id, { theme: baseTheme as BookMeta["theme"] });
      applyTypography(book, req);
      res.json(await runThemeTypographyQa(book));
    }),
  );

  // Paginated print preview (same Paged.js layout as the print PDF).
  app.post("/api/projects/:id/preview-print", (req: Request, res: Response) =>
    wrap(res, async () => {
      const key = req.params.id;
      printPreviewControllers.get(key)?.abort();
      const controller = new AbortController();
      printPreviewControllers.set(key, controller);
      // Cancel promptly when switching themes, pages or away from Print mode.
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.once("close", onClose);
      try {
        const { book } = await loadProject(key, bodyMeta(req));
        if (controller.signal.aborted) return;
        applyTypography(book, req);
        const sectionId = applyPreviewDraft(book, req);
        // Keep the previous one-section behavior for older clients. The book
        // scope uses the same in-memory draft overlay but lets the compositor
        // see every section so page flow and the printed TOC are book-accurate.
        const previewScope = req.body?.previewScope === "book" ? "book" : "section";
        if (sectionId && previewScope === "section") {
          book.sections = book.sections.filter((section) => section.id === sectionId);
        }
        const print: PrintOptions = { ...DEFAULT_PRINT, ...(req.body?.print ?? {}) };
        const { html, meta } = await renderPrintPreviewHtml(book, print, controller.signal);
        if (!controller.signal.aborted && !res.destroyed) res.json({ html, pages: meta.pages, gutter: meta.gutter });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        res.off("close", onClose);
        // A caller need not abort its own HTTP request when superseded. Do not
        // leave the previous response waiting indefinitely for a dead render.
        if (controller.signal.aborted && !res.destroyed && !res.writableEnded) res.status(204).end();
        if (printPreviewControllers.get(key) === controller) printPreviewControllers.delete(key);
      }
    }),
  );

  app.post("/api/projects/:id/preflight", (req: Request, res: Response) =>
    wrap(res, async () => {
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      applyTypography(book, req);
      applyPreviewDraft(book, req);
      const format = String(req.body?.format ?? "epub");
      res.json(await publishPreflight(book, { format: format === "pdfx" ? "print" : format, preset: String(req.body?.preset ?? "universal"), print: ["print", "pdfx"].includes(format) ? { ...DEFAULT_PRINT, ...(req.body?.print ?? {}) } : undefined }));
    }),
  );

  /**
   * Export a format.
   *
   * When the project was opened from a real folder on disk, the SERVER writes
   * the file to its configured destination and returns the path — a browser
   * download cannot choose where it lands, so it would always go to Downloads,
   * and version.json would then record a path where nothing exists.
   *
   * Drag-and-dropped projects live in a temp folder with no permanent home, so
   * those still come back as base64 for the browser to download.
   */
  app.get("/api/projects/:id/export-progress/:progressId", (req: Request, res: Response) =>
    wrap(res, async () => {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      const progress = readExportProgress(req.params.id, req.params.progressId);
      if (!progress) {
        res.status(404).json({ error: "Export progress is no longer available." });
        return;
      }
      res.json(progress);
    }),
  );

  app.post("/api/projects/:id/export", (req: Request, res: Response) =>
    wrap(res, async () => {
      const format = String(req.body?.format ?? "");
      const progressId = typeof req.body?.progressId === "string" ? req.body.progressId : undefined;
      const reportProgress = (percent: number, stage: string) =>
        updateExportProgress(req.params.id, progressId, percent, stage);
      reportProgress(2, "Preparing export");
      const { book } = await loadProject(req.params.id, bodyMeta(req));
      applyTypography(book, req);
      reportProgress(8, "Checking the manuscript and export settings");
      if (["epub", "pdf", "print", "pdfx", "docx"].includes(format)) {
        const preflight = await publishPreflight(book, { format: format === "pdfx" ? "print" : format, preset: String(req.body?.preset ?? "universal"), print: ["print", "pdfx"].includes(format) ? { ...DEFAULT_PRINT, ...(req.body?.print ?? {}) } : undefined });
        if (!preflight.ready) throw new Error("Publish Preflight: " + preflight.issues.filter((issue) => issue.severity === "error").slice(0, 8).map((issue) => `${issue.text} ${issue.remedy}`).join("; "));
      }
      reportProgress(12, "Starting the renderer");
      const stem = slugify(book.meta.title) || "book";
      const info = projectInfo(req.params.id);
      const bookDir = info.onDisk ? info.folder : null;
      const requestedOutputDir = typeof req.body?.outputDir === "string" && req.body.outputDir.trim()
        ? req.body.outputDir.trim()
        : undefined;
      const defaultProjectOutputDir = info.projectFile
        ? path.join(path.dirname(info.projectFile), "Exports")
        : undefined;
      const exportOutputDir = requestedOutputDir ?? defaultProjectOutputDir;
      const projectSlug = info.projectFile
        ? path.basename(info.projectFile, path.extname(info.projectFile))
        : undefined;

      /** Write to the configured destination, or hand back bytes to download. */
      const deliver = async (type: ArtifactType, data: Buffer, mime: string, extra: Record<string, unknown> = {}, customFilename?: string) => {
        reportProgress(94, "Finishing and saving the export");
        if (!bookDir) {
          // A drag-and-dropped book has no folder in which Folio can save
          // exports. Give every downloadable artifact a distinct, recognizable
          // name so exporting a second EPUB/PDF cannot silently replace the
          // first file in the browser's Downloads folder.
          const filenameByType: Record<ArtifactType, string> = {
            blues: `${stem}_blues.pdf`,
            print: `${stem}_print.pdf`,
            pdfx: `${stem}_pdfx.pdf`,
            reading: `${stem}_reading.pdf`,
            "epub-kdp": `${stem}_kdp.epub`,
            "epub-universal": `${stem}.epub`,
            docx: `${stem}.docx`,
            md: `${stem}.md`,
          };
          res.json({
            filename: customFilename || filenameByType[type],
            mime,
            dataBase64: data.toString("base64"),
            bytes: data.length,
            written: false,
            ...extra,
          });
          reportProgress(100, "Export ready");
          return;
        }
        const prep = await prepareExport(book, bookDir, { exportsOut: exportOutputDir, slug: projectSlug });
        const result = await finishExport(prep, type, data, {
          force: Boolean(req.body?.force),
          note: typeof req.body?.note === "string" ? req.body.note : undefined,
          confirm: async () => false, // the UI asks, then retries with force
          customFilename,
        });
        if (!result.written) {
          res.json({ needsConfirm: true, message: result.conflictMessage, bytes: data.length, ...extra });
          reportProgress(100, "Waiting for overwrite confirmation");
          return;
        }
        res.json({
          written: true,
          filename: result.filename,
          path: result.path,
          version: result.version,
          archived: result.archived,
          overwrote: result.overwrote,
          bytes: data.length,
          mime,
          ...extra,
        });
        reportProgress(100, "Export ready");
      };

      // The blues needs its version and round BEFORE it renders — both are
      // printed on the cover — so it can't go through `deliver`.
      if (format === "blues") {
        if (!bookDir) {
          throw new Error(
            "A blues is written to your review folder, so it needs a book opened from a folder on disk — not a drag-and-dropped copy.",
          );
        }
        const prep = await prepareExport(book, bookDir, { newRound: Boolean(req.body?.newRound), slug: projectSlug });
        ensureRoundStarted(prep);
        const round = currentRound(prep);
        const warning = prep.round ? roundWarning(prep.round) : null;
        const pages = Number(req.body?.pages);
        const { buffer, meta } = await renderBlues(book, {
          version: prep.sync.version,
          date: prep.date,
          round: round.round,
          maxRounds: round.maxRounds,
          sourceLabel: info.projectFile ? path.basename(info.projectFile, path.extname(info.projectFile)) : path.basename(bookDir),
          maxPages: Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : undefined,
        });
        const result = await finishExport(prep, "blues", buffer, {
          force: Boolean(req.body?.force),
          note: typeof req.body?.note === "string" ? req.body.note : `round ${round.round}`,
          confirm: async () => false,
        });
        if (!result.written) {
          res.json({ needsConfirm: true, message: result.conflictMessage, bytes: buffer.length });
          return;
        }
        res.json({
          written: true,
          filename: result.filename,
          path: result.path,
          version: result.version,
          archived: result.archived,
          overwrote: result.overwrote,
          bytes: buffer.length,
          mime: "application/pdf",
          pages: meta.pages,
          totalPages: meta.totalPages,
          firstChapter: meta.firstChapter,
          lastChapter: meta.lastChapter,
          totalChapters: meta.totalChapters,
          round: round.round,
          maxRounds: round.maxRounds,
          roundWarning: warning,
        });
        return;
      }

      switch (format) {
        case "epub": {
          const preset = (req.body?.preset ?? "universal") as PresetName;
          reportProgress(20, "Building the EPUB and packaging selected fonts");
          const { buffer, optimization } = await renderEpub(book, preset);
          reportProgress(80, "Validating the EPUB");
          const [validation, sizeReport] = await Promise.all([validateEpub(buffer, { requireFullValidation: Boolean(process.env.FOLIO_RESOURCE_ROOT) }), inspectEpubSize(buffer)]);
          if (!validation.valid) throw new Error("EPUB validation failed: " + validation.messages.filter((message) => message.severity === "error").slice(0, 8).map((message) => message.text).join("; "));
          await deliver(preset === "kdp" ? "epub-kdp" : "epub-universal", buffer, "application/epub+zip", { validation, sizeReport, optimization });
          return;
        }
        case "docx": {
          const buffer = await renderDocx(book);
          await deliver(
            "docx",
            buffer,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
          return;
        }
        case "md": {
          const buffer = Buffer.from(renderMarkdown(book), "utf8");
          await deliver("md", buffer, "text/markdown");
          return;
        }
        case "pdf": {
          const buffer = await renderPdf(book, ({ completedParagraphs, totalParagraphs, fraction }) =>
            reportProgress(15 + 72 * fraction, `Composing reading PDF: ${completedParagraphs}/${totalParagraphs} paragraphs`));
          const customFilename = typeof req.body?.customFilename === "string" ? req.body.customFilename.trim() : undefined;
          await deliver("reading", buffer, "application/pdf", {}, customFilename);
          return;
        }
        case "print":
        case "pdfx": {
          const print: PrintOptions = { ...DEFAULT_PRINT, ...(req.body?.print ?? {}) };
          const profile = format === "pdfx" ? print.iccProfile ? Buffer.from(print.iccProfile.dataBase64, "base64") : await defaultPdfXProfile() : null;
          if (profile) validateCmykProfile(profile);
          const { buffer, meta } = await renderPrintPdf(book, print, ({ completedParagraphs, totalParagraphs, fraction }) =>
            reportProgress(15 + 66 * fraction, `Composing print PDF: ${completedParagraphs}/${totalParagraphs} paragraphs`));
          if (profile) {
            const converted = await convertPdfX3(buffer, { profile, name: print.iccProfile?.name ?? "Artifex CMYK SWOP", title: book.meta.title });
            await deliver("pdfx", converted.buffer, "application/pdf", { pages: meta.pages, gutter: meta.gutter, pdfxReport: converted.report });
          } else await deliver("print", buffer, "application/pdf", { pages: meta.pages, gutter: meta.gutter });
          return;
        }
        default:
          throw new Error(`Unknown format: ${format}`);
      }
    }),
  );
}
