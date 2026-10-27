# Folio 3.3 Publish Engine implementation plan

Goal: one Folio 3.3 release containing the stabilization work and the publishing engine requested by the user. No 3.2.8 release. Full Page creation and the editor takeover stay removed; retain legacy image assets and prose compatibility.

Architecture: export validation and pagination run at explicit preview/export boundaries, never on each keystroke. Keep project sources immutable during rendering, create derived export artifacts in temporary workspaces, preserve legacy project schema defaults.

Tech stack: existing React/TypeScript, Express, Pandoc, Chromium/Paged.js. Use official EPUBCheck distribution, pinned runtime dependencies and verifiable print profiles.

## Review focus
- Typing in a short/long chapter, including the middle of prose, must not rebuild the whole reader per keystroke.
- Legacy image markers must never lock a chapter, hide text or return Full Page controls.
- Missing assets, unsupported fonts and invalid exports need actionable errors; incomplete checks must not be reported as conformance.
- Physical page boxes, margins and page order must be checked in the exported PDF, not only in preview DOM.
- Every new option must have safe defaults when opening an older project.

## Tasks
- [ ] Finish PR #49 Windows/Linux regression, including typing mutation counters, legacy removal/save/reload, long-chapter editing and toolbar overlap checks at 280/360/520 px.
- [ ] Harden `server/validate/epubcheck.ts`: parse diagnostic JSON even on validation failure, handle unexpected exit/report errors honestly, include message code and file location. Test valid and deliberately invalid EPUBs with the real tool.
- [ ] Package a pinned EPUBCheck distribution with its dependencies and a Java runtime for Windows; validate offline in the packaged app. Include notices and checksums. No silent downgrade to structural-only validation.
- [ ] Add `server/validate/preflight.ts` with typed issues (code, severity, sectionId/asset, remedy). Run on demand and before export. Detect missing resources, missing metadata, empty chapters, broken internal links and invalid print dimensions without rewriting sources.
- [ ] Add a Publish Preflight panel with section navigation and errors/warnings. Verify it remains responsive on a 100k-word book and does not subscribe expensive scans to editor input.
- [ ] Preserve full-book pagination and current unsaved draft overlay. Verify chapter starts, TOC page references, running heads and total page count from exported PDF across sample and long-book fixtures.
- [ ] Extend `server/print.ts` and print UI with metric paper profiles and explicit bleed. Keep old defaults identical. Test actual page size, TrimBox/BleedBox and mirrored gutter for paperback/hardcover.
- [ ] Add facing-page preview and print-imposition output as distinct modes; test signature order (including padding blank pages), physical sheet size and binding direction.
- [ ] Add a real PDF/X conversion profile with an output ICC profile and conformance validation. Select and pin the conversion engine and required notices before packaging; never label a normal Chromium PDF as PDF/X by changing metadata alone.
- [ ] Optimize derived PDF/EPUB resources with source images/fonts unchanged. Compare file size and render output, check Unicode/Polish glyphs and embedded font requirements. Keep lossless settings as defaults.
- [ ] Split heavy optional React tools into lazy chunks with a safe loading/error boundary. Benchmark startup and ordinary editing, including a 100k-word book. Avoid loading publishing validators into the renderer process.
- [ ] Modernize GitHub Actions using current official releases pinned to commit SHAs, keep runtime versions explicit, add EPUBCheck/preflight/PDF profile checks to qualification and packaged smoke.
- [ ] Set version 3.3.0 only for the integrated release candidate, run required qualification, then publish setup/portable/SHA-256 and verify release asset digests against the manifest.

## Initial source findings
- Full-book preview already exists and must be retained.
- EPUB validation already has a structural fallback in `server/validate/epubcheck.ts`; this is not equivalent to full EPUBCheck validation.
- `server/pipeline/exec.ts` returns nonzero exit codes without throwing; validator code must inspect the result explicitly.
- Print options currently expose five inch-based trims and no bleed/profile metadata.
- Current actions use v4 and emit Node 20 deprecation warnings.
