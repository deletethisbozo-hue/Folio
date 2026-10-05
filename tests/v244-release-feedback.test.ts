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

console.log("\nFolio 2.8 release-feedback regressions");

const [feedbackCss, findCss, haloSource, audioSource, mainSource] = await Promise.all([
  fs.readFile(path.join(ROOT, "web", "src", "v244-release-feedback.css"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "v243-find-polish.css"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "WritingProgressHalo.tsx"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "typewriter-sound.ts"), "utf8"),
  fs.readFile(path.join(ROOT, "web", "src", "main.tsx"), "utf8"),
]);

const headerZ = Number(feedbackCss.match(/section-titlebar:has\(\.word-count-picker\.open\)[\s\S]*?z-index:\s*(\d+)/)?.[1] ?? 0);
const menuZ = Number(feedbackCss.match(/\.word-count-menu\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1] ?? 0);
const toolbarZs = [...findCss.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1]));
const toolbarZ = Math.max(0, ...toolbarZs);
check(
  "word-count dropdown stacks above the floating toolbar",
  headerZ > toolbarZ && menuZ > headerZ,
  JSON.stringify({ headerZ, menuZ, toolbarZ }),
);

check(
  "release-feedback stylesheet is imported after Find polish",
  mainSource.indexOf('import "./v244-release-feedback.css"') > mainSource.indexOf('import "./v243-find-polish.css"'),
);

check(
  "Folio Halo is viewport-positioned instead of editor-positioned",
  /writing-progress-halo\s*\{[\s\S]*?position:\s*fixed\s*!important/.test(feedbackCss),
);

check(
  "Folio Halo supports persisted pointer dragging",
  haloSource.includes('folio-progress-halo-position') &&
  haloSource.includes('onPointerMove={dragHalo}') &&
  haloSource.includes('setPointerCapture(event.pointerId)') &&
  haloSource.includes('clampHaloPosition'),
);

check(
  "Halo popover flips near top and left viewport edges",
  haloSource.includes("popover-below") &&
  haloSource.includes("popover-align-left") &&
  feedbackCss.includes(".writing-progress-halo.popover-below") &&
  feedbackCss.includes(".writing-progress-halo.popover-align-left"),
);

const ordinaryPlayers = audioSource.slice(
  audioSource.indexOf("function playSampledKey"),
  audioSource.indexOf("export function shouldPlayTypewriterSound"),
);
check(
  "ordinary typewriter keys use sampled impacts rather than pitched oscillator bodies",
  ordinaryPlayers.length > 0 &&
  ordinaryPlayers.includes("playSprite(") &&
  ordinaryPlayers.includes("bank[profile.bank]") &&
  !ordinaryPlayers.includes("createOscillator("),
);

check(
  "typewriter volume keeps a zero floor while allowing the louder 2.8.5 output ceiling",
  audioSource.includes("if (normalizedVolume <= 0) return false") &&
  audioSource.includes("Math.pow(normalizedVolume, 1.08)") &&
  audioSource.includes("amplitude * 1.65") &&
  !audioSource.includes("0.18 + normalizedVolume * 1.85"),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
