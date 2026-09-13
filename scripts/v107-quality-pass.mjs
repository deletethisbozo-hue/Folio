import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let text = await readFile(path, "utf8");
  for (const [from, to, label] of replacements) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${path}: ${label} expected once, found ${count}`);
    text = text.replace(from, to);
  }
  await writeFile(path, text, "utf8");
}

await patch("web/src/compositor.ts", [
  ["  const maxWordSpacing = fontSize * 0.075;", "  const maxWordSpacing = fontSize * (emergency || finalCompression ? 0.12 : 0.099);", "legal word-spacing headroom"],
  ["  const normalizedLanguage = language.toLowerCase();\n  const relaxedCompressionEm = 0.120;", "  const relaxedCompressionEm = 0.120;", "remove obsolete language-specific strict width"],
  ["  const strictCompressionEm = normalizedLanguage.startsWith(\"pl\") ? 0.099 : 0.06;", "  const strictCompressionEm = 0.099;", "use full strict compression window in every language"],
  ["    if (Math.abs(residualPx) > 1.705) continue;", "    if (Math.abs(residualPx) > 1.45) continue;", "tighten right-edge residual"],
  ["      + 80 * Math.pow(Math.abs(residualPx) / 1.7, 2);", "      + 100 * Math.pow(Math.abs(residualPx) / 1.45, 2);", "penalize right-edge residual"],
  ["          if (lineFit && !relaxedFit && !previous.relaxed && (previous.justified || previous.finalCompressed)\n            && Math.abs(lineFit.wordSpacing - previous.wordSpacing) / Math.max(1, fontSize) > 0.1600001) continue;", "          if (lineFit && (previous.justified || previous.finalCompressed)\n            && Math.abs(lineFit.wordSpacing - previous.wordSpacing) / Math.max(1, fontSize) > 0.158) continue;", "enforce spacing continuity across relaxed lines"],
  ["            ? 1800 + (previous.hyphenated ? 1200 : 0) + 600 * Math.pow(1 - fill, 2)", "            ? 24000 + (previous.hyphenated ? 12000 : 0) + 1800 * Math.pow(1 - fill, 2)", "strongly avoid one-word final lines"],
  [".scene-break{display:block!important;text-align:center!important;text-align-last:center!important;word-spacing:normal!important;letter-spacing:normal!important}", ".scene-break{display:block!important;text-align:center!important;text-align-last:center!important;margin-left:auto!important;margin-right:auto!important;word-spacing:normal!important;letter-spacing:normal!important}", "center ornamental break boxes"],
]);

for (const path of ["themes/classic/theme.css", "themes/cloister/theme.css"]) {
  await patch(path, [[
    "  color: #78151c;\n  font-variant: small-caps;\n  letter-spacing: .02em;",
    "  color: #78151c;",
    "remove first-line geometry mutation from Black Psalter",
  ]]).catch(async (error) => {
    if (!path.includes("cloister")) throw error;
    await patch(path, [[
      "  color: #81362c;\n  font-variant: small-caps;\n  letter-spacing: .02em;",
      "  color: #81362c;",
      "remove first-line geometry mutation from Chronicle",
    ]]);
  });
}

await patch("tests/ingestion.test.ts", [[
  "check(\"kdp embeds NO font files\", out.kdp.fonts.length === 0);\ncheck(\"kdp emits NO @font-face rules (no dangling src)\", out.kdp.faces === 0);\ncheck(\"universal still embeds its font\", out.universal.fonts.length === 1);\ncheck(\"universal still emits its @font-face\", out.universal.faces === 1);",
  "check(\"kdp preserves the selected theme fonts\", out.kdp.fonts.length > 0, out.kdp.fonts.join(\", \"));\ncheck(\"kdp emits matching theme @font-face rules\", out.kdp.faces >= out.kdp.fonts.length, String(out.kdp.faces));\ncheck(\"universal adds the custom manuscript font on top of theme fonts\", out.universal.fonts.length === out.kdp.fonts.length + 1, `${out.kdp.fonts.length} -> ${out.universal.fonts.length}`);\ncheck(\"universal emits the additional custom @font-face\", out.universal.faces > out.kdp.faces, `${out.kdp.faces} -> ${out.universal.faces}`);",
  "update EPUB preset expectations",
]]);

await patch("tests/acceptance.test.ts", [
  ["const uniDiffs = [...newUni.entries()].filter(\n  ([n, s]) => !n.endsWith(\".opf\") && !INTENDED.has(n) && refUni.get(n) !== s,\n);", "const addedThemeFonts = [...newUni.keys()].filter((n) => /\\.(ttf|otf|woff2?)$/i.test(n) && !refUni.has(n));\nconst uniDiffs = [...newUni.entries()].filter(\n  ([n, s]) => !n.endsWith(\".opf\") && !INTENDED.has(n) && !addedThemeFonts.includes(n) && refUni.get(n) !== s,\n);", "allow intentional bundled theme-font additions"],
  ["  uniDiffs.length === 0 && newUni.size === refUni.size,", "  uniDiffs.length === 0 && newUni.size === refUni.size + addedThemeFonts.length,", "account for new bundled theme-font entries"],
  ["  \"epub (kdp) embeds no fonts and is smaller than universal — the preset fix\",\n  ![...newKdp.keys()].some((n) => /\\.(ttf|otf|woff2?)$/i.test(n)) && kdp.bytes < uni.bytes,\n  `${kdp.bytes} < ${uni.bytes}`,", "  \"epub (kdp) keeps theme fonts, omits custom fonts, and is smaller than universal\",\n  (() => {\n    const kdpFonts = [...newKdp.keys()].filter((n) => /\\.(ttf|otf|woff2?)$/i.test(n));\n    const universalFonts = [...newUni.keys()].filter((n) => /\\.(ttf|otf|woff2?)$/i.test(n));\n    return kdpFonts.length > 0 && kdpFonts.every((n) => universalFonts.includes(n)) && universalFonts.length > kdpFonts.length && kdp.bytes < uni.bytes;\n  })(),\n  `${kdp.bytes} < ${uni.bytes}`,", "update KDP preset acceptance"],
]);

await patch("tests/folio-runtime.test.ts", [[
  "check(\"preview contains selected theme CSS\", preview.body.html.includes(\"Old English Text MT\"));",
  "check(\"preview contains selected theme CSS\", preview.body.html.includes(\"Folio Grenze Gotisch\"));",
  "expect bundled Blackletter face",
]]);

await patch("tests/ui-runtime.test.ts", [[
  "return Boolean(h1 && getComputedStyle(h1).fontFamily.includes(\"Old English\"));",
  "return Boolean(h1 && getComputedStyle(h1).fontFamily.includes(\"Folio Grenze Gotisch\"));",
  "wait for bundled Blackletter face",
]]);

await patch("server/pipeline/render-blues.ts", [[
`  // Tag every chapter's content BEFORE pagination so the attribute survives onto
  // each fragment when Paged.js splits a chapter across pages.
  await page.evaluate(() => {
    document.querySelectorAll("section.chapter").forEach((sec, i) => {
      sec.setAttribute("data-ch", String(i + 1));
      sec.querySelectorAll("*").forEach((el) => el.setAttribute("data-ch", String(i + 1)));
    });
    // No hyperlinks of any kind: unwrap anchors, keeping their text.
    document.querySelectorAll("a").forEach((a) => {
      a.replaceWith(...Array.from(a.childNodes));
    });
  });

  await page.evaluate(() => {
    window.PagedConfig = { auto: false };
  });
  await page.addScriptTag({ path: POLYFILL });
  await page.evaluate(async () => {
    await window.PagedPolyfill!.preview();
  });
  await new Promise((r) => setTimeout(r, 200));`,
`  const sourceHtml = await page.content();
  let paged = false;
  let lastPagedError: unknown = null;
  for (let attempt = 0; attempt < 3 && !paged; attempt++) {
    if (attempt > 0) await page.setContent(sourceHtml, { waitUntil: "load" });
    // Tag every chapter's content BEFORE pagination so the attribute survives onto
    // each fragment when Paged.js splits a chapter across pages.
    await page.evaluate(() => {
      document.querySelectorAll("section.chapter").forEach((sec, i) => {
        sec.setAttribute("data-ch", String(i + 1));
        sec.querySelectorAll("*").forEach((el) => el.setAttribute("data-ch", String(i + 1)));
      });
      document.querySelectorAll("a").forEach((a) => {
        a.replaceWith(...Array.from(a.childNodes));
      });
      window.PagedConfig = { auto: false };
    });
    await page.addScriptTag({ path: POLYFILL });
    try {
      await page.evaluate(async () => {
        await window.PagedPolyfill!.preview();
      });
      paged = true;
    } catch (error) {
      lastPagedError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("item doesn't belong to list") || attempt === 2) throw error;
    }
  }
  if (!paged) throw lastPagedError instanceof Error ? lastPagedError : new Error(String(lastPagedError));
  await new Promise((r) => setTimeout(r, 200));`,
  "retry exact intermittent Paged.js linked-list failure on a fresh DOM",
]]);

console.log("Applied Folio v1.0.7 quality pass");
