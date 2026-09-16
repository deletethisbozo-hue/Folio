# Folio 1.0.12

Folio 1.0.12 improves preview reliability and navigation.

- Print preview recovers from transient bundled-Chromium connection failures instead of reusing a disconnected Puppeteer browser.
- Transient Print preview transport failures are retried once without hiding deterministic render errors.
- Reader previews are grouped into Kindle, Kobo, phone, tablet, and print reference profiles with multiple size classes.
- Device shells are constrained by the actual preview stage so they remain inside the right pane on smaller windows and large manuscripts.
- Clicking a manuscript word follows the corresponding word in the live preview and briefly highlights it.
- Geometry-only device switches preserve the current preview position instead of allowing delayed follow-through work to fight manual scrolling.
- Visible prose is explicitly re-composed after scrolling settles, preventing a Windows timing race from leaving the current paragraph in the temporary uncomposed fallback after large-manuscript scrolling or device changes.

The release remains gated by TypeScript checks, the full formatter and UI suite, visual/typesetting QA, the Print PDF matrix, packaged Windows smoke tests, export checks, and SHA-256 hashing.
