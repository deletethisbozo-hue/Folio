import fs from 'node:fs';

for (const path of ['tests/illustration-ui.test.ts', 'tests/illustration-preview-ui.test.ts']) {
  let source = fs.readFileSync(path, 'utf8');
  const anchor = '  await page.waitForSelector(".editor-illustration", { timeout: 8000 });';
  const replacement = `  await page.waitForFunction(() => Boolean(document.querySelector(".editor-illustration") || document.querySelector(".global-error")), { timeout: 8000 });\n  const earlyUploadState = await page.evaluate(() => ({\n    hasFigure: Boolean(document.querySelector(".editor-illustration")),\n    error: document.querySelector(".global-error")?.textContent ?? "",\n    files: (document.querySelector(".illustration-input") as HTMLInputElement | null)?.files?.length ?? -1,\n    disabled: (document.querySelector(".illustration-input") as HTMLInputElement | null)?.disabled ?? null,\n  }));\n  if (!earlyUploadState.hasFigure) throw new Error("illustration upload state: " + JSON.stringify(earlyUploadState));`;
  if (!source.includes(anchor)) throw new Error(`Missing diagnostic anchor in ${path}`);
  source = source.replace(anchor, replacement);
  fs.writeFileSync(path, source);
}
console.log('Installed illustration upload diagnostics.');
