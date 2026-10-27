import { createHash } from "node:crypto";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

const root = path.resolve("build/publishing-tools");
const target = path.join(root, "ghostscript");
await fs.mkdir(root, { recursive: true });
async function download(name, url, sha256) {
  const file = path.join(root, name);
  let buffer = await fs.readFile(file).catch(() => null);
  if (!buffer || createHash("sha256").update(buffer).digest("hex") !== sha256) {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(buffer).digest("hex") !== sha256) throw new Error(`${name}: checksum mismatch`);
    await fs.writeFile(file, buffer);
  }
  console.log(`${name}: verified ${sha256}`);
  return file;
}
async function execute(command, args, cwd, label) {
  const log = path.join(root, `${label}.log`);
  const stream = createWriteStream(log);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
    child.on("error", reject); child.on("close", resolve);
  }).finally(() => stream.end());
  if (code !== 0) throw new Error(`${label} failed (${code}): ${(await fs.readFile(log, "utf8")).slice(-5000)}`);
}
// Retain corresponding unmodified upstream source for release distribution.
const source = await download("ghostscript-10.08.0-source.tar.xz", "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/ghostscript-10.08.0.tar.xz", "c20492bc8ebb96c87fa2e52a0926e1cda8cde95d66145e018ac713fed5da38cf");
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
if (process.platform === "win32") {
  const installer = await download("gs10080w64.exe", "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/gs10080w64.exe", "52a91b8bf09298788d7a57b9206127026c23eacd75405f0a131e26dc381dce50");
  // Extract the verified distribution without installing it on the build host.
  await execute(await getPath7za(), ["x", installer, `-o${target}`, "-y"], root, "ghostscript-unpack");
  for (const entry of ["$PLUGINSDIR", "vcredist_x64.exe", "uninstgs.exe.nsis", "examples"]) await fs.rm(path.join(target, entry), { recursive: true, force: true });
} else {
  const stage = await fs.mkdtemp(path.join(root, ".gs-source-"));
  try {
    await execute("tar", ["--no-same-owner", "-xJf", source, "-C", stage, "--strip-components=1"], root, "ghostscript-source-unpack");
    await execute(path.join(stage, "configure"), ["--without-x", "--disable-cups", "--disable-gtk", "--without-tesseract"], stage, "ghostscript-configure");
    await execute("make", ["-j2"], stage, "ghostscript-build");
    await fs.mkdir(path.join(target, "bin"));
    await fs.copyFile(path.join(stage, "bin", "gs"), path.join(target, "bin", "gs"));
    await fs.chmod(path.join(target, "bin", "gs"), 0o755);
    for (const entry of ["iccprofiles", "Resource", "lib", "doc"]) await fs.cp(path.join(stage, entry), path.join(target, entry), { recursive: true });
    await fs.copyFile(path.join(stage, "LICENSE"), path.join(target, "LICENSE"));
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
const executable = path.join(target, "bin", process.platform === "win32" ? "gswin64c.exe" : "gs");
const profile = path.join(target, "iccprofiles", "default_cmyk.icc");
await fs.access(executable); await fs.access(profile);
if (process.env.GITHUB_ENV) await fs.appendFile(process.env.GITHUB_ENV, `FOLIO_GS_BIN=${executable}\nFOLIO_GS_PROFILE=${profile}\n`);
console.log("Ghostscript 10.08.0 staged with licenses and corresponding source archive.");
