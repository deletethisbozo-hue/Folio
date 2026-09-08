import type { Express, Request, Response } from "express";
import { readSectionDocument, writeSectionDocument } from "./section-editor.ts";
import { hasProject } from "./projects.ts";

function sendError(res: Response, error: unknown): void {
  console.error(error);
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

export function registerEditorApi(app: Express): void {
  app.get("/api/projects/:id/sections/:sectionId", async (req: Request, res: Response) => {
    try {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      res.json(await readSectionDocument(req.params.id, req.params.sectionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/projects/:id/sections/:sectionId", async (req: Request, res: Response) => {
    try {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";
      await writeSectionDocument(req.params.id, req.params.sectionId, markdown);
      res.json(await readSectionDocument(req.params.id, req.params.sectionId));
    } catch (error) {
      sendError(res, error);
    }
  });
}
