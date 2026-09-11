import assert from "node:assert/strict";
import Hypher from "hypher";
import english from "hyphenation.en-us";
import polish from "hyphenation.pl";
import { conservativeHyphenation, hyphenationLanguage } from "../web/src/hyphenation.ts";
import { compositionLanguageForText } from "../web/src/compositor.ts";

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

function validMinima(value: string, left: number, right: number): boolean {
  const plainLength = value.replace(/\u00ad/g, "").length;
  const points = breakpoints(value);
  return points.length > 0 && points.every((point) => point >= left && plainLength - point >= right);
}

const pl = new Hypher(polish);
const en = new Hypher(english);

test("Polish locale variants select only the Polish dictionary", () => {
  assert.equal(hyphenationLanguage("pl"), "pl");
  assert.equal(hyphenationLanguage("pl-PL"), "pl");
  assert.equal(hyphenationLanguage("en-GB"), "en");
});

test("Polish dictionary breakpoints respect the 2/2 TeX minima", () => {
  const candidates = ["czytanie", "pisanie", "rozdział", "książkami", "wydanie"];
  const hyphenated = candidates.map((word) => conservativeHyphenation(pl, word, 2, 2, 4));
  assert.ok(hyphenated.some((word) => validMinima(word, 2, 2)), hyphenated.join(" | "));
  assert.ok(hyphenated.every((word) => word === word.replace(/\u00ad/g, "") || validMinima(word, 2, 2)));
});

test("U.S. English dictionary breakpoints respect the standard 2/3 TeX minima", () => {
  const candidates = ["ordinary", "contained", "reading", "writing", "chapter", "printer", "spacing"];
  const hyphenated = candidates.map((word) => conservativeHyphenation(en, word, 2, 3, 5));
  assert.ok(hyphenated.some((word) => validMinima(word, 2, 3)), hyphenated.join(" | "));
  assert.ok(hyphenated.every((word) => word === word.replace(/\u00ad/g, "") || validMinima(word, 2, 3)));
  assert.ok(breakpoints(conservativeHyphenation(en, "ordinary", 2, 3, 5)).includes(2));
});

test("short words are never hyphenated", () => {
  for (const word of ["book", "tekst", "autor", "write"]) {
    assert.equal(conservativeHyphenation(en, word), word);
    assert.equal(conservativeHyphenation(pl, word), word);
  }
});

test("clearly foreign paragraphs use their own supported composition language", () => {
  const english = "The letter arrived on a Tuesday, which Margaret would later decide was the most ordinary day the universe could have chosen. It came without a stamp and without a postmark.";
  const polish = "W Polsce i na świecie profesjonalne formatowanie książki jest ważne, ponieważ nie powinno tworzyć niekontrolowanych odstępów oraz błędnych podziałów słów.";
  assert.equal(compositionLanguageForText(english, "pl-PL"), "en");
  assert.equal(compositionLanguageForText(polish, "en-US"), "pl");
});

test("short, ambiguous and explicitly tagged paragraphs keep deterministic language rules", () => {
  assert.equal(compositionLanguageForText("A brief note.", "pl-PL"), "pl-PL");
  assert.equal(compositionLanguageForText("The clearly English paragraph remains deliberately tagged.", "pl-PL", "fr"), "fr");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
