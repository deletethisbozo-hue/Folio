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
  "medievalsharp", "pirataone", "almendra", "almendradisplay", "metamorphous",
  "eaglelake", "newrocker", "germaniaone", "metalmania", "fondamento",
  "cormorantunicase", "berkshireswash", "texturina", "caudex", "rye", "sancreek", "novacut",
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

const externalAssets = [
  ["slavkappen.ttf", "https://db.onlinewebfonts.com/t/751bb64b3e1933d2653d99d63c779743.ttf", 15_000],
];

const archiveAssets = [
  ["jena-gotisch.ttf", "https://static.wfonts.com/download/data/2017/10/16/jena-gotisch/jena-gotisch.zip", "JenaGotisch.ttf"],
  ["cat-altenglisch.ttf", "https://static.wfonts.com/download/data/2023/04/06/cat-altenglisch/cat-altenglisch.zip", "CAT Altenglisch.ttf"],
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
  ["slavkappen/Slavkappen.ttf", path.join(fontDir, "slavkappen.ttf"), true],
  ["jena/JenaGotisch.ttf", path.join(fontDir, "jena-gotisch.ttf"), true],
  ["altenglisch/Altenglisch.ttf", path.join(fontDir, "cat-altenglisch.ttf"), true],
  ["kings/fonts/ttf/Kings-Regular.ttf", path.join(fontDir, "kings.ttf"), true],
  ["manufacturing/fonts/ttf/ManufacturingConsent-Regular.ttf", path.join(fontDir, "manufacturing-consent.ttf"), true],
  ["slavkappen/OFL.txt", path.join(licenseDir, "Slavkappen-OFL.txt"), false],
  ["jena/Open Font License.txt", path.join(licenseDir, "Jena-Gotisch-OFL.txt"), false],
  ["altenglisch/Open Font License.txt", path.join(licenseDir, "CAT-Altenglisch-OFL.txt"), false],
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

await fs.mkdir(fontDir, { recursive: true });
await fs.mkdir(licenseDir, { recursive: true });
await assertQualifiedDisplaySources();
let fetched = 0;
for (const [name, remotePath] of assets) {
  if (await download(remotePath, path.join(fontDir, name), true)) fetched++;
}
fetched += await extractEmbeddedFontPack();
for (const [name, remotePath] of licenses) {
  if (await download(remotePath, path.join(licenseDir, name), false)) fetched++;
}

await fs.writeFile(
  path.join(fontDir, "SOURCE.txt"),
  [
    "Folio built-in typography fonts",
    `Primary source: google/fonts commit ${GOOGLE_FONTS_COMMIT}`,
    "Additional display fonts are embedded from the user-supplied original archives:",
    "Jena Gotisch — Peter Wiegel",
    "CAT Altenglisch — Peter Wiegel",
    "Slavkappen — Jason Reed",
    "Kings — Robert Slimbach / Google Fonts distribution",
    "Manufacturing Consent — Google Fonts distribution",
    "Embedded font pack SHA-256: 6a1a2103dcc00916662e0ede34606f303cbae32d84e2ddcc3cf05132dfd349be",
    "Folio 3.2 display additions are taken only from the pinned Google Fonts snapshot and require OFL + latin-ext metadata:",
    "MedievalSharp, Pirata One, Almendra, Almendra Display, Metamorphous, Eagle Lake, New Rocker, Germania One, Metal Mania, Fondamento, Cormorant Unicase, Berkshire Swash, Texturina, Caudex, Rye, Sancreek, Nova Cut.",
    "Scarbes is intentionally NOT bundled because redistribution terms were not clear enough.",
    "See licenses/ for the original license texts extracted from the supplied archives.",
    "",
  ].join("\n"),
  "utf8",
);
console.log(fetched ? `Fetched ${fetched} Folio theme-font assets.` : "Folio theme fonts already present.");
