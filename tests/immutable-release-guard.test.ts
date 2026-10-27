import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "windows-release.yml"), "utf8");

const guardStart = workflow.indexOf("- name: Skip publication for an existing immutable version");
const publishStart = workflow.indexOf("- name: Publish immutable GitHub Release");
assert(guardStart >= 0 && publishStart > guardStart, "release guard and publisher steps must exist in order");
const guard = workflow.slice(guardStart, publishStart);
const publish = workflow.slice(publishStart);

assert.match(guard, /FOLIO_SKIP_PUBLISH=true/, "an existing version must mark this main push as qualification only");
assert.match(guard, /gh release view \$tag/);
assert.match(guard, /git ls-remote --exit-code --tags origin/);
assert.match(publish, /if:.*FOLIO_SKIP_PUBLISH.*true/, "the publisher must honor the immutable-release guard");
console.log("  ✓ existing immutable releases skip duplicate publication while keeping main CI green");
