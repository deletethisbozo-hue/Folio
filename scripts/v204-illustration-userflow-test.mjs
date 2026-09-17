import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

function replaceRequired(path, from, to) {
  const source = read(path);
  if (!source.includes(from)) throw new Error(`Missing user-flow test anchor in ${path}`);
  write(path, source.replace(from, to));
}

const firstDirect = `  const input = await page.$(".illustration-input");\n  if (!input) throw new Error("Illustration file input is missing");\n  await input.uploadFile(fixture);`;
const firstUserFlow = `  const firstUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"), { timeout: 12000 });\n  const [firstChooser] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), page.click(".illustration-button")]);\n  await firstChooser.accept([fixture]);\n  const firstUpload = await firstUploadResponse;\n  if (!firstUpload.ok()) throw new Error("Illustration upload failed: " + firstUpload.status() + " " + (await firstUpload.text()));`;
replaceRequired('tests/illustration-ui.test.ts', firstDirect, firstUserFlow);
replaceRequired('tests/illustration-preview-ui.test.ts', firstDirect, firstUserFlow);

replaceRequired(
  'tests/illustration-ui.test.ts',
  `  const inputAgain = await page.$(".illustration-input");\n  if (!inputAgain) throw new Error("Illustration file input disappeared after removal");\n  await inputAgain.uploadFile(persistedFixture);`,
  `  const secondUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"), { timeout: 12000 });\n  const [secondChooser] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), page.click(".illustration-button")]);\n  await secondChooser.accept([persistedFixture]);\n  const secondUpload = await secondUploadResponse;\n  if (!secondUpload.ok()) throw new Error("Second illustration upload failed: " + secondUpload.status() + " " + (await secondUpload.text()));`,
);

console.log('Installed user-visible illustration upload flow checks.');
