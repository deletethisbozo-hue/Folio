import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import open from "open";
import { registerApi } from "./api.ts";
import { registerEditorApi } from "./editor-api.ts";
import { checkPandoc, pandocBanner } from "./preflight.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.FOLIO_ROOT ? path.resolve(process.env.FOLIO_ROOT) : path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 4242);
const HOST = process.env.HOST ?? "127.0.0.1";
const isDev = process.env.BOOK_FORMATTER_DEV === "1";

const app = express();
// A complete Writer/Word manuscript can legitimately be several megabytes even
// after it has been reduced to semantic Markdown. Keep a bounded but book-sized
// limit instead of Express's API-sized default.
app.use(express.json({ limit: "64mb" }));

registerApi(app);
registerEditorApi(app);

// In production we serve the built frontend. In dev, Vite serves it on 5173.
if (!isDev) {
  const dist = path.join(ROOT, "web", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, HOST, () => {
  const url = isDev ? "http://localhost:5173" : `http://${HOST}:${PORT}`;
  console.log(`\n  Folio running at ${url}\n`);
  checkPandoc()
    .then((s) => {
      const banner = pandocBanner(s);
      if (banner) console.warn(`${banner}\n`);
    })
    .catch(() => {});
  if (!isDev && process.env.BOOK_FORMATTER_NO_OPEN !== "1") {
    open(url).catch(() => {});
  }
});
