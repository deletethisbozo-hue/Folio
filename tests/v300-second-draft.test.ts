import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  interpolatePairedScroll,
  secondDraftProgress,
  sourceFingerprint,
} from "../web/src/second-draft.ts";
import type { SecondDraftBlock, SecondDraftPair } from "../web/src/write-studio.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("✓ " + label); }
  else { failed++; console.error("✗ " + label + (detail ? " — " + detail : "")); }
}

const pair: SecondDraftPair = {
  targetSectionId: "draft-2",
  sourceSectionId: "draft-1",
  sourceTextLength: 1000,
  sourceFingerprint: "12345678",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const blocks: SecondDraftBlock[] = [
  { id: "a", targetSectionId: "draft-2", sourceSectionId: "draft-1", sourceStart: 0, sourceEnd: 200, sourceText: "a", status: "rewritten", createdAt: "", updatedAt: "" },
  { id: "b", targetSectionId: "draft-2", sourceSectionId: "draft-1", sourceStart: 150, sourceEnd: 300, sourceText: "b", status: "keep", createdAt: "", updatedAt: "" },
  { id: "c", targetSectionId: "draft-2", sourceSectionId: "draft-1", sourceStart: 500, sourceEnd: 600, sourceText: "c", status: "later", createdAt: "", updatedAt: "" },
  { id: "d", targetSectionId: "other", sourceSectionId: "draft-1", sourceStart: 300, sourceEnd: 900, sourceText: "d", status: "cut", createdAt: "", updatedAt: "" },
];

check("Source Burn progress merges overlapping completed ranges", Math.abs(secondDraftProgress(pair, blocks) - 0.3) < 0.0001);
check("Later blocks remain unresolved and do not inflate progress", secondDraftProgress(pair, blocks) < 0.4);
check("source fingerprint is stable and content-sensitive",
  sourceFingerprint("same text") === sourceFingerprint("same text") && sourceFingerprint("same text") !== sourceFingerprint("same text!"));
check("paired scroll interpolates between real anchors", interpolatePairedScroll(50, [{ target: 0, source: 0 }, { target: 100, source: 240 }]) === 120);
check("paired scroll clamps before the first and after the last anchor",
  interpolatePairedScroll(-20, [{ target: 0, source: 10 }, { target: 100, source: 200 }]) === 10
  && interpolatePairedScroll(999, [{ target: 0, source: 10 }, { target: 100, source: 200 }]) === 200);

const app = readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");
const pane = readFileSync(path.join(ROOT, "web/src/SecondDraftPane.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "web/src/v300-second-draft.css"), "utf8");
const server = readFileSync(path.join(ROOT, "server/write-studio.ts"), "utf8");
const serverApi = readFileSync(path.join(ROOT, "server/write-studio-api.ts"), "utf8");

check("Second Draft is separate from legacy Split View",
  app.includes("secondDraftView") && app.includes("<SecondDraftPane") && app.includes("<WritingSplitPane"));
check("Source is explicitly read only", pane.includes("contentEditable={false}") && pane.includes("Source draft · read only"));
check("Rewrite Rail exposes the requested workflow",
  ["Rewrite this", "Cut", "Later", "Keep", "Seal chapter"].every((label) => pane.includes(label)));
check("Memory Rewrite supports hold-Alt peek", pane.includes('event.key === "Alt"') && css.includes(".memory-peek"));
check("Source Burn has status-specific highlight layers",
  ["folio-source-rewritten", "folio-source-cut", "folio-source-keep", "folio-source-sent", "folio-source-later", "folio-source-active"]
    .every((name) => pane.includes(name) || css.includes(name)));
check("Send Ahead is persisted, not a local-only chip",
  server.includes("sendSecondDraftAhead") && serverApi.includes("/second-draft/send-ahead") && pane.includes("Send ahead…"));
check("Chapter Seal creates a snapshot and Chapter Reveal payload",
  server.includes('"Second Draft seal"') && server.includes("sealSecondDraftChapter") && pane.includes("Chapter sealed"));
check("same-source fingerprint changes invalidate old Source Burn ranges",
  server.includes("existing.sourceFingerprint !== sourceFingerprint"));

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
