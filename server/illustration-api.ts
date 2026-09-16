import type { Express, Request, Response } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writableBookDir } from "./projects.ts";
import { resolveIllustrationAsset, storeIllustration } from "./illustrations.ts";

const illustrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
});

export function registerIllustrationApi(app: Express): void {
  app.post("/api/projects/:id/illustration", illustrationUpload.single("image"), async (req: Request, res: Response) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) throw new Error("No illustration uploaded.");
      if (!/^image\/(?:png|jpeg)$/i.test(file.mimetype)) throw new Error("Illustrations must be PNG or JPEG.");
      const dir = await writableBookDir(req.params.id);
      const stored = await storeIllustration(dir, file.originalname, file.buffer);
      res.json({ ok: true, asset: stored.asset, url: `/api/projects/${encodeURIComponent(req.params.id)}/asset?path=${encodeURIComponent(stored.asset)}` });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/projects/:id/asset", async (req: Request, res: Response) => {
    try {
      const asset = typeof req.query.path === "string" ? req.query.path : "";
      const dir = await writableBookDir(req.params.id);
      const file = resolveIllustrationAsset(dir, asset);
      const ext = path.extname(file).toLowerCase();
      res.setHeader("Content-Type", ext === ".png" ? "image/png" : "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(await fs.readFile(file));
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
