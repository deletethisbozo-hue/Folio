import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = path.join(root, "themes", "fonts");
const licenseDir = path.join(fontDir, "licenses");
const GOOGLE_FONTS_COMMIT = "809e4d8b8d7e9364a914909bb777679606c178b8";
const RAW = `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}`;

const assets = [
  ["eb-garamond.ttf", "ofl/ebgaramond/EBGaramond[wght].ttf"],
  ["eb-garamond-italic.ttf", "ofl/ebgaramond/EBGaramond-Italic[wght].ttf"],
  ["libre-caslon-text.ttf", "ofl/librecaslontext/LibreCaslonText[wght].ttf"],
  ["libre-caslon-text-italic.ttf", "ofl/librecaslontext/LibreCaslonText-Italic[wght].ttf"],
  ["libre-baskerville.ttf", "ofl/librebaskerville/LibreBaskerville[wght].ttf"],
  ["libre-baskerville-italic.ttf", "ofl/librebaskerville/LibreBaskerville-Italic[wght].ttf"],
  ["source-serif-4.ttf", "ofl/sourceserif4/SourceSerif4[opsz,wght].ttf"],
  ["source-serif-4-italic.ttf", "ofl/sourceserif4/SourceSerif4-Italic[opsz,wght].ttf"],
  ["newsreader.ttf", "ofl/newsreader/Newsreader[opsz,wght].ttf"],
  ["newsreader-italic.ttf", "ofl/newsreader/Newsreader-Italic[opsz,wght].ttf"],
  ["vollkorn.ttf", "ofl/vollkorn/Vollkorn[wght].ttf"],
  ["vollkorn-italic.ttf", "ofl/vollkorn/Vollkorn-Italic[wght].ttf"],
  ["source-sans-3.ttf", "ofl/sourcesans3/SourceSans3[wght].ttf"],
  ["source-sans-3-italic.ttf", "ofl/sourcesans3/SourceSans3-Italic[wght].ttf"],
  ["barlow-condensed-regular.ttf", "ofl/barlowcondensed/BarlowCondensed-Regular.ttf"],
  ["barlow-condensed-bold.ttf", "ofl/barlowcondensed/BarlowCondensed-Bold.ttf"],
  ["barlow-condensed-black.ttf", "ofl/barlowcondensed/BarlowCondensed-Black.ttf"],
  ["bodoni-moda.ttf", "ofl/bodonimoda/BodoniModa[opsz,wght].ttf"],
  ["bodoni-moda-italic.ttf", "ofl/bodonimoda/BodoniModa-Italic[opsz,wght].ttf"],
  ["cinzel.ttf", "ofl/cinzel/Cinzel[wght].ttf"],
  ["grenze-gotisch.ttf", "ofl/grenzegotisch/GrenzeGotisch[wght].ttf"],
  ["roboto-slab.ttf", "apache/robotoslab/RobotoSlab[wght].ttf"],
];

const licenses = [
  ["EB-Garamond-OFL.txt", "ofl/ebgaramond/OFL.txt"],
  ["Libre-Caslon-Text-OFL.txt", "ofl/librecaslontext/OFL.txt"],
  ["Libre-Baskerville-OFL.txt", "ofl/librebaskerville/OFL.txt"],
  ["Source-Serif-4-OFL.txt", "ofl/sourceserif4/OFL.txt"],
  ["Newsreader-OFL.txt", "ofl/newsreader/OFL.txt"],
  ["Vollkorn-OFL.txt", "ofl/vollkorn/OFL.txt"],
  ["Source-Sans-3-OFL.txt", "ofl/sourcesans3/OFL.txt"],
  ["Barlow-Condensed-OFL.txt", "ofl/barlowcondensed/OFL.txt"],
  ["Bodoni-Moda-OFL.txt", "ofl/bodonimoda/OFL.txt"],
  ["Cinzel-OFL.txt", "ofl/cinzel/OFL.txt"],
  ["Grenze-Gotisch-OFL.txt", "ofl/grenzegotisch/OFL.txt"],
  ["Roboto-Slab-LICENSE.txt", "apache/robotoslab/LICENSE.txt"],
];

function encodeRepoPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function fetchWithRetry(relativePath, attempts = 4) {
  const url = `${RAW}/${encodeRepoPath(relativePath)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(`Unable to fetch ${relativePath}: HTTP ${response.status}`);
      if (!retryable) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError ?? new Error(`Unable to fetch ${relativePath}`);
}

async function download(relativePath, destination, font = false) {
  try {
    const existing = await fs.readFile(destination);
    if (!font || existing.length > 30_000) return false;
  } catch {
    // Missing file: fetch it below.
  }

  const response = await fetchWithRetry(relativePath);
  const data = Buffer.from(await response.arrayBuffer());
  if (font) {
    if (data.length < 30_000) throw new Error(`Downloaded font is unexpectedly small: ${relativePath}`);
    const signature = data.subarray(0, 4).toString("hex");
    if (signature !== "00010000" && data.subarray(0, 4).toString("ascii") !== "OTTO") {
      throw new Error(`Downloaded file is not a TrueType/OpenType font: ${relativePath}`);
    }
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
  return true;
}

await fs.mkdir(fontDir, { recursive: true });
await fs.mkdir(licenseDir, { recursive: true });
let fetched = 0;
for (const [name, remotePath] of assets) {
  if (await download(remotePath, path.join(fontDir, name), true)) fetched++;
}
for (const [name, remotePath] of licenses) {
  if (await download(remotePath, path.join(licenseDir, name), false)) fetched++;
}

await fs.writeFile(
  path.join(fontDir, "SOURCE.txt"),
  [
    "Folio built-in typography fonts",
    `Source: google/fonts commit ${GOOGLE_FONTS_COMMIT}`,
    "Files are fetched at build time and shipped with Folio so preview, PDF and EPUB use deterministic metrics.",
    "See licenses/ for the original font licenses.",
    "",
  ].join("\n"),
  "utf8",
);
console.log(fetched ? `Fetched ${fetched} Folio theme-font assets.` : "Folio theme fonts already present.");
