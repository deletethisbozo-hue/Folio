/** Build-time only: checksum-pinned, offline-capable EPUB publishing runtime. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import yauzl from "yauzl";

const root = path.resolve("build/publishing-tools");
const distributions = [
  {
    name: "epubcheck", folder: "epubcheck-5.4.0", executable: "epubcheck.jar",
    url: "https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip",
    sha256: "33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c",
  },
  ...(process.platform === "win32" ? [{
    name: "java", folder: "jdk-21.0.12.1+1-jre", executable: "bin/java.exe",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip",
    sha256: "d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636",
  }] : []),
];

async function unpack(archive, destination) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(archive, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  await new Promise((resolve, reject) => {
    const fail = (error) => { zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      (async () => {
        const target = path.resolve(destination, entry.fileName);
        if (!target.startsWith(destination + path.sep) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("Unsafe archive entry");
        if (entry.fileName.endsWith("/")) { await fs.mkdir(target, { recursive: true }); return; }
        await fs.mkdir(path.dirname(target), { recursive: true });
        const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (error, value) => error ? rejectStream(error) : resolveStream(value)));
        await pipeline(stream, createWriteStream(target));
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
}

await fs.mkdir(root, { recursive: true });
for (const distribution of distributions) {
  const response = await fetch(distribution.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed: ${distribution.name} HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(archive).digest("hex") !== distribution.sha256) throw new Error(`Checksum mismatch: ${distribution.name}`);
  const stage = await fs.mkdtemp(path.join(root, ".unpack-"));
  try {
    await unpack(archive, stage);
    await fs.access(path.join(stage, distribution.folder, distribution.executable));
    const target = path.join(root, distribution.name);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(path.join(stage, distribution.folder), target);
    const executable = path.join(target, distribution.executable);
    const variable = distribution.name === "java" ? "FOLIO_JAVA_BIN" : "FOLIO_EPUBCHECK_JAR";
    if (process.env.GITHUB_ENV) await fs.appendFile(process.env.GITHUB_ENV, `${variable}=${executable}\n`);
    console.log(`${distribution.name}: verified ${distribution.sha256}`);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
