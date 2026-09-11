import type { Express, Request, Response } from "express";
import { deleteSectionDocument, readSectionDocument, updateSectionHeadingDocument, writeSectionDocument } from "./section-editor.ts";
import { hasProject } from "./projects.ts";

const sectionMutationTails = new Map<string, Promise<void>>();

async function runSectionMutation<T>(projectId: string, sectionId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${projectId}::${sectionId}`;
  const previous = sectionMutationTails.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  sectionMutationTails.set(key, tail);
  try {
    return await current;
  } finally {
    if (sectionMutationTails.get(key) === tail) sectionMutationTails.delete(key);
  }
}

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
      const saved = await runSectionMutation(req.params.id, req.params.sectionId, async () => {
        await writeSectionDocument(req.params.id, req.params.sectionId, markdown);
        return readSectionDocument(req.params.id, req.params.sectionId);
      });
      res.json(saved);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/projects/:id/sections/:sectionId", async (req: Request, res: Response) => {
    try {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      const title = typeof req.body?.title === "string" ? req.body.title : undefined;
      const subtitle = typeof req.body?.subtitle === "string" ? req.body.subtitle : undefined;
      if (title === undefined && subtitle === undefined) throw new Error("No chapter heading change provided.");
      res.json(await runSectionMutation(req.params.id, req.params.sectionId, () =>
        updateSectionHeadingDocument(req.params.id, req.params.sectionId, { title, subtitle }),
      ));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/projects/:id/sections/:sectionId", async (req: Request, res: Response) => {
    try {
      if (!hasProject(req.params.id)) throw new Error("Project not found.");
      await runSectionMutation(req.params.id, req.params.sectionId, () =>
        deleteSectionDocument(req.params.id, req.params.sectionId),
      );
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });
}
