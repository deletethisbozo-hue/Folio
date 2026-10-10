import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = path.join(root, "themes", "fonts");
const licenseDir = path.join(fontDir, "licenses");
const GOOGLE_FONTS_COMMIT = "809e4d8b8d7e9364a914909bb777679606c178b8";
const RAW = `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}`;

const QUALIFIED_DISPLAY_SOURCES = [
  "medievalsharp", "pirataone", "almendra", "metamorphous", "eaglelake",
  "newrocker", "fondamento", "cormorantunicase", "berkshireswash", "texturina",
  "caudex", "sancreek", "novacut", "barlowcondensed", "bodonimoda", "cinzel",
  "grenzegotisch", "manufacturingconsent", "kings", "fruktur", "grenze",
  "jacquardabastarda9", "rakkas", "jainipurva", "jaini", "jimnightshade", "risque",
];


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
  ["gelasio.ttf", "ofl/gelasio/Gelasio[wght].ttf"],
  ["gelasio-italic.ttf", "ofl/gelasio/Gelasio-Italic[wght].ttf"],
  ["vollkorn.ttf", "ofl/vollkorn/Vollkorn[wght].ttf"],
  ["vollkorn-italic.ttf", "ofl/vollkorn/Vollkorn-Italic[wght].ttf"],
  ["source-sans-3.ttf", "ofl/sourcesans3/SourceSans3[wght].ttf"],
  ["source-sans-3-italic.ttf", "ofl/sourcesans3/SourceSans3-Italic[wght].ttf"],
  ["ibm-plex-sans.ttf", "ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf"],
  ["barlow-condensed-regular.ttf", "ofl/barlowcondensed/BarlowCondensed-Regular.ttf"],
  ["barlow-condensed-bold.ttf", "ofl/barlowcondensed/BarlowCondensed-Bold.ttf"],
  ["barlow-condensed-black.ttf", "ofl/barlowcondensed/BarlowCondensed-Black.ttf"],
  ["bodoni-moda.ttf", "ofl/bodonimoda/BodoniModa[opsz,wght].ttf"],
  ["bodoni-moda-italic.ttf", "ofl/bodonimoda/BodoniModa-Italic[opsz,wght].ttf"],
  ["cinzel.ttf", "ofl/cinzel/Cinzel[wght].ttf"],
  ["grenze-gotisch.ttf", "ofl/grenzegotisch/GrenzeGotisch[wght].ttf"],
  ["fruktur.ttf", "ofl/fruktur/Fruktur-Regular.ttf"],
  ["grenze.ttf", "ofl/grenze/Grenze[wght].ttf"],
  ["jacquarda-bastarda-9.ttf", "ofl/jacquardabastarda9/JacquardaBastarda9-Regular.ttf"],
  ["rakkas.ttf", "ofl/rakkas/Rakkas-Regular.ttf"],
  ["jaini-purva.ttf", "ofl/jainipurva/JainiPurva-Regular.ttf"],
  ["jaini.ttf", "ofl/jaini/Jaini-Regular.ttf"],
  ["jim-nightshade.ttf", "ofl/jimnightshade/JimNightshade-Regular.ttf"],
  ["risque.ttf", "ofl/risque/Risque-Regular.ttf"],
  ["roboto-slab.ttf", "apache/robotoslab/RobotoSlab[wght].ttf"],
  ["medievalsharp.ttf", "ofl/medievalsharp/MedievalSharp.ttf"],
  ["pirata-one.ttf", "ofl/pirataone/PirataOne-Regular.ttf"],
  ["almendra.ttf", "ofl/almendra/Almendra-Regular.ttf"],
  ["almendra-bold.ttf", "ofl/almendra/Almendra-Bold.ttf"],
  ["almendra-display.ttf", "ofl/almendradisplay/AlmendraDisplay-Regular.ttf"],
  ["metamorphous.ttf", "ofl/metamorphous/Metamorphous-Regular.ttf"],
  ["eagle-lake.ttf", "ofl/eaglelake/EagleLake-Regular.ttf"],
  ["new-rocker.ttf", "ofl/newrocker/NewRocker-Regular.ttf"],
  ["germania-one.ttf", "ofl/germaniaone/GermaniaOne-Regular.ttf"],
  ["metal-mania.ttf", "ofl/metalmania/MetalMania-Regular.ttf"],
  ["fondamento.ttf", "ofl/fondamento/Fondamento-Regular.ttf"],
  ["fondamento-italic.ttf", "ofl/fondamento/Fondamento-Italic.ttf"],
  ["cormorant-unicase.ttf", "ofl/cormorantunicase/CormorantUnicase-Regular.ttf"],
  ["cormorant-unicase-bold.ttf", "ofl/cormorantunicase/CormorantUnicase-Bold.ttf"],
  ["berkshire-swash.ttf", "ofl/berkshireswash/BerkshireSwash-Regular.ttf"],
  ["texturina.ttf", "ofl/texturina/Texturina[opsz,wght].ttf"],
  ["texturina-italic.ttf", "ofl/texturina/Texturina-Italic[opsz,wght].ttf"],
  ["caudex.ttf", "ofl/caudex/Caudex-Regular.ttf"],
  ["caudex-bold.ttf", "ofl/caudex/Caudex-Bold.ttf"],
  ["caudex-italic.ttf", "ofl/caudex/Caudex-Italic.ttf"],
  ["rye.ttf", "ofl/rye/Rye-Regular.ttf"],
  ["sancreek.ttf", "ofl/sancreek/Sancreek-Regular.ttf"],
  ["nova-cut.ttf", "ofl/novacut/NovaCut.ttf"],
];

