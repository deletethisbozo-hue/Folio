const fs = require("node:fs");
const path = require("node:path");
const { nativeImage } = require("electron");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "assets", "folio-icon.png");
const outPath = path.join(root, "assets", "folio-icon.ico");
const sizes = [16, 32, 48, 64, 128, 256];

const source = nativeImage.createFromPath(sourcePath);
if (source.isEmpty()) throw new Error("Could not load Folio icon source: " + sourcePath);

const images = sizes.map((size) => {
  const png = source.resize({ width: size, height: size, quality: "best" }).toPNG();
  if (!png.length) throw new Error("Could not render Folio icon at " + size + "px.");
  return { size, png };
});

const headerSize = 6 + images.length * 16;
let offset = headerSize;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

images.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});

fs.writeFileSync(outPath, Buffer.concat([header, ...images.map((item) => item.png)]));
const written = fs.readFileSync(outPath);
const count = written.readUInt16LE(4);
const encodedSizes = [];
for (let index = 0; index < count; index++) {
  const entry = 6 + index * 16;
  encodedSizes.push(written.readUInt8(entry) || 256);
}
if (JSON.stringify(encodedSizes) !== JSON.stringify(sizes)) {
  throw new Error("ICO directory mismatch: " + encodedSizes.join(", "));
}
console.log("Generated Folio Windows icon:", outPath, encodedSizes.map((size) => size + "x" + size).join(", "));
