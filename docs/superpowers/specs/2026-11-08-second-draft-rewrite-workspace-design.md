# Second Draft Rewrite Workspace Design

## Intent

Second Draft is Folio's focused workspace for rewriting a chapter. The author writes the new draft on the left and keeps the previous draft on the right as read-only source material. It must make sustained rewriting simpler, safer, and calmer than switching between two ordinary editor panes.

## Goals

- Make the new draft the primary, editable surface and the old draft a protected reference.
- Preserve the useful existing tools—source selection, rewrite/cut/keep/later decisions, issues, carry-overs, chapter brief, review passes, and chapter sealing—without making any of them mandatory to write.
- Give a writer a clear session workflow: orient, select old material, decide what to do with it, write freely, then review outstanding work.
- Keep all review state persisted with the project. Keep purely visual preferences local and explicitly disposable.
- Provide a responsive layout that works at common laptop widths and does not turn the source into a fragile pseudo-editor.

## Non-goals

- This is not a version-control diff viewer or an automatic rewrite generator.
- It does not alter the source chapter from Second Draft.
- It does not add cloud collaboration, AI text generation, or a new project format.

## Product model

Each target chapter has one optional source chapter and a persistent rewrite state. The target remains Folio's normal rich-text chapter editor. Source selections create durable rewrite cards with a source quote, intent, disposition, and optional linked target range. A source fingerprint warns the writer that the reference changed; it never silently remaps or discards their decisions.

The workspace has three layers:

1. **Rewrite canvas:** left target editor, right read-only source. The left pane has the strongest visual weight and the only text caret.
2. **Rewrite queue:** selected source cards are grouped as Now, Later, Done, and Sent ahead. Cards provide a small, direct action set and jump to their source selection.
3. **Review drawer:** chapter brief, issues, checklist passes, carry-overs, and finish/seal details live behind explicit controls rather than competing with the writing surface.

## Approaches considered

1. Incrementally simplify the old source-left panel. This preserves too much of the old interaction model and fails the requested new-left/old-right mental model.
2. Replace the visible workspace while retaining the existing persisted Second Draft API and data model. Chosen: it delivers a coherent writer-first experience without invalidating projects already using the feature.
3. Reduce the feature to two plain editor panes. This would be simpler but loses the useful review decisions and chapter continuity tools already present.

## Constraints and decisions

- Target on the left, source on the right, in left-to-right UI locales.
- Existing `SecondDraftState` remains backward compatible; existing block/issue/carry-over records stay valid.
- Selection and source highlighting use read-only DOM ranges. The target editor remains the single editable document owner.
- The existing HTTP API remains the persistence boundary. Local storage only records workspace presentation preferences such as pane widths and which drawer is open.
- Every new behavior receives an automated test; visual changes receive browser screenshot QA.

## Success criteria

A writer can open a chapter, select a source chapter, write in the left pane without interacting with the source, create and resolve rewrite decisions, defer material to a later chapter, resume exactly where they were, and seal the chapter only after the queue and issues are resolved. The workspace communicates this flow without requiring a manual or obscuring the text.