const externalFontAssets = [
  ["gl-stella-mystica.ttf", "https://raw.githubusercontent.com/Gutenberg-Labo/GL-StellaMystica/9571be8318faf0a1148e084ebb773e41dcf7c808/fonts/ttf/GL-StellaMystica.ttf", 30_000],
  ["gl-startaker.ttf", "https://raw.githubusercontent.com/Gutenberg-Labo/GL-StarTaker/3128f5d5ad7b6242af5c8cac05a5207fcc90a6e3/fonts/ttf/GL-StarTaker.ttf", 30_000],
  ["newspaper-text.ttf", "https://raw.githubusercontent.com/eliheuer/news-textura/ec7d172cab56a69a42c3793b3676b18a47ef877c/fonts/ttf/NewspaperText-Regular.ttf", 30_000],
  ["blaka.ttf", "https://raw.githubusercontent.com/Gue3bara/Blaka/7f264eee862d3e94c2cb6a728c6429c2f3b9adc3/fonts/regular/ttf/Blaka-Regular.ttf", 30_000],
  ["gothic-gumdrop.ttf", "https://raw.githubusercontent.com/mixfont/gothic-gumdrop/3e2f431556fd3f99138eade90d864ff51a80e33c/fonts/OpenType-TT/GothicGumDrop-Regular.ttf", 30_000],
  ["gl-german-cursive.ttf", "https://raw.githubusercontent.com/Gutenberg-Labo/GL-GermanCursive/0979e6154714bf6a283fe49d0108dea010162a76/fonts/ttf/GL-GermanCursive.ttf", 30_000],
  ["kjv1611.otf", "https://raw.githubusercontent.com/ctrlcctrlv/kjv1611/f957694f8eef31f997ae3ff17880c76292441774/KJV1611.otf", 30_000],
];

const externalLicenseAssets = [
  ["GL-StellaMystica-LICENSE.txt", "https://raw.githubusercontent.com/Gutenberg-Labo/GL-StellaMystica/9571be8318faf0a1148e084ebb773e41dcf7c808/LICENSE.txt"],
  ["GL-StarTaker-LICENSE.txt", "https://raw.githubusercontent.com/Gutenberg-Labo/GL-StarTaker/3128f5d5ad7b6242af5c8cac05a5207fcc90a6e3/LICENSE.txt"],
  ["Newspaper-Text-OFL.txt", "https://raw.githubusercontent.com/eliheuer/news-textura/ec7d172cab56a69a42c3793b3676b18a47ef877c/OFL.txt"],
  ["Blaka-OFL.txt", "https://raw.githubusercontent.com/Gue3bara/Blaka/7f264eee862d3e94c2cb6a728c6429c2f3b9adc3/OFL.txt"],
  ["Gothic-GumDrop-OFL.txt", "https://raw.githubusercontent.com/mixfont/gothic-gumdrop/3e2f431556fd3f99138eade90d864ff51a80e33c/OFL.txt"],
  ["GL-GermanCursive-LICENSE.txt", "https://raw.githubusercontent.com/Gutenberg-Labo/GL-GermanCursive/0979e6154714bf6a283fe49d0108dea010162a76/LICENSE.txt"],
  ["KJV1611-OFL.txt", "https://raw.githubusercontent.com/ctrlcctrlv/kjv1611/f957694f8eef31f997ae3ff17880c76292441774/LICENSE.txt"],
];

