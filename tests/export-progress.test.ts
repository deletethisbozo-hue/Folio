import assert from "node:assert/strict";
import { readExportProgress, updateExportProgress } from "../server/export-progress.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";
updateExportProgress("project-a", id, 20, "Composing pages");
updateExportProgress("project-a", id, 10, "Retrying a page");
assert.deepEqual(readExportProgress("project-a", id), {
  percent: 20,
  stage: "Retrying a page",
  updatedAt: readExportProgress("project-a", id)?.updatedAt,
});
assert.equal(readExportProgress("project-b", id), null, "progress must be scoped to its project");
updateExportProgress("project-a", "../invalid", 50, "Invalid ID");
assert.equal(readExportProgress("project-a", "../invalid"), null, "invalid IDs must not create progress records");
updateExportProgress("project-a", id, 120, "Complete");
assert.equal(readExportProgress("project-a", id)?.percent, 100, "progress must be capped at 100%");
console.log("  ✓ export progress is project-scoped, monotonic, and bounded");
