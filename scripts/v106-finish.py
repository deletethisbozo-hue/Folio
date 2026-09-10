from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if old not in value:
        raise RuntimeError(f"expected marker not found in {path}: {old[:120]!r}")
    write(path, value.replace(old, new, 1))


# Keep npm lock metadata aligned without touching dependency versions.
lock_path = ROOT / "package-lock.json"
lock = json.loads(lock_path.read_text(encoding="utf-8"))
lock["version"] = "1.0.6"
lock["packages"][""]["version"] = "1.0.6"
lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Make the visible language reflect the new information architecture. Every
# label below still points at an existing working action; this is not decorative
# menu theatre.
replacements = [
    ("<button onClick={() => setShowBookDetails(true)}>Document</button>", "<button onClick={() => setShowBookDetails(true)}>Book</button>"),
    ("<button onClick={() => setShowContent(true)}>Insert</button>", "<button onClick={() => setShowContent(true)}>Add</button>"),
    ("<button onClick={() => setShowStyle(true)}>Format</button>", "<button onClick={() => setShowStyle(true)}>Design</button>"),
    ("<button onClick={() => setUiTone((tone) => tone === \"ivory\" ? \"midnight\" : \"ivory\")}>View</button>", "<button onClick={() => setUiTone((tone) => tone === \"ivory\" ? \"midnight\" : \"ivory\")}>Appearance</button>"),
    ("<button onClick={() => setShowGenerate(true)}>Share</button>", "<button onClick={() => setShowGenerate(true)}>Export</button>"),
    ('<span className="pane-label">Folio</span>', '<span className="pane-label">Manuscript</span>'),
    ('<button className="icon-button infinity" title="Book styles" onClick={() => setShowStyle(true)}>∞</button>', '<button className="icon-button infinity" title="Book design" onClick={() => setShowStyle(true)}>Aa</button>'),
    ('<button className="preview-style-button" onClick={() => setShowStyle(true)}>Aa · Styles</button>', '<button className="preview-style-button" onClick={() => setShowStyle(true)}>Aa · Design</button>'),
    ('<button className="generate-button" onClick={() => setShowGenerate((v) => !v)}>Generate</button>', '<button className="generate-button" onClick={() => setShowGenerate((v) => !v)}>Export</button>'),
]
for old, new in replacements:
    replace_once("web/src/App.tsx", old, new)

# Geometry assertions measure the actual rendered line contents, not the width
# of our line container. This is what the 1.0.5 tests failed to verify.
needle = '  check("professional compositor places a hard ceiling on expanded word gaps", boundedWordGaps);\n'
insert = r'''  check("professional compositor places a hard ceiling on expanded word gaps", boundedWordGaps);
  const professionalGeometry = await page.evaluate(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    const paragraph = doc?.querySelector<HTMLElement>("section.chapter > p.folio-composed");
    if (!doc || !paragraph) return { ok: false, reason: "missing composed paragraph" };
    const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
    if (lines.length < 2) return { ok: false, reason: "too few composed lines" };
    const justified = lines.slice(0, -1).filter((line) => line.classList.contains("folio-line-justified"));
    const errors = justified.map((line) => {
      const lineRect = line.getBoundingClientRect();
      const range = doc.createRange();
      range.selectNodeContents(line);
      const contentRect = range.getBoundingClientRect();
      return Math.abs(lineRect.right - contentRect.right);
    });
    const fontSize = Number.parseFloat(getComputedStyle(paragraph).fontSize) || 16;
    const wordSpacing = justified.map((line) => Math.abs(Number(line.dataset.folioWordSpacing ?? 0)));
    const tracking = justified.map((line) => Math.abs(Number(line.dataset.folioTracking ?? 0)));
    const semanticGaps: number[] = [];
    for (const line of justified.slice(0, 12)) {
      const words = [...line.querySelectorAll<HTMLElement>(".folio-word")];
      for (let index = 1; index < words.length; index++) {
        if (words[index].dataset.folioSpaceBefore !== "true") continue;
        semanticGaps.push(words[index].getBoundingClientRect().left - words[index - 1].getBoundingClientRect().right);
      }
    }
    const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap.folio-composed-cap");
    let dropcapOk = true;
    if (cap) {
      const capRect = cap.getBoundingClientRect();
      const first = lines[0].getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      const later = lines.slice(2).map((line) => line.getBoundingClientRect()).find((rect) => Math.abs(rect.left - paragraphRect.left) < fontSize * .35);
      dropcapOk = first.left >= capRect.right - 1 && Boolean(later);
    }
    return {
      ok: justified.length > 0 &&
        Math.max(...errors, 0) <= 1.75 &&
        Math.max(...wordSpacing, 0) <= fontSize * .116 &&
        Math.max(...tracking, 0) <= fontSize * .0056 &&
        Math.max(...semanticGaps, 0) <= fontSize * .42 &&
        lines.at(-1)?.classList.contains("folio-line-natural") === true &&
        dropcapOk,
      maxRightError: Math.max(...errors, 0),
      maxWordSpacing: Math.max(...wordSpacing, 0),
      maxTracking: Math.max(...tracking, 0),
      maxSemanticGap: Math.max(...semanticGaps, 0),
      dropcapOk,
    };
  });
  check("non-final lines really reach the measure inside professional spacing limits", professionalGeometry.ok, JSON.stringify(professionalGeometry));

  const studioGeometry = await page.evaluate(() => {
    const shell = document.querySelector(".folio-shell")!.getBoundingClientRect();
    const command = document.querySelector(".folio-commandbar")!.getBoundingClientRect();
    const library = document.querySelector(".library-pane")!.getBoundingClientRect();
    const editorPane = document.querySelector(".editor-pane")!.getBoundingClientRect();
    const manuscript = document.querySelector(".manuscript-editor")!.getBoundingClientRect();
    const preview = document.querySelector(".preview-pane")!.getBoundingClientRect();
    const selected = getComputedStyle(document.querySelector(".contents-row.selected")!);
    const sidebar = getComputedStyle(document.querySelector(".library-pane")!);
    const title = getComputedStyle(document.querySelector(".section-title")!);
    return {
      ok: command.height >= 46 && library.width >= 190 && preview.width <= 350 &&
        manuscript.width < editorPane.width - 20 && manuscript.left > editorPane.left + 10 &&
        Number.parseFloat(title.fontSize) >= 18 && sidebar.backgroundImage === "none" &&
        selected.borderRadius === "0px" && shell.bottom <= innerHeight + 1,
      command: command.height,
      library: library.width,
      preview: preview.width,
      manuscript: manuscript.width,
      editor: editorPane.width,
      titleSize: title.fontSize,
      sidebarImage: sidebar.backgroundImage,
      selectedRadius: selected.borderRadius,
    };
  });
  check("1.0.6 uses the new Editorial Studio layout rather than the recoloured legacy geometry", studioGeometry.ok, JSON.stringify(studioGeometry));
'''
replace_once("tests/ui-runtime.test.ts", needle, insert)

# Ensure the language-specific suite runs near the cheap deterministic tests.
replace_once(
    "tests/run-all.ts",
    '  "save-queue.test.ts",\n  "ingestion.test.ts",',
    '  "save-queue.test.ts",\n  "typesetting-language.test.ts",\n  "ingestion.test.ts",',
)

print("Folio 1.0.6 finishing patch applied")
