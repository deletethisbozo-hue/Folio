import assert from "node:assert/strict";
import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";
import { conservativeHyphenation, hyphenationLanguage } from "../web/src/hyphenation.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

function breakpoints(value: string): number[] {
  const points: number[] = [];
  let letters = 0;
  for (const char of value) {
    if (char === "\u00ad") points.push(letters);
    else letters++;
  }
  return points;
}

function validThreeThree(value: string): boolean {
  const plainLength = value.replace(/\u00ad/g, "").length;
  const points = breakpoints(value);
  return points.length > 0 && points.every((point) => point >= 3 && plainLength - point >= 3);
}

const pl = new Hypher(polish);
const en = new Hypher(english);

test("Polish locale variants select only the Polish dictionary", () => {
  assert.equal(hyphenationLanguage("pl"), "pl");
  assert.equal(hyphenationLanguage("pl-PL"), "pl");
  assert.equal(hyphenationLanguage("en-GB"), "en");
});

test("seven-to-nine-letter Polish words can provide conservative breakpoints", () => {
  const candidates = ["czytanie", "pisanie", "rozdział", "książkami", "wydanie"];
  const hyphenated = candidates.map((word) => conservativeHyphenation(pl, word));
  assert.ok(hyphenated.some((word) => validThreeThree(word)), hyphenated.join(" | "));
  assert.ok(hyphenated.every((word) => word === word.replace(/\u00ad/g, "") || validThreeThree(word)));
});

test("seven-to-nine-letter English words can provide conservative breakpoints", () => {
  const candidates = ["reading", "writing", "chapter", "printer", "spacing"];
  const hyphenated = candidates.map((word) => conservativeHyphenation(en, word));
  assert.ok(hyphenated.some((word) => validThreeThree(word)), hyphenated.join(" | "));
  assert.ok(hyphenated.every((word) => word === word.replace(/\u00ad/g, "") || validThreeThree(word)));
});

test("short words are never hyphenated", () => {
  for (const word of ["book", "tekst", "autor", "write"]) {
    assert.equal(conservativeHyphenation(en, word), word);
    assert.equal(conservativeHyphenation(pl, word), word);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
