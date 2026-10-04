import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

console.log("\nFolio Halo identity + audible typewriter regressions");

const [haloSource, audioSource, appSource, css, mainSource] = await Promise.all([
  fs.readFile(path.join(ROOT, "web", "src", "WritingProgressHalo.tsx"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "typewriter-sound.ts"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "App.tsx"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "v245-halo-audio-polish.css"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "main.tsx"), "utf8"),
]);

check(
  "Halo is one three-segment Book / Chapter / Today orbit",
  haloSource.includes('{ scope: "book"') &&
  haloSource.includes('{ scope: "chapter"') &&
  haloSource.includes('{ scope: "today"') &&
  haloSource.includes("progress-halo-segment-track") &&
  haloSource.includes("progress-halo-segment-fill"),
);

check(
  "Halo segments directly select their progress scope",
  haloSource.includes("choose(segment.scope)") &&
  haloSource.includes('aria-pressed={active}') &&
  haloSource.includes('role="button"'),
);

check(
  "decorative notch is gone instead of pretending to be a resize affordance",
  !haloSource.includes("progress-halo-notch") &&
  !haloSource.includes('d="M84 94 L94 84"'),
);

check(
  "selected Halo segment has its own visual emphasis",
  css.includes(".progress-halo-segment.is-active") &&
  css.includes("stroke-width: 8.6"),
);

check(
  "new Halo polish loads after release-feedback fixes",
  mainSource.indexOf('import "./v245-halo-audio-polish.css"') > mainSource.indexOf('import "./v244-release-feedback.css"'),
);

const gain = Number(audioSource.match(/const IMPACT_GAIN\s*=\s*([\d.]+)/)?.[1] ?? 0);
check(
  "filtered key impacts restore enough acoustic energy to be audible",
  gain >= 4 &&
  audioSource.includes("peak * IMPACT_GAIN") &&
  audioSource.includes("Math.min(0.85"),
  `impactGain=${gain}`,
);

check(
  "sound Preview plays a real multi-key sample rather than one tiny click",
  audioSource.includes("playTypewriterPreview") &&
  audioSource.includes('["F", "o", "l", "i", "o", " ", "Enter"]') &&
  appSource.includes("playTypewriterPreview(props.typewriterSoundStyle, props.typewriterSoundVolume)"),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
