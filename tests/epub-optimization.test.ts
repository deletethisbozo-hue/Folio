import assert from "node:assert/strict";
import { writeEpub, readEpubEntries } from "../server/pipeline/epub-zip.ts";
import { optimizeEpubResources } from "../server/pipeline/epub-optimize.ts";
import { randomBytes } from "node:crypto";
const image = randomBytes(12000);
const original = Buffer.from(writeEpub([
  { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
  { name: "EPUB/content.opf", data: Buffer.from('<package><manifest><item id="one" href="media/one.png" media-type="image/png"/><item id="two" href="media/two.png" media-type="image/png"/><item id="text" href="text/one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>'), store: false },
  { name: "EPUB/text/one.xhtml", data: Buffer.from('<p>Before</p><img src="../media/one.png" alt="First"/><img src="../media/two.png" alt="Second"/><p>After</p>'), store: false },
  { name: "EPUB/media/one.png", data: image, store: false },
  { name: "EPUB/media/two.png", data: image, store: false },
]));
const optimized = await optimizeEpubResources(original);
const entries = await readEpubEntries(optimized.buffer);
assert.equal(optimized.removedAssets, 1);
assert.ok(optimized.bytesSaved > 11000);
assert.equal(entries.filter((entry) => entry.name.endsWith(".png")).length, 1);
assert.ok(Buffer.from(entries.find((entry) => entry.name.endsWith(".png"))!.data).equals(image), "Lossless optimization must keep the original image bytes");
const text = Buffer.from(entries.find((entry) => entry.name.endsWith(".xhtml"))!.data).toString();
assert.equal((text.match(/src="\.\.\/media\/one.png"/g) ?? []).length, 2);
assert.ok(text.includes('alt="First"') && text.includes('alt="Second"') && text.includes("Before") && text.includes("After"));
assert.ok(!Buffer.from(entries.find((entry) => entry.name.endsWith(".opf"))!.data).toString().includes('id="two"'));
assert.equal(entries[0].name, "mimetype");
assert.equal(entries[0].store, true);
const again = await optimizeEpubResources(optimized.buffer);
assert.ok(again.buffer.equals(optimized.buffer), "Optimization must be idempotent");
console.log("10 passed, 0 failed");
