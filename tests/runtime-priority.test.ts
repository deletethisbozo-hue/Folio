import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { firstMatchingFile } = createRequire(import.meta.url)("../electron/runtime-paths.cjs");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-runtime-priority-"));
try {
  await fs.mkdir(path.join(root, "z-shell")); await fs.mkdir(path.join(root, "a-chrome"));
  await fs.writeFile(path.join(root, "z-shell", "chrome-headless-shell.exe"), "shell");
  await fs.writeFile(path.join(root, "a-chrome", "chrome.exe"), "chrome");
  assert.equal(firstMatchingFile(root, ["chrome.exe", "chrome-headless-shell.exe"]), path.join(root, "a-chrome", "chrome.exe"));
  assert.equal(firstMatchingFile(root, ["chrome-headless-shell.exe", "chrome.exe"]), path.join(root, "z-shell", "chrome-headless-shell.exe"));
  await fs.rm(path.join(root, "a-chrome"), { recursive: true });
  assert.equal(firstMatchingFile(root, ["chrome.exe", "chrome-headless-shell.exe"]), path.join(root, "z-shell", "chrome-headless-shell.exe"));
  assert.equal(firstMatchingFile(root, ["absent.exe"]), null);
  console.log("4 passed, 0 failed");
} finally { await fs.rm(root, { recursive: true, force: true }); }
