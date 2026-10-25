import assert from "node:assert/strict";
import path from "node:path";
import { safeJoin } from "../server/projects.ts";

console.log("\nProject upload path traversal checks");
const root = path.resolve("tmp", "folio-project");
const valid = safeJoin(root, "chapters/one.md");
assert.equal(valid, path.join(root, "chapters", "one.md"));
for (const candidate of [
  "../folio-project-evil/leak.md",
  "chapters/../../../folio-project-evil/leak.md",
  "../../secrets.md",
  "/tmp/secrets.md",
  "C:\\Windows\\secrets.md",
  "\\\\server\\share\\secrets.md",
  "./",
]) {
  assert.throws(() => safeJoin(root, candidate), /Unsafe path/, candidate);
}
console.log("  ✓ accepts project-relative uploads, rejects traversal, absolute paths and sibling prefixes");
