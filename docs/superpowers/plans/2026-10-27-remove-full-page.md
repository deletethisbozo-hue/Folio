# Remove Full Page and repair preview controls

Goal: remove Full Page creation and its editor/preview takeover; retain legacy image assets and surrounding prose as ordinary illustrations. User will restore their manuscript themselves.

- [ ] Add regression fixtures with prose before and after legacy full-page images, check normal editor markup and export without page-break wrappers.
- [ ] Remove Full Page buttons, file inputs and whole-editor locking runtime; keep duplicate section-label disambiguation.
- [ ] Render legacy chapter illustrations using normal image behavior in editor and publishing pipeline. Retain dedicated legacy front-matter section loading for compatibility.
- [ ] Replace contradictory preview toolbar positioning with two explicit rows. Verify selector, zoom and navigation rectangles at desktop and narrow pane widths, in Light and Midnight.
- [ ] Update browser tests to assert the removed controls stay absent, legacy chapter text remains editable, image removal and reload preserve prose.
- [ ] Run focused tests, typecheck and build, then Windows/Linux CI before integration.
- [ ] Continue 3.3 with EPUBCheck and Publish Preflight after these regressions pass.
