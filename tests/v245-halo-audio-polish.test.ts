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
  "Halo shows Book / Chapter / Today as three concentric progress rings",
  haloSource.includes("bookCircumference") &&
  haloSource.includes("chapterCircumference") &&
  haloSource.includes("todayCircumference") &&
  haloSource.includes("progress-halo-ring-book") &&
  haloSource.includes("progress-halo-ring-chapter") &&
  haloSource.includes("progress-halo-ring-today") &&
  haloSource.includes('r="47"') &&
  haloSource.includes('r="40"') &&
  haloSource.includes('r="34"'),
);

check(
  "Halo uses the original whole-orb click/drag interaction instead of ring-segment buttons",
  haloSource.includes('className="progress-halo-orb"') &&
  haloSource.includes("onPointerMove={dragHalo}") &&
  !haloSource.includes("progress-halo-segment-hit") &&
  !haloSource.includes("choose(segment.scope)"),
);

check(
  "decorative notch stays removed",
  !haloSource.includes("progress-halo-notch") &&
  !haloSource.includes('d="M84 94 L94 84"'),
);

check(
  "Halo drag clamp reserves space above the bottom status bar",
  haloSource.includes('document.querySelector<HTMLElement>(".folio-statusbar")') &&
  haloSource.includes("haloCoordinateOrigin") &&
  haloSource.includes("bounds.top - element.offsetTop") &&
  haloSource.includes("statusTop - size - margin - origin.y") &&
  haloSource.includes("startY: halo.offsetTop"),
);

check(
  "all three rings have distinct Light and Midnight styling",
  css.includes(".progress-halo-ring-book") &&
  css.includes(".progress-halo-ring-chapter") &&
  css.includes(".progress-halo-ring-today") &&
  css.includes("#7569ee") &&
  css.includes("#718ee9") &&
  css.includes("#5bb9d8"),
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
