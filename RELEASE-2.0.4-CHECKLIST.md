# Folio 2.0.4 release checklist

This file is the source of truth for the 2.0.4 patch scope. Do not release 2.0.4 until every product item below is present in the final branch and the Windows release pipeline is green.

## 1. Front-matter illustrations

- [ ] Image button works in editable front matter through the real user flow.
- [ ] PNG/JPEG upload inserts a visible illustration into the editor immediately.
- [ ] Uploaded illustration is copied into the book's `assets/` folder and stored as semantic manuscript Markdown.
- [ ] Illustration is visible in live Page Preview, not only in the editor.
- [ ] Preview resolves project-relative `assets/...` paths through the project asset API.
- [ ] Illustration survives autosave and a real project reload.
- [ ] Illustration can be removed from the editor and the removal persists.
- [ ] Fix front-matter selection/editor race so adding an illustration cannot target a stale section.
- [ ] Fix illustration MutationObserver feedback loop / repeated DOM mutation.
- [ ] Use a synchronous editor-to-Markdown commit path for illustration insertion and controls so preview/autosave cannot miss the new figure.
- [ ] Illustration pages are image-only: inserting an illustration clears page prose instead of mixing the image with text.
- [ ] The source filename is never shown as visible page text or a figcaption.
- [ ] No caption or filename appears in Page Preview.

## 2. Illustration editing

- [ ] Scale control from 25% to 100%.
- [ ] Crop modes: Original, 1:1, 4:3, 3:2, 2:3, 16:9.
- [ ] Horizontal crop focal point X from 0 to 100.
- [ ] Vertical crop focal point Y from 0 to 100.
- [ ] Crop and scale apply immediately in the editor.
- [ ] Crop and scale apply immediately in live Page Preview.
- [ ] Crop/scale/focal-point settings serialize into manuscript Markdown.
- [ ] Crop/scale/focal-point settings survive autosave and project reload.
- [ ] Preview strips editor-only illustration controls while retaining the image presentation.

## 3. Cover workspace and cover preview

- [ ] Replace the ugly brown/prototype-looking Replace Cover control with the cleaned-up application control style.
- [ ] Keep Add Cover / Replace Cover wording consistent.
- [ ] Cover image uses complete `contain` fit rather than cropping.
- [ ] Cover remains centered and fully visible in every preview profile.
- [ ] Cover treatment is independent of the scrolling manuscript flow so changing Kindle/device/Print profile cannot distort or crop it differently.
- [ ] Cover editor artwork and button styling match the rest of the polished application chrome.

## 4. Export UI

- [ ] Restyle the Export action so it no longer looks like an unrelated/prototype button.
- [ ] Keep Export visually consistent with the other primary application controls.
- [ ] Do not duplicate actions that already exist elsewhere in the command bar/workspace.

## 5. Folio app icon

- [ ] Use the final user-selected cream/dark-spine/red-accent Folio icon from the 2.0.4 patch discussion.
- [ ] Replace the previous app icon asset in the patch.
- [ ] Use the same icon for the Electron BrowserWindow runtime icon.
- [ ] Use the same icon for the Windows executable.
- [ ] Use the same icon for NSIS installer, uninstaller and installer header.
- [ ] Package `assets/**/*` so runtime cannot silently fall back to an older icon.
- [ ] Verify the final Windows installer/portable build actually shows the new icon rather than merely having the builder config point at it.

## 6. Application typography

- [ ] Use Pelagiad ONLY for the lowercase Folio logo/wordmark itself.
- [ ] Render the brand as lowercase `folio` everywhere it functions as the application logo/wordmark.
- [ ] Apply Pelagiad to the start-screen `folio` wordmark.
- [ ] Apply Pelagiad to the workspace/command-bar `folio` wordmark.
- [ ] Apply Pelagiad to miniature/recent-project Folio wordmarks where they represent the brand.
- [ ] Use IBM Plex Sans as the main application sans instead of the generic system/Segoe/Arial-looking stack.
- [ ] Normal UI text, controls and small labels use IBM Plex Sans where a sans face is intended.
- [ ] Existing editorial serif display headings can remain serif; do not flatten the whole interface into one sans.
- [ ] `Manuscript` and `Page Preview` use exactly the same UI font, size, weight and tracking.
- [ ] `Page Preview` must not drift into a separate display face from `Manuscript`.
- [ ] Pelagiad must not replace normal headings, bold text, buttons or pane-label typography.
- [ ] Do not alter book/theme typography with Pelagiad or IBM Plex Sans merely to match the app chrome.

## 7. Versioning and packaging

- [ ] Version is 2.0.4 in `package.json`.
- [ ] Version is 2.0.4 in `package-lock.json`.
- [ ] Start screen reports 2.0.4.
- [ ] Windows release workflow targets 2.0.4.
- [ ] Electron architecture remains unchanged.

## 8. Required qualification before release

- [x] Focused illustration editor test previously reached 6/6.
- [x] Focused illustration preview/crop test previously reached 5/5.
- [x] Full Linux suite previously reached 410/410 passing.
- [x] Production web/server build previously passed.
- [ ] Re-run focused illustration tests after image-only page behaviour and typography changes.
- [ ] Re-run full Linux qualification after final icon, Pelagiad and IBM Plex Sans integration.
- [ ] Commit the qualified product patch to the branch without temporary patch scripts.
- [ ] Run full Windows formatter/UI suite.
- [ ] Run visual/typesetting QA.
- [ ] Run complete Print PDF matrix.
- [ ] Build Windows installer and portable artifacts.
- [ ] Run packaged executable smoke tests.
- [ ] Verify EPUB/PDF/print exports.
- [ ] Verify the packaged icon on executable, installer and portable build.
- [ ] Generate SHA-256 hashes.
- [ ] Publish immutable GitHub Release 2.0.4 only after every required gate is green.

## Explicit non-goals for 2.0.4

- Do not change Electron to Tauri in this patch.
- Do not change book-theme typography just to match the application UI.
- Do not use Pelagiad for all bold UI text. Pelagiad is the lowercase `folio` brand face only.
