import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgetRecentProject, readRecentProjects, rememberRecentProject } from "../server/recent-projects.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nPersistent Recent Books");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-recents-test-"));
process.env.FOLIO_WRITABLE_ROOT = root;
try {
  await rememberRecentProject("C:\\Books\\One.folio", "One", "Writer", 1000);
  await rememberRecentProject("C:\\Books\\Two.folio", "Two", "Writer", 2000);
  const firstRead = await readRecentProjects();
  check("stores recent books outside browser origin storage", firstRead.length === 2 && firstRead[0].title === "Two");

  // Re-read from disk rather than from an in-memory cache. This models a new
  // renderer origin on the next packaged launch, which previously lost history.
  const disk = JSON.parse(await fs.readFile(path.join(root, "recent-projects.json"), "utf8"));
  check("writes a durable recent-projects.json file", Array.isArray(disk) && disk.length === 2);

  await rememberRecentProject("C:\\Users\\User\\AppData\\Roaming\\folio-book-formatter\\temp\\folio-work-adCOHU", "Temp", "Writer", 2500);
  const withoutTemp = await readRecentProjects();
  check("temporary working copies never enter persistent recents", withoutTemp.length === 2 && withoutTemp.every((item) => /\.folio$/i.test(item.path)));

  await rememberRecentProject("c:\\books\\one.folio", "One Revised", "New Writer", 3000);
  const deduped = await readRecentProjects();
  check("deduplicates Windows paths in persistent history", deduped.length === 2 && deduped[0].title === "One Revised");

  await forgetRecentProject("C:\\BOOKS\\TWO.FOLIO");
  const removed = await readRecentProjects();
  check("removing a recent book persists", removed.length === 1 && removed[0].title === "One Revised");
} finally {
  delete process.env.FOLIO_WRITABLE_ROOT;
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
