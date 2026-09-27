import multer from "multer";
import type { Express, Request, Response } from "express";
import { hasProject } from "./projects.ts";
import {
  addDailyProgress,
  addResearchImage,
  createBookSnapshot,
  createResearchNote,
  createSnapshot,
  createWritingComment,
  deleteResearchImage,
  deleteResearchNote,
  deleteWritingComment,
  readResearchImage,
  readRevisionMarkdown,
  readWritingWordCounts,
  readWriteStudio,
  restoreBookSnapshot,
  setWritingTargets,
  updateResearchNote,
  updateWritingComment,
} from "./write-studio.ts";

function sendError(res: Response, error: unknown): void {
  console.error(error);
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

function requireProject(id: string): void {
  if (!hasProject(id)) throw new Error("Project not found.");
}

const researchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 1 },
});

export function registerWriteStudioApi(app: Express): void {
  app.get("/api/projects/:id/write-studio", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await readWriteStudio(req.params.id));
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/projects/:id/write-studio/word-counts", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await readWritingWordCounts(req.params.id));
    } catch (error) { sendError(res, error); }
  });

  app.put("/api/projects/:id/write-studio/targets", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      const normalize = (value: unknown): number | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === "") return null;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error("Invalid writing target.");
        return Math.round(n);
      };
      const chapters = req.body?.chapters;
      const cleanChapters: Record<string, number> | undefined = chapters && typeof chapters === "object" && !Array.isArray(chapters)
        ? Object.fromEntries(Object.entries(chapters).map(([key, value]) => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error("Invalid chapter target.");
            return [key, Math.round(n)];
          }))
        : undefined;
      res.json(await setWritingTargets(req.params.id, {
        book: normalize(req.body?.book),
        daily: normalize(req.body?.daily),
        session: normalize(req.body?.session),
        chapters: cleanChapters,
      }));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/progress", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await addDailyProgress(req.params.id, String(req.body?.date ?? ""), Number(req.body?.delta ?? 0)));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/research", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await createResearchNote(req.params.id, String(req.body?.title ?? ""), String(req.body?.body ?? "")));
    } catch (error) { sendError(res, error); }
  });

  app.patch("/api/projects/:id/write-studio/research/:noteId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await updateResearchNote(req.params.id, req.params.noteId, {
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        body: typeof req.body?.body === "string" ? req.body.body : undefined,
        pinned: typeof req.body?.pinned === "boolean" ? req.body.pinned : undefined,
      }));
    } catch (error) { sendError(res, error); }
  });

  app.delete("/api/projects/:id/write-studio/research/:noteId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await deleteResearchNote(req.params.id, req.params.noteId));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/research-images", researchUpload.single("file"), async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      const file = req.file;
      if (!file) throw new Error("No image provided.");
      const mime = file.mimetype;
      if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") throw new Error("Use PNG, JPEG or WebP research images.");
      res.json(await addResearchImage(req.params.id, file.originalname, mime, file.buffer));
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/projects/:id/write-studio/research-images/:imageId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      const result = await readResearchImage(req.params.id, req.params.imageId);
      res.setHeader("Content-Type", result.image.mimeType);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.send(result.buffer);
    } catch (error) { sendError(res, error); }
  });

  app.delete("/api/projects/:id/write-studio/research-images/:imageId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await deleteResearchImage(req.params.id, req.params.imageId));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/comments", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await createWritingComment(
        req.params.id,
        String(req.body?.sectionId ?? ""),
        String(req.body?.quote ?? ""),
        String(req.body?.body ?? ""),
        typeof req.body?.prefix === "string" ? req.body.prefix : undefined,
        typeof req.body?.suffix === "string" ? req.body.suffix : undefined,
      ));
    } catch (error) { sendError(res, error); }
  });

  app.patch("/api/projects/:id/write-studio/comments/:commentId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await updateWritingComment(req.params.id, req.params.commentId, {
        body: typeof req.body?.body === "string" ? req.body.body : undefined,
        resolved: typeof req.body?.resolved === "boolean" ? req.body.resolved : undefined,
      }));
    } catch (error) { sendError(res, error); }
  });

  app.delete("/api/projects/:id/write-studio/comments/:commentId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await deleteWritingComment(req.params.id, req.params.commentId));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/snapshots", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      const sectionId = String(req.body?.sectionId ?? "");
      const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";
      if (!sectionId) throw new Error("No section selected.");
      res.json(await createSnapshot(req.params.id, sectionId, markdown, typeof req.body?.label === "string" ? req.body.label : undefined));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/snapshots/book", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await createBookSnapshot(req.params.id, typeof req.body?.label === "string" ? req.body.label : undefined));
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/projects/:id/write-studio/revisions/:revisionId/restore-book", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await restoreBookSnapshot(req.params.id, req.params.revisionId));
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/projects/:id/write-studio/revisions/:revisionId", async (req: Request, res: Response) => {
    try {
      requireProject(req.params.id);
      res.json(await readRevisionMarkdown(req.params.id, req.params.revisionId));
    } catch (error) { sendError(res, error); }
  });
}
