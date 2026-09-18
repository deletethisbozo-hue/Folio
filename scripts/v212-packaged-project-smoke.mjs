import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const mode = process.argv[2] || "roundtrip";
const debugPort = process.env.FOLIO_E2E_DEBUG_PORT || "43138";
const appPort = process.env.FOLIO_E2E_PORT || "43137";
const apiBase = `http://127.0.0.1:${appPort}`;

async function connect() {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      return await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("Could not connect to packaged Folio.");
}

async function pageFor(browser) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url().includes(`127.0.0.1:${appPort}`));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Packaged Folio renderer was not found.");
}

async function request(method, url, body) {
  const response = await fetch(apiBase + url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json();
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${JSON.stringify(parsed)}`);
  return parsed;
}

async function waitFor(predicate, timeout = 15000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw last instanceof Error ? last : new Error("Timed out waiting for packaged Folio state.");
}

const browser = await connect();
try {
  const page = await pageFor(browser);

  if (mode === "verify-startup-file") {
    const expected = path.resolve(process.env.FOLIO_EXPECT_PROJECT || "");
    if (!expected) throw new Error("FOLIO_EXPECT_PROJECT is required.");
    await page.waitForSelector('.rich-editor[contenteditable="true"]', { timeout: 20000 });
    const state = await waitFor(async () => page.evaluate(() => ({
      book: new URL(window.location.href).searchParams.get("book"),
      title: document.querySelector(".section-title-button")?.textContent?.trim() || "",
      body: document.querySelector(".rich-editor")?.dataset.markdown || "",
    })), 20000);
    if (path.resolve(state.book || "") !== expected) {
      throw new Error(`Installed Folio did not open the requested .folio file: ${JSON.stringify(state)}`);
    }
    if (!state.body.includes("PACKAGED PROJECT ROUNDTRIP")) {
      throw new Error("Installed Folio opened the project but its persisted manuscript text is missing.");
    }
    console.log("Installed Folio startup from a .folio argument passed.");
    process.exit(0);
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-v212-packaged-"));
  const projectFile = path.join(root, "Packaged Project.folio");
  const secondProjectFile = path.join(root, "Second Instance.folio");
  const exportDir = path.join(root, "exports");

  const created = await request("POST", "/api/projects/new", {
    path: projectFile,
    title: "Packaged Project",
    author: "Folio QA",
  });
  if (created.source !== "folio" || path.resolve(created.projectFile) !== path.resolve(projectFile)) {
    throw new Error(`Packaged new-book API did not create a .folio project: ${JSON.stringify(created)}`);
  }
  const chapter = created.sections.find((section) => section.kind === "chapter");
  if (!chapter) throw new Error("Packaged .folio project has no starter chapter.");

  const marker = "# Chapter One\n\nPACKAGED PROJECT ROUNDTRIP\n\nSaved inside one .folio file.\n";
  await request("PUT", `/api/projects/${created.projectId}/sections/${encodeURIComponent(chapter.id)}`, { markdown: marker });
  await request("POST", `/api/projects/${created.projectId}/flush`, {});
  const fileStat = await fs.stat(projectFile);
  if (!fileStat.isFile() || fileStat.size < 1000) throw new Error("Packaged project did not persist as one substantive .folio file.");

  await request("POST", `/api/projects/${created.projectId}/close`, {});
  const reopened = await request("POST", "/api/projects/open-file", { path: projectFile });
  const reopenedChapter = reopened.sections.find((section) => section.kind === "chapter");
  const document = await request("GET", `/api/projects/${reopened.projectId}/sections/${encodeURIComponent(reopenedChapter.id)}`);
  if (!document.markdown.includes("PACKAGED PROJECT ROUNDTRIP")) {
    throw new Error("Packaged .folio manuscript did not survive close and reopen.");
  }

  const exported = await request("POST", `/api/projects/${reopened.projectId}/export`, {
    format: "md",
    meta: reopened.meta,
    theme: reopened.meta.theme,
    outputDir: exportDir,
  });
  if (!exported.written || !path.resolve(exported.path).startsWith(path.resolve(exportDir))) {
    throw new Error(`Packaged export ignored the configured output directory: ${JSON.stringify(exported)}`);
  }
  const exportStat = await fs.stat(exported.path);
  if (exportStat.size < 50) throw new Error("Packaged configured export is unexpectedly empty.");
  await request("POST", `/api/projects/${reopened.projectId}/close`, {});

  const second = await request("POST", "/api/projects/new", {
    path: secondProjectFile,
    title: "Second Instance",
    author: "Folio QA",
  });
  const secondChapter = second.sections.find((section) => section.kind === "chapter");
  await request("PUT", `/api/projects/${second.projectId}/sections/${encodeURIComponent(secondChapter.id)}`, {
    markdown: "# Second Instance\n\nSECOND INSTANCE PROJECT MARKER\n",
  });
  await request("POST", `/api/projects/${second.projectId}/flush`, {});
  await request("POST", `/api/projects/${second.projectId}/close`, {});

  const exe = process.env.FOLIO_SMOKE_EXE;
  if (!exe) throw new Error("FOLIO_SMOKE_EXE is required for second-instance QA.");
  const child = spawn(exe, [secondProjectFile], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();

  await page.waitForFunction(
    (expected) => new URL(window.location.href).searchParams.get("book") === expected
      && (document.querySelector(".rich-editor")?.dataset.markdown || "").includes("SECOND INSTANCE PROJECT MARKER"),
    { timeout: 20000 },
    secondProjectFile,
  );

  const result = { projectFile, secondProjectFile, exportDir };
  await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  if (process.env.FOLIO_SMOKE_RESULT) {
    await fs.writeFile(process.env.FOLIO_SMOKE_RESULT, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result));
  console.log("Packaged Folio .folio roundtrip, configured export, and second-instance open passed.");
} finally {
  browser.disconnect();
}
