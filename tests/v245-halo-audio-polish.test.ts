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
  "Halo drag clamp uses viewport coordinates and reserves the bottom status bar",
  haloSource.includes('document.querySelector<HTMLElement>(".folio-statusbar")') &&
  !haloSource.includes("haloCoordinateOrigin") &&
  haloSource.includes("statusTop - size - margin") &&
  haloSource.includes("startY: bounds.top") &&
  haloSource.includes("startX: bounds.left"),
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
  "Writing Studio/Halo stability layer loads last",
  mainSource.indexOf('import "./v246-writing-studio-halo-stability.css"') > mainSource.indexOf('import "./v245-halo-audio-polish.css"'),
);

check(
  "Halo is rendered at shell level instead of inside editor-pane",
  appSource.indexOf("<WritingProgressHalo") > appSource.indexOf("<WritingSplitPane") &&
  appSource.indexOf("<WritingProgressHalo") < appSource.indexOf("<WriteStudioDrawer"),
);

check(
  "Typewriter Sound loads real local sample banks instead of synthesizing ordinary keys",
  audioSource.includes('"/audio/typewriter/classic-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/soft-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/mechanical-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/space-keys.mp3"') &&
  audioSource.includes('"/audio/typewriter/carriage-return.mp3"') &&
  !audioSource.includes('SAMPLE_ASSETS.backspace') &&
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
  "Space stays dedicated while Backspace avoids the harsh 2.8.4 ratchet bank",
  audioSource.includes("bank.space") &&
  audioSource.includes("BACKSPACE_PROFILES") &&
  audioSource.includes("bank[backspace.bank]") &&
  audioSource.includes('kind === "erase"') &&
  !audioSource.includes("bank.backspace"),
);

check(
  "2.8.4 letter banks use six isolated variants and never route character keys through the space bank",
  audioSource.includes("LETTER_VARIANTS = 6") &&
  audioSource.includes("nextVariant(key, LETTER_VARIANTS)") &&
  audioSource.includes("bank[profile.bank]") &&
  audioSource.includes('if (kind === "space")') &&
  !audioSource.includes("nextVariant(key),"),
);

const spaceProfiles = audioSource.slice(
  audioSource.indexOf("const SPACE_PROFILES"),
  audioSource.indexOf("let audioContext"),
);
check(
  "spacebar remains short, bright and separately routed in 2.8.5",
  audioSource.includes("SPACE_SLOT_SECONDS = 0.08") &&
  audioSource.includes("SPACE_CLIP_SECONDS = 0.032") &&
  spaceProfiles.includes("highpass: 480") &&
  spaceProfiles.includes("highpass: 440") &&
  spaceProfiles.includes("highpass: 520") &&
  audioSource.includes("filter.frequency.setValueAtTime(kind === \"space\" ? 2100 : 2400"),
);

check(
  "three presets remain audibly distinct while 100% output is substantially louder",
  audioSource.includes('classic: { bank: "classic", gain: 1.02, rate: 1.00, highpass: 180, lowpass: 7600 }') &&
  audioSource.includes('soft: { bank: "soft", gain: 0.98, rate: 0.90, highpass: 140, lowpass: 4100 }') &&
  audioSource.includes('mechanical: { bank: "mechanical", gain: 1.00, rate: 1.08, highpass: 420, lowpass: 11000 }') &&
  audioSource.includes("amplitude * 1.65") &&
  audioSource.includes("Math.pow(normalizedVolume, 1.08)"),
);

check(
  "sound Preview covers typing, Space, Backspace and Enter",
  audioSource.includes("playTypewriterPreview") &&
  audioSource.includes('["F", "o", "l", "i", "o", " ", "Backspace", "Enter"]') &&
  appSource.includes("playTypewriterPreview(props.typewriterSoundStyle, props.typewriterSoundVolume)") &&
  appSource.includes("preloadTypewriterSounds()"),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
