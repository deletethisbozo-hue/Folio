import type { Express, Request, Response } from "express";
import multer from "multer";
import { addFullPageImage } from "./image-pages.ts";
import { loadProject, writableBookDir } from "./projects.ts";

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
});

/** Register the Folio full-page artwork endpoint. Fixed artwork is always
 * contain-fit: maps, family trees and other page art may letterbox but are never
 * cropped by the application. */
export function registerImagePageApi(app: Express): void {
  app.post("/api/projects/:id/image-page", imageUpload.single("image"), async (req: Request, res: Response) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) throw new Error("No image uploaded.");
      if (!/^image\/(?:png|jpeg)$/i.test(file.mimetype)) throw new Error("Full-page images must be PNG or JPEG.");

      const { book } = await loadProject(req.params.id);
      const dir = await writableBookDir(req.params.id);
      const result = await addFullPageImage(dir, book.meta, {
        filename: file.originalname,
        buffer: file.buffer,
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        alt: typeof req.body?.alt === "string" ? req.body.alt : undefined,
        fit: "contain",
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