const PACK_PARTS = [
  "folio-v10-font-pack.b64.001",
  "folio-v10-font-pack.b64.002a",
  "folio-v10-font-pack.b64.002b",
  "folio-v10-font-pack.b64.002c",
  "folio-v10-font-pack.b64.002d",
  "folio-v10-font-pack.b64.003",
  "folio-v10-font-pack.b64.004",
  "folio-v10-font-pack.b64.005",
  "folio-v10-font-pack.b64.006",
  "folio-v10-font-pack.b64.007",
  "folio-v10-font-pack.b64.008",
];

const PACK_FILES = [
  ["kings/fonts/ttf/Kings-Regular.ttf", path.join(fontDir, "kings.ttf"), true],
  ["manufacturing/fonts/ttf/ManufacturingConsent-Regular.ttf", path.join(fontDir, "manufacturing-consent.ttf"), true],
  ["kings/OFL.txt", path.join(licenseDir, "Kings-OFL.txt"), false],
  ["manufacturing/OFL.txt", path.join(licenseDir, "Manufacturing-Consent-OFL.txt"), false],
];

const licenses = [
  ["EB-Garamond-OFL.txt", "ofl/ebgaramond/OFL.txt"],
  ["Libre-Caslon-Text-OFL.txt", "ofl/librecaslontext/OFL.txt"],
  ["Libre-Baskerville-OFL.txt", "ofl/librebaskerville/OFL.txt"],
  ["Source-Serif-4-OFL.txt", "ofl/sourceserif4/OFL.txt"],
  ["Newsreader-OFL.txt", "ofl/newsreader/OFL.txt"],
  ["Gelasio-OFL.txt", "ofl/gelasio/OFL.txt"],
  ["Vollkorn-OFL.txt", "ofl/vollkorn/OFL.txt"],
  ["Source-Sans-3-OFL.txt", "ofl/sourcesans3/OFL.txt"],
  ["IBM-Plex-Sans-OFL.txt", "ofl/ibmplexsans/OFL.txt"],
  ["Barlow-Condensed-OFL.txt", "ofl/barlowcondensed/OFL.txt"],
  ["Bodoni-Moda-OFL.txt", "ofl/bodonimoda/OFL.txt"],
  ["Cinzel-OFL.txt", "ofl/cinzel/OFL.txt"],
  ["Grenze-Gotisch-OFL.txt", "ofl/grenzegotisch/OFL.txt"],
  ["Roboto-Slab-LICENSE.txt", "apache/robotoslab/LICENSE.txt"],
  ["MedievalSharp-OFL.txt", "ofl/medievalsharp/OFL.txt"],
  ["Pirata-One-OFL.txt", "ofl/pirataone/OFL.txt"],
  ["Almendra-OFL.txt", "ofl/almendra/OFL.txt"],
  ["Almendra-Display-OFL.txt", "ofl/almendradisplay/OFL.txt"],
  ["Metamorphous-OFL.txt", "ofl/metamorphous/OFL.txt"],
  ["Eagle-Lake-OFL.txt", "ofl/eaglelake/OFL.txt"],
  ["New-Rocker-OFL.txt", "ofl/newrocker/OFL.txt"],
  ["Germania-One-OFL.txt", "ofl/germaniaone/OFL.txt"],
  ["Metal-Mania-OFL.txt", "ofl/metalmania/OFL.txt"],
  ["Fondamento-OFL.txt", "ofl/fondamento/OFL.txt"],
  ["Cormorant-Unicase-OFL.txt", "ofl/cormorantunicase/OFL.txt"],
  ["Berkshire-Swash-OFL.txt", "ofl/berkshireswash/OFL.txt"],
  ["Texturina-OFL.txt", "ofl/texturina/OFL.txt"],
  ["Caudex-OFL.txt", "ofl/caudex/OFL.txt"],
  ["Rye-OFL.txt", "ofl/rye/OFL.txt"],
  ["Sancreek-OFL.txt", "ofl/sancreek/OFL.txt"],
  ["Nova-Cut-OFL.txt", "ofl/novacut/OFL.txt"],
  ["Fruktur-OFL.txt", "ofl/fruktur/OFL.txt"],
  ["Grenze-OFL.txt", "ofl/grenze/OFL.txt"],
  ["Jacquarda-Bastarda-9-OFL.txt", "ofl/jacquardabastarda9/OFL.txt"],
  ["Rakkas-OFL.txt", "ofl/rakkas/OFL.txt"],
  ["Jaini-Purva-OFL.txt", "ofl/jainipurva/OFL.txt"],
  ["Jaini-OFL.txt", "ofl/jaini/OFL.txt"],
  ["Jim-Nightshade-OFL.txt", "ofl/jimnightshade/OFL.txt"],
  ["Risque-OFL.txt", "ofl/risque/OFL.txt"],
];

function encodeRepoPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function fetchUrlWithRetry(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(`Unable to fetch ${url}: HTTP ${response.status}`);
      if (!retryable) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError ?? new Error(`Unable to fetch ${url}`);
}

async function fetchWithRetry(relativePath, attempts = 4) {
  return fetchUrlWithRetry(`${RAW}/${encodeRepoPath(relativePath)}`, attempts);
}

async function assertQualifiedDisplaySources() {
  for (const directory of QUALIFIED_DISPLAY_SOURCES) {
    const response = await fetchWithRetry(`ofl/${directory}/METADATA.pb`);
    const metadata = await response.text();
    if (!/license:\s*"OFL"/.test(metadata)) {
      throw new Error(`Display font ${directory} is not OFL in pinned Google Fonts metadata.`);
    }
    if (!/subsets:\s*"latin-ext"/.test(metadata)) {
      throw new Error(`Display font ${directory} does not advertise latin-ext / Polish coverage.`);
    }
  }
}

function assertFontBuffer(data, label, minBytes = 30_000) {
  if (data.length < minBytes) throw new Error(`Downloaded font is unexpectedly small: ${label}`);
  const signature = data.subarray(0, 4).toString("hex");
  if (signature !== "00010000" && data.subarray(0, 4).toString("ascii") !== "OTTO") {
    throw new Error(`Downloaded file is not a TrueType/OpenType font: ${label}`);
  }
}

async function downloadUrl(url, destination, minBytes = 30_000) {
  try {
    const existing = await fs.readFile(destination);
    if (existing.length >= minBytes) return false;
  } catch {
    // Missing file: fetch it below.
  }
  const response = await fetchUrlWithRetry(url);
  const data = Buffer.from(await response.arrayBuffer());
  assertFontBuffer(data, url, minBytes);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
  return true;
}

async function downloadTextUrl(url, destination) {
  try {
    const existing = await fs.readFile(destination);
    if (existing.length > 100) return false;
  } catch {
    // Missing file: fetch it below.
  }
  const response = await fetchUrlWithRetry(url);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 100) throw new Error(`Downloaded license is unexpectedly small: ${url}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
  return true;
}

function extractZipEntry(buffer, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Unable to open font archive"));
      let settled = false;
      zip.readEntry();
      zip.on("entry", (entry) => {
        const normalized = entry.fileName.replace(/\\/g, "/").toLowerCase();
        const wanted = entryName.replace(/\\/g, "/").toLowerCase();
        const base = path.basename(entry.fileName).toLowerCase();
        const wantedBase = path.basename(entryName).toLowerCase();
        if (normalized !== wanted && base !== wantedBase) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error(`Unable to read ${entryName}`));
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            settled = true;
            zip.close();
            resolve(Buffer.concat(chunks));
          });
        });
      });
      zip.on("end", () => {
        if (!settled) reject(new Error(`Font archive does not contain ${entryName}`));
      });
      zip.on("error", reject);
    });
  });
}

async function downloadArchiveFont(url, entryName, destination) {
  try {
    const existing = await fs.readFile(destination);
    if (existing.length > 30_000) return false;
  } catch {
    // Missing file: fetch it below.
  }
  const response = await fetchUrlWithRetry(url);
  const archive = Buffer.from(await response.arrayBuffer());
  const data = await extractZipEntry(archive, entryName);
  assertFontBuffer(data, `${url}#${entryName}`, 15_000);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
  return true;
}

