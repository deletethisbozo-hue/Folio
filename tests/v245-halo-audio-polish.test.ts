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

console.log("\nFolio Halo identity + sampled typewriter regressions");

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

check(
  "Typewriter Sound loads real local sample banks instead of synthesizing ordinary keys",
  audioSource.includes('"/audio/typewriter/classic-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/soft-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/mechanical-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/space-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/backspace-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/carriage-return.mp3"') &&
  audioSource.includes("decodeAudioData") &&
  audioSource.includes("playSprite(") &&
  !audioSource.includes("IMPACT_GAIN"),
);

check(
  "Enter uses a sampled carriage return and bell partials calibrated from the supplied reference",
  audioSource.includes("playCarriageReturn(") &&
  audioSource.includes("playReferenceBell(") &&
  audioSource.includes("1787") &&
  audioSource.includes("2860") &&
  audioSource.includes("5407"),
);

check(
  "Space and Backspace use their own real mechanism sample banks",
  audioSource.includes("bank.space") &&
  audioSource.includes("bank.backspace") &&
  audioSource.includes("SPECIAL_CLIP_SECONDS") &&
  audioSource.includes('kind === "erase"'),
);

check(
  "2.8.4 letter banks use six isolated variants and never route character keys through the space bank",
  audioSource.includes("LETTER_VARIANTS = 6") &&
  audioSource.includes("nextVariant(key, LETTER_VARIANTS)") &&
  audioSource.includes("bank[profile.bank]") &&
  audioSource.includes('if (kind === "space")') &&
  !audioSource.includes("nextVariant(key),"),
);

check(
  "2.8.4 spacebar is short, bright and separately routed",
  audioSource.includes("SPACE_SLOT_SECONDS = 0.08") &&
  audioSource.includes("SPACE_CLIP_SECONDS = 0.032") &&
  audioSource.includes("highpass: 480") &&
  audioSource.includes("highpass: 440") &&
  audioSource.includes("highpass: 520") &&
  audioSource.includes("filter.frequency.setValueAtTime(kind === \"space\" ? 2100 : 2400") &&
  !audioSource.includes("highpass: 300") &&
  !audioSource.includes("highpass: 260") &&
  !audioSource.includes("highpass: 340"),
);

check(
  "sound Preview plays a real multi-key sample rather than one tiny click",
  audioSource.includes("playTypewriterPreview") &&
  audioSource.includes('["F", "o", "l", "i", "o", " ", "Enter"]') &&
  appSource.includes("playTypewriterPreview(props.typewriterSoundStyle, props.typewriterSoundVolume)") &&
  appSource.includes("preloadTypewriterSounds()"),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
