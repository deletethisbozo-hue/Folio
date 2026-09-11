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


web_old = """  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
    : Math.min(spaceWidth * 0.38, fontSize * 0.115);
  const minWordSpacing = emergency
    ? -Math.min(spaceWidth * 0.18, fontSize * 0.045)
    : -Math.min(spaceWidth * 0.14, fontSize * 0.035);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
  const minTracking = -fontSize * (emergency ? 0.0045 : 0.0035);
"""
web_new = """  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
    : Math.min(spaceWidth * 0.50, fontSize * 0.115);
  const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
  const minTracking = -fontSize * 0.0045;
"""

server_old = """      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.38, fontSize * 0.115);
      const minWordSpacing = emergency
        ? -Math.min(spaceWidth * 0.18, fontSize * 0.045)
        : -Math.min(spaceWidth * 0.14, fontSize * 0.035);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * (emergency ? 0.0045 : 0.0035);
"""
server_new = """      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * 0.0045;
"""

qa_type_old = """      const emergencyDetails: Array<{ text: string; wordSpacingEm: number; trackingEm: number }> = [];
"""
qa_type_new = """      const emergencyDetails: Array<{
        text: string;
        previousText: string | null;
        nextText: string | null;
        naturalWidthPx: number;
        availableWidthPx: number;
        fill: number;
        gaps: number;
        characters: number;
        wordSpacingEm: number;
        trackingEm: number;
      }> = [];
"""

qa_push_old = """          if (line.dataset.folioEmergency === \"true\") {
            emergencyLines++;
            emergencyDetails.push({
              text: line.textContent?.replace(/\\u00ad/g, \"\") ?? \"\",
              wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
              trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            });
          }
"""
qa_push_new = """          if (line.dataset.folioEmergency === \"true\") {
            emergencyLines++;
            const range = doc.createRange();
            range.selectNodeContents(line);
            const words = [...line.querySelectorAll<HTMLElement>(\".folio-word\")];
            const gaps = words.slice(1).filter((word) => word.dataset.folioSpaceBefore === \"true\").length;
            const lineIndex = lines.indexOf(line);
            const clean = (value: string | null | undefined) => value?.replace(/\\u00ad/g, \"\") ?? null;
            const naturalWidthPx = range.getBoundingClientRect().width;
            const availableWidthPx = line.getBoundingClientRect().width;
            emergencyDetails.push({
              text: clean(line.textContent) ?? \"\",
              previousText: clean(lines[lineIndex - 1]?.textContent),
              nextText: clean(lines[lineIndex + 1]?.textContent),
              naturalWidthPx,
              availableWidthPx,
              fill: naturalWidthPx / Math.max(1, availableWidthPx),
              gaps,
              characters: words.reduce((sum, word) => sum + (word.textContent ?? \"\").replace(/\\u00ad/g, \"\").length, 0),
              wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
              trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            });
          }
"""

qa_browser_safe = """          if (line.dataset.folioEmergency === \"true\") {
            emergencyLines++;
            const range = doc.createRange();
            range.selectNodeContents(line);
            const words = [...line.querySelectorAll<HTMLElement>(\".folio-word\")];
            const gaps = words.slice(1).filter((word) => word.dataset.folioSpaceBefore === \"true\").length;
            const lineIndex = lines.indexOf(line);
            const naturalWidthPx = range.getBoundingClientRect().width;
            const availableWidthPx = line.getBoundingClientRect().width;
            emergencyDetails.push({
              text: (line.textContent ?? \"\").replace(/\\u00ad/g, \"\"),
              previousText: lines[lineIndex - 1]?.textContent?.replace(/\\u00ad/g, \"\") ?? null,
              nextText: lines[lineIndex + 1]?.textContent?.replace(/\\u00ad/g, \"\") ?? null,
              naturalWidthPx,
              availableWidthPx,
              fill: naturalWidthPx / Math.max(1, availableWidthPx),
              gaps,
              characters: words.reduce((sum, word) => sum + (word.textContent ?? \"\").replace(/\\u00ad/g, \"\").length, 0),
              wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
              trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            });
          }
"""

patch("web/src/compositor.ts", web_old, web_new)
patch("server/pipeline/compositor.ts", server_old, server_new)
patch("scripts/v107-visual-qa.ts", qa_type_old, qa_type_new)
patch("scripts/v107-visual-qa.ts", qa_push_old, qa_push_new)
patch("scripts/v107-visual-qa.ts", qa_push_new, qa_browser_safe)
print("Applied v1.0.7 compositor and browser-safe QA diagnostics patch")