async function loadEmbeddedFontPack() {
  const assetDir = path.join(root, "assets", "font-packs");
  const chunks = await Promise.all(
    PACK_PARTS.map((name) => fs.readFile(path.join(assetDir, name), "utf8"))
  );
  return Buffer.from(chunks.join("").replace(/\s+/g, ""), "base64");
}

async function extractEmbeddedFontPack() {
  const archive = await loadEmbeddedFontPack();
  const digest = createHash("sha256").update(archive).digest("hex");
  const expectedDigest = "6a1a2103dcc00916662e0ede34606f303cbae32d84e2ddcc3cf05132dfd349be";
  if (digest !== expectedDigest) {
    throw new Error(`Embedded V10 font pack checksum mismatch: expected ${expectedDigest}, got ${digest}`);
  }
  let count = 0;
  for (const [entryName, destination, font] of PACK_FILES) {
    let exists = false;
    try {
      const current = await fs.readFile(destination);
      exists = font ? current.length > 15_000 : current.length > 100;
    } catch {
      exists = false;
    }
    if (exists) continue;
    const data = await extractZipEntry(archive, entryName);
    if (font) assertFontBuffer(data, entryName, 15_000);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, data);
    count++;
  }
  return count;
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
  if (font) assertFontBuffer(data, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
  return true;
}


const POLISH_GLYPHS = [..."ĄĆĘŁŃÓŚŹŻąćęłńóśźż"];
const POLISH_DISPLAY_FONT_FILES = [
  ["Barlow Condensed", "barlow-condensed-regular.ttf"],
  ["Bodoni Moda", "bodoni-moda.ttf"],
  ["Cinzel", "cinzel.ttf"],
  ["Grenze Gotisch", "grenze-gotisch.ttf"],
  ["Fruktur", "fruktur.ttf"],
  ["Pirata One", "pirata-one.ttf"],
  ["New Rocker", "new-rocker.ttf"],
  ["Jacquarda Bastarda 9", "jacquarda-bastarda-9.ttf"],
  ["Jaini Purva", "jaini-purva.ttf"],
  ["Jaini", "jaini.ttf"],
  ["Jim Nightshade", "jim-nightshade.ttf"],
  ["Texturina", "texturina.ttf"],
  ["Manufacturing Consent", "manufacturing-consent.ttf"],
  ["Newspaper Text", "newspaper-text.ttf"],
  ["KJV1611", "kjv1611.otf"],
  ["GL-StellaMystica", "gl-stella-mystica.ttf"],
  ["GL-StarTaker", "gl-startaker.ttf"],
  ["Gothic GumDrop", "gothic-gumdrop.ttf"],
  ["Blaka", "blaka.ttf"],
  ["MedievalSharp", "medievalsharp.ttf"],
  ["Almendra", "almendra.ttf"],
  ["Metamorphous", "metamorphous.ttf"],
  ["Eagle Lake", "eagle-lake.ttf"],
  ["Fondamento", "fondamento.ttf"],
  ["Caudex", "caudex.ttf"],
  ["Cormorant Unicase", "cormorant-unicase.ttf"],
  ["Berkshire Swash", "berkshire-swash.ttf"],
  ["Risque", "risque.ttf"],
  ["Kings", "kings.ttf"],
  ["Grenze", "grenze.ttf"],
  ["GL-GermanCursive", "gl-german-cursive.ttf"],
  ["Rakkas", "rakkas.ttf"],
  ["Sancreek", "sancreek.ttf"],
  ["Nova Cut", "nova-cut.ttf"],
];

