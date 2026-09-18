import { mergeRecentProjects, type RecentProject } from "../web/src/recent-projects.ts";
import type { ProjectSummary } from "../web/src/types.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

function summary(projectFile: string | null, title: string, author = "Author", source: ProjectSummary["source"] = "folio"): ProjectSummary {
  return {
    projectId: `project-${title}`,
    meta: { title, author, language: "en", theme: "literary" },
    sections: [], warnings: [], hasCover: false, bodyChars: 0, fontFamilies: [], typography: {},
    source, folder: null, projectFile, editable: true, config: null, bluesOutput: null,
  };
}

console.log("\nRecent project history");

let recent: RecentProject[] = [];
recent = mergeRecentProjects(recent, summary("C:\\Books\\Novel.folio", "Novel"), 1000);
check("adds a .folio project", recent.length === 1 && recent[0].title === "Novel");

recent = mergeRecentProjects(recent, summary("c:\\books\\novel.folio", "Novel — Revised", "A. Writer"), 2000);
check("deduplicates Windows paths case-insensitively", recent.length === 1);
check("refreshes title and author on reopen", recent[0].title === "Novel — Revised" && recent[0].author === "A. Writer");
check("moves the reopened project to newest", recent[0].lastOpened === 2000);

const beforeSample = recent;
const afterSample = mergeRecentProjects(recent, summary(null, "Sample", "Folio", "sample"), 3000);
check("does not put the bundled sample in recents", afterSample === beforeSample);

const afterLegacyFolder = mergeRecentProjects(recent, {
  ...summary(null, "Legacy", "Folio", "folder"),
  folder: "C:\\Books\\Legacy",
}, 3500);
check("does not treat a legacy folder as a normal recent project", afterLegacyFolder === recent);

for (let i = 0; i < 10; i++) {
  recent = mergeRecentProjects(recent, summary(`C:\\Books\\Book-${i}.folio`, `Book ${i}`), 4000 + i);
}
check("keeps only eight recent projects", recent.length === 8, String(recent.length));
check("sorts newest first", recent[0].title === "Book 9" && recent[7].title === "Book 2", recent.map((p) => p.title).join(", "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
