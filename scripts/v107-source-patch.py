from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected patch marker missing in {path}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


qa_decl_old = """      let ornamentalBreaksOffCenter = 0;
"""
qa_decl_new = """      const lineDetails: Array<{
        paragraphIndex: number;
        lineIndex: number;
        text: string;
        contentWidthPx: number;
        availableWidthPx: number;
        fill: number;
        justified: boolean;
        emergency: boolean;
        wordSpacingEm: number;
        trackingEm: number;
        gaps: number;
      }> = [];
      let ornamentalBreaksOffCenter = 0;
"""

qa_line_old = """        for (const line of lines) {
          const fontSize = Number.parseFloat(getComputedStyle(line).fontSize) || 16;
          const justified = line.classList.contains(\"folio-line-justified\");
"""
qa_line_new = """        for (const line of lines) {
          const fontSize = Number.parseFloat(getComputedStyle(line).fontSize) || 16;
          const justified = line.classList.contains(\"folio-line-justified\");
          const diagnosticRange = doc.createRange();
          diagnosticRange.selectNodeContents(line);
          const diagnosticWords = [...line.querySelectorAll<HTMLElement>(\".folio-word\")];
          const contentWidthPx = diagnosticRange.getBoundingClientRect().width;
          const availableWidthPx = line.getBoundingClientRect().width;
          lineDetails.push({
            paragraphIndex: paragraphs.indexOf(paragraph),
            lineIndex: lines.indexOf(line),
            text: (line.textContent ?? \"\").replace(/\\u00ad/g, \"\"),
            contentWidthPx,
            availableWidthPx,
            fill: contentWidthPx / Math.max(1, availableWidthPx),
            justified,
            emergency: line.dataset.folioEmergency === \"true\",
            wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
            trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            gaps: diagnosticWords.slice(1).filter((word) => word.dataset.folioSpaceBefore === \"true\").length,
          });
"""

qa_return_old = """        emergencyLines,
        emergencyDetails,
        ornamentalBreaksOffCenter,
"""
qa_return_new = """        emergencyLines,
        emergencyDetails,
        lineDetails,
        ornamentalBreaksOffCenter,
"""

patch("scripts/v107-visual-qa.ts", qa_decl_old, qa_decl_new)
patch("scripts/v107-visual-qa.ts", qa_line_old, qa_line_new)
patch("scripts/v107-visual-qa.ts", qa_return_old, qa_return_new)
print("Expanded v1.0.7 line diagnostics")
