import yauzl from "yauzl";

export type EpubSizeCategory = "fonts" | "images" | "content" | "other";
export interface EpubAssetSize {
  name: string;
  bytes: number; // Actual compressed bytes stored in the EPUB ZIP
  category: EpubSizeCategory;
}
export interface EpubSizeReport {
  totalBytes: number;
  fontsBytes: number;
  imagesBytes: number;
  contentBytes: number;
  otherBytes: number;
  overheadBytes: number;
  largestAssets: EpubAssetSize[];
}

function category(name: string): EpubSizeCategory {
  if (/\.(?:ttf|otf|woff2?)$/i.test(name)) return "fonts";
  if (/\.(?:png|jpe?g|webp|gif|svg|avif)$/i.test(name)) return "images";
  if (/\.(?:xhtml|html|css|opf|xml|ncx)$/i.test(name)) return "content";
  return "other";
}

/** Inspect archive metadata without unpacking any image or font payload. */
export function inspectEpubSize(buffer: Buffer): Promise<EpubSizeReport> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("EPUB ZIP is unreadable."));
      const totals = { fonts: 0, images: 0, content: 0, other: 0 };
      const assets: EpubAssetSize[] = [];
      let compressedBytes = 0;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith("/")) {
          const bytes = entry.compressedSize;
          const kind = category(entry.fileName);
          totals[kind] += bytes;
          compressedBytes += bytes;
          assets.push({ name: entry.fileName, bytes, category: kind });
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve({
        totalBytes: buffer.length,
        fontsBytes: totals.fonts,
        imagesBytes: totals.images,
        contentBytes: totals.content,
        otherBytes: totals.other,
        overheadBytes: Math.max(0, buffer.length - compressedBytes),
        largestAssets: assets.sort((a, b) => b.bytes - a.bytes).slice(0, 6),
      }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
