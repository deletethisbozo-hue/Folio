import { readFile, writeFile, rm } from "node:fs/promises";

const appPath = "web/src/App.tsx";
const workflowPath = ".github/workflows/v2-reader-profile-key-patch.yml";
const scriptPath = "scripts/patch-v2-reader-profile-key.mjs";

const source = await readFile(appPath, "utf8");
const before = 'key={`${project.projectId}:${selectedId}:${previewMode}`}';
const after = 'key={`${project.projectId}:${selectedId}:${previewMode === "print" ? "print" : "reader"}`}';

if (!source.includes(before)) {
  throw new Error("Expected preview iframe key was not found");
}

await writeFile(appPath, source.replace(before, after));
await rm(workflowPath, { force: true });
await rm(scriptPath, { force: true });