function fontHasCodepoint(data, codepoint) {
  if (data.length < 12) return false;
  const numTables = data.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 16 > data.length) return false;
    if (data.toString("ascii", offset, offset + 4) === "cmap") {
      cmapOffset = data.readUInt32BE(offset + 8);
      break;
    }
  }
  if (cmapOffset < 0 || cmapOffset + 4 > data.length) return false;
  const count = data.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < count; i++) {
    const record = cmapOffset + 4 + i * 8;
    if (record + 8 > data.length) continue;
    const subtable = cmapOffset + data.readUInt32BE(record + 4);
    if (subtable + 2 > data.length) continue;
    const format = data.readUInt16BE(subtable);
    if (format === 12 && subtable + 16 <= data.length) {
      const groups = data.readUInt32BE(subtable + 12);
      for (let group = 0; group < groups; group++) {
        const offset = subtable + 16 + group * 12;
        if (offset + 12 > data.length) break;
        const start = data.readUInt32BE(offset);
        const end = data.readUInt32BE(offset + 4);
        const startGlyph = data.readUInt32BE(offset + 8);
        if (codepoint >= start && codepoint <= end) return startGlyph + (codepoint - start) !== 0;
      }
    }
    if (format === 4 && codepoint <= 0xffff && subtable + 14 <= data.length) {
      const segCount = data.readUInt16BE(subtable + 6) / 2;
      const endBase = subtable + 14;
      const startBase = endBase + segCount * 2 + 2;
      const deltaBase = startBase + segCount * 2;
      const rangeBase = deltaBase + segCount * 2;
      for (let segment = 0; segment < segCount; segment++) {
        const end = data.readUInt16BE(endBase + segment * 2);
        const start = data.readUInt16BE(startBase + segment * 2);
        if (codepoint < start || codepoint > end) continue;
        const delta = data.readInt16BE(deltaBase + segment * 2);
        const range = data.readUInt16BE(rangeBase + segment * 2);
        if (range === 0) return ((codepoint + delta) & 0xffff) !== 0;
        const glyphOffset = rangeBase + segment * 2 + range + (codepoint - start) * 2;
        if (glyphOffset + 2 > data.length) return false;
        let glyph = data.readUInt16BE(glyphOffset);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        return glyph !== 0;
      }
    }
  }
  return false;
}

async function assertPolishDisplayCoverage() {
  for (const [family, file] of POLISH_DISPLAY_FONT_FILES) {
    const data = await fs.readFile(path.join(fontDir, file));
    const missing = POLISH_GLYPHS.filter((glyph) => !fontHasCodepoint(data, glyph.codePointAt(0)));
    if (missing.length) {
      throw new Error(`Visible display font ${family} is missing Polish glyphs: ${missing.join(" ")}`);
    }
  }
}

const RETIRED_FONT_FILES = ["jena-gotisch.ttf", "cat-altenglisch.ttf", "slavkappen.ttf"];
const RETIRED_LICENSE_FILES = ["Jena-Gotisch-OFL.txt", "CAT-Altenglisch-OFL.txt", "Slavkappen-OFL.txt"];

await fs.mkdir(fontDir, { recursive: true });
await fs.mkdir(licenseDir, { recursive: true });
await assertQualifiedDisplaySources();
for (const name of RETIRED_FONT_FILES) await fs.rm(path.join(fontDir, name), { force: true });
for (const name of RETIRED_LICENSE_FILES) await fs.rm(path.join(licenseDir, name), { force: true });

let fetched = 0;
for (const [name, remotePath] of assets) {
  if (await download(remotePath, path.join(fontDir, name), true)) fetched++;
}
for (const [name, url, minBytes] of externalFontAssets) {
  if (await downloadUrl(url, path.join(fontDir, name), minBytes)) fetched++;
}
fetched += await extractEmbeddedFontPack();
for (const [name, remotePath] of licenses) {
  if (await download(remotePath, path.join(licenseDir, name), false)) fetched++;
}
for (const [name, url] of externalLicenseAssets) {
  if (await downloadTextUrl(url, path.join(licenseDir, name))) fetched++;
}
await assertPolishDisplayCoverage();

await fs.writeFile(
  path.join(fontDir, "SOURCE.txt"),
  [
    "Folio built-in typography fonts",
    `Primary source: google/fonts commit ${GOOGLE_FONTS_COMMIT}`,
    "All typefaces exposed by Folio's display-font library are gated against the actual font cmap for: ĄĆĘŁŃÓŚŹŻąćęłńóśźż.",
    "Google Fonts sources are pinned to the commit above and require OFL metadata plus the cmap gate.",
    "Additional pinned upstream blackletter sources: GL-StellaMystica 9571be83, GL-StarTaker 3128f5d5, News Textura ec7d172c, Blaka 7f264eee, Gothic GumDrop 3e2f4315, GL-GermanCursive 0979e615, KJV1611 f957694f.",
    "Jena Gotisch, CAT Altenglisch and Slavkappen are retired and deleted from the built font directory because they do not provide the required Polish glyph set.",
    "See licenses/ for the exact bundled font licenses.",
    "",
  ].join("\n"),
  "utf8",
);
console.log(fetched ? `Fetched ${fetched} Folio theme-font assets.` : "Folio theme fonts already present.");
