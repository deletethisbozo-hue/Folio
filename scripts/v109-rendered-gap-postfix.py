from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "web/src/compositor.ts"
text = path.read_text(encoding="utf-8")

old_floor = '''  const relaxedCompressionEm = 0.120;
  const strictCompressionEm = 0.099;
  const minimumRenderedGapEm = emergency || finalCompression ? 0.13 : 0.14;
  const gapFloorWordSpacing = fontSize * minimumRenderedGapEm - spaceWidth;
  const minWordSpacing = Math.max(
    -(fontSize * (emergency || finalCompression ? relaxedCompressionEm : strictCompressionEm)),
    gapFloorWordSpacing,
  );'''
new_floor = '''  const relaxedCompressionEm = 0.120;
  const strictCompressionEm = 0.099;
  // Keep the proven 1.0.8 line-breaking range. A model-space clamp here can
  // reject otherwise excellent paragraph breaks because Chromium's final font
  // metrics and the cloned line box do not exactly match the token probes.
  // The real rendered gap is enforced after the line exists in the DOM.
  const minWordSpacing = -(fontSize * (emergency || finalCompression ? relaxedCompressionEm : strictCompressionEm));'''
if text.count(old_floor) != 1:
    raise SystemExit(f"expected one model-space gap floor block, found {text.count(old_floor)}")
text = text.replace(old_floor, new_floor)

old_correction = '''    const rendered = content.getBoundingClientRect().width;
    const measure = line.getBoundingClientRect().width;
    const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);
    const opticalMeasure = measure + protrusion;
    const currentScale = Number(line.dataset.folioGlyphScale ?? 1);
    if (rendered <= 0 || opticalMeasure <= 0 || !Number.isFinite(currentScale)) {
      previousCorrectedScale = null;
      continue;
    }
    let correctedScale = Math.max(0.99, Math.min(1.01, currentScale * opticalMeasure / rendered));
    if (previousCorrectedScale !== null) {
      correctedScale = Math.max(
        previousCorrectedScale - maxAdjacentScaleDelta,
        Math.min(previousCorrectedScale + maxAdjacentScaleDelta, correctedScale),
      );
      correctedScale = Math.max(0.99, Math.min(1.01, correctedScale));
    }
    content.style.transform = Math.abs(correctedScale - 1) > 0.00001
      ? "scaleX(" + correctedScale + ")"
      : "";
    line.dataset.folioGlyphScale = String(correctedScale);
    previousCorrectedScale = correctedScale;'''
new_correction = '''    let rendered = content.getBoundingClientRect().width;
    const measure = line.getBoundingClientRect().width;
    const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);
    const opticalMeasure = measure + protrusion;
    let currentScale = Number(line.dataset.folioGlyphScale ?? 1);
    if (rendered <= 0 || opticalMeasure <= 0 || !Number.isFinite(currentScale)) {
      previousCorrectedScale = null;
      continue;
    }

    // Measure what the reader actually sees, not the model-space estimate used
    // by the dynamic-programming pass. If Chromium renders a semantic word gap
    // below the professional floor, restore that physical whitespace first.
    // Recover the line measure with tiny tracking changes before asking glyph
    // scaling to do any extra work. This avoids both run-together words and the
    // visibly distorted 3% emergency compression that a naive post-pass needs.
    const lineFontSize = pixels(getComputedStyle(line).fontSize) || fontSize;
    const releaseGapFloor = Math.max(1.5, lineFontSize * 0.12);
    const correctionGapTarget = releaseGapFloor + 0.04;
    const semanticGapMinimum = () => {
      const lineWords = [...line.querySelectorAll<HTMLElement>(".folio-word")];
      let minimum = Number.POSITIVE_INFINITY;
      for (let index = 1; index < lineWords.length; index++) {
        if (lineWords[index].dataset.folioSpaceBefore !== "true") continue;
        minimum = Math.min(
          minimum,
          lineWords[index].getBoundingClientRect().left - lineWords[index - 1].getBoundingClientRect().right,
        );
      }
      return minimum;
    };

    let correctedWordSpacing = Number(line.dataset.folioWordSpacing ?? 0);
    let correctedTracking = Number(line.dataset.folioTracking ?? 0);
    let correctedScale = currentScale;
    const minimumTracking = -lineFontSize * 0.0055;
    const trackingOps = Math.max(1, (content.textContent ?? "").replace(/\\u00ad/g, "").length - 1);
    for (let pass = 0; pass < 5; pass++) {
      const minimumGap = semanticGapMinimum();
      if (Number.isFinite(minimumGap) && minimumGap < correctionGapTarget) {
        const safeScale = Math.max(0.98, Math.abs(correctedScale) > 0.0001 ? correctedScale : 1);
        correctedWordSpacing += (correctionGapTarget - minimumGap) / safeScale;
        line.style.wordSpacing = `${baseWordSpacing + correctedWordSpacing}px`;
        line.dataset.folioWordSpacing = String(correctedWordSpacing);
      }

      rendered = content.getBoundingClientRect().width;
      if (rendered <= 0) break;
      const overfill = rendered - opticalMeasure;
      if (overfill > 0.05 && correctedTracking > minimumTracking + 0.000001) {
        const safeScale = Math.max(0.98, Math.abs(correctedScale) > 0.0001 ? correctedScale : 1);
        correctedTracking = Math.max(
          minimumTracking,
          correctedTracking - overfill / (trackingOps * safeScale),
        );
        line.style.letterSpacing = `${baseTracking + correctedTracking}px`;
        line.dataset.folioTracking = String(correctedTracking);
      }

      rendered = content.getBoundingClientRect().width;
      if (rendered <= 0) break;
      correctedScale = Math.max(0.98, Math.min(1.01, correctedScale * opticalMeasure / rendered));
      if (previousCorrectedScale !== null) {
        correctedScale = Math.max(
          previousCorrectedScale - maxAdjacentScaleDelta,
          Math.min(previousCorrectedScale + maxAdjacentScaleDelta, correctedScale),
        );
        correctedScale = Math.max(0.98, Math.min(1.01, correctedScale));
      }
      content.style.transform = Math.abs(correctedScale - 1) > 0.00001
        ? "scaleX(" + correctedScale + ")"
        : "";
      line.dataset.folioGlyphScale = String(correctedScale);
      currentScale = correctedScale;
    }

    const finalMinimumGap = semanticGapMinimum();
    if (Number.isFinite(finalMinimumGap)) {
      line.dataset.folioMinSemanticGap = String(finalMinimumGap);
      if (finalMinimumGap < releaseGapFloor) line.dataset.folioGapViolation = "true";
    }
    previousCorrectedScale = correctedScale;'''
if text.count(old_correction) != 1:
    raise SystemExit(f"expected one optical correction block, found {text.count(old_correction)}")
text = text.replace(old_correction, new_correction)
path.write_text(text, encoding="utf-8")
print("Applied DOM-measured semantic-gap correction with tracking compensation.")
