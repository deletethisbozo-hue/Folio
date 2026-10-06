import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  interpolatePairedScroll,
  normalizePairedScrollAnchors,
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

const normalizedAnchors = normalizePairedScrollAnchors([
  { target: 0, source: 0 },
  { target: 50, source: 180 },
  { target: 50.2, source: 170 },
  { target: 100, source: 90 },
  { target: Number.NaN, source: 10 },
]);
check("paired scroll anchors are finite, deduplicated and monotonic",
  normalizedAnchors.length === 3
  && normalizedAnchors.every((item, index) => index === 0 || item.target > normalizedAnchors[index - 1].target)
  && normalizedAnchors.every((item, index) => index === 0 || item.source >= normalizedAnchors[index - 1].source));

const app = readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");
const pane = readFileSync(path.join(ROOT, "web/src/SecondDraftPane.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "web/src/v300-second-draft.css"), "utf8");
const server = readFileSync(path.join(ROOT, "server/write-studio.ts"), "utf8");
const serverApi = readFileSync(path.join(ROOT, "server/write-studio-api.ts"), "utf8");

check("Second Draft is separate from legacy Split View",
  app.includes("secondDraftView") && app.includes("<SecondDraftPane") && app.includes("<WritingSplitPane"));
check("Second Draft only opens for real chapter-to-chapter work",
  app.includes('selectedSection?.kind !== "chapter" || chapters.length < 2')
  && app.includes('selectedSection?.kind === "chapter" && <SecondDraftPane')
  && server.includes('target.kind !== "chapter"')
  && server.includes('source.kind !== "chapter"'));
check("background progress sync cannot replace newer Second Draft state",
  app.includes("dailyProgress: updated.dailyProgress")
  && app.includes("setWriteStudioState((current) => current"));
check("Source is explicitly read only", pane.includes("contentEditable={false}") && pane.includes("Source draft · read only"));
check("Second Draft action bar exposes the source-decision workflow",
  ["Rewrite this", "Cut", "Later", "Keep", "Seal"].every((label) => pane.includes(label))
  && pane.includes("second-draft-actionbar")
  && css.includes(".second-draft-actionbar")
  && !pane.includes("second-draft-rail")
  && !css.includes(".second-draft-rail"));
check("Memory Rewrite supports hold-Alt peek", pane.includes('event.key === "Alt"') && css.includes(".memory-peek"));
check("Source Burn has status-specific highlight layers",
  ["folio-source-rewritten", "folio-source-cut", "folio-source-keep", "folio-source-sent", "folio-source-later", "folio-source-active"]
    .every((name) => pane.includes(name) || css.includes(name)));
check("Send Ahead is persisted, not a local-only chip",
  server.includes("sendSecondDraftAhead") && serverApi.includes("/second-draft/send-ahead") && pane.includes("Send ahead…"));
check("Chapter Seal creates a snapshot and Chapter Reveal payload",
  server.includes('"Second Draft seal"') && server.includes("sealSecondDraftChapter") && pane.includes("Chapter sealed"));
check("Chapter Seal cannot certify a zero-work Second Draft",
  server.includes("Process at least one source passage before sealing Second Draft.")
  && pane.includes("processed === 0"));
check("same-source fingerprint changes invalidate old Source Burn ranges",
  server.includes("existing.sourceFingerprint !== sourceFingerprint"));

check("Second Draft remembers view state across remounts",
  pane.includes("folio.second-draft.view.v3")
  && pane.includes("targetRatio")
  && pane.includes("sourceRatio")
  && pane.includes("readSecondDraftViewState"));
check("paired scroll requires explicit source/target text links",
  ["Select matching lines", "Link lines", "Reset links"].every((label) => pane.includes(label))
  && pane.includes("targetOffset")
  && pane.includes("sourceOffset")
  && pane.includes("targetSelection")
  && pane.includes("manualAnchors"));
check("bidirectional paired scroll consumes programmatic events instead of bouncing",
  pane.includes("programmaticScrollRef")
  && pane.includes("consumeProgrammatic")
  && !pane.includes("scrollSyncRef"));
check("Source Burn and paired scroll only operate on the actually paired source",
  pane.includes("!sourceMatchesPair || sourceChanged")
  && pane.includes("sourceMatchesPair && !sourceChanged")
  && pane.includes("Re-pairing this chapter will clear its existing Second Draft source decisions"));
check("non-rewrite source decisions are created atomically",
  pane.includes("status,")
  && !pane.includes("const created = [...state.secondDraft.blocks]")
  && server.includes('status: Exclude<SecondDraftBlockStatus, "sent"> = "active"'));
check("Later decisions have a resumable queue instead of becoming permanent blockers",
  pane.includes("Later queue")
  && pane.includes("Resume next")
  && pane.includes("resumeLater")
  && server.includes('patch.status === "active"'));
check("Second Draft decisions can be undone after rewrite",
  pane.includes("Undo rewrite")
  && pane.includes("Undo last")
  && pane.includes("Cancel rewrite")
  && pane.includes("undoDecision")
  && server.includes("removeSecondDraftBlock"));
check("Second Draft can jump directly to unreviewed source",
  pane.includes("Next unreviewed")
  && pane.includes("jumpToNextUnreviewed"));
check("new source decisions cannot overlap old decisions",
  server.includes("secondDraftRangesOverlap")
  && server.includes("overlaps an existing Second Draft decision"));
check("Second Draft uses the same text-node coordinate system for pairing and anchors",
  pane.includes('editor.textContent ?? ""')
  && !pane.includes("editor.innerText.length"));

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
