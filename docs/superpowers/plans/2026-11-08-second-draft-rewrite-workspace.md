# Second Draft Rewrite Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Second Draft a durable, writer-first chapter rewriting workspace with the new draft on the left and source material on the right.

**Architecture:** Retain the current persistent Second Draft API and domain records, but move UI decisions into small pure rewrite-workspace helpers and a simplified pane composition. The pane treats the main manuscript editor as the only target editor, renders source as read-only reference, and exposes queue/review controls without obscuring the canvas.

**Tech Stack:** React 18, TypeScript, existing Express API, Puppeteer browser QA, native `tests/run-all.ts` suite.

**Spec:** `docs/superpowers/specs/2026-11-08-second-draft-rewrite-workspace-design.md`

## Global Constraints

- Target editor is on the left; source reference is on the right.
- Do not mutate a source chapter from Second Draft.
- Preserve existing `SecondDraftState` project data and API routes.
- Persist decisions through the server; persist presentation preferences only in local storage.
- Use test-first development for each production behavior.

## Review Focus

- A source chapter changed after decisions exist: warn without losing records.
- A narrow viewport: target remains readable and source remains accessible.
- A writer has no source selected: writing stays available and setup is obvious.
- Existing saved Second Draft records survive opening, closing, and re-opening the new workspace.
- Multiple outstanding decisions: queue actions jump to the correct source region and never mutate source text.

---

### Task 1: Rewrite workspace domain helpers

**Files:**
- Modify: `web/src/second-draft.ts`
- Test: `tests/v300-second-draft.test.ts`

**Interfaces:**
- Produces: `rewriteQueue`, `rewriteQueueSummary`, and `sourceChangeNotice` pure helpers.
- Consumes: existing `SecondDraftBlock`, `SecondDraftPair`, and source fingerprint data.

- [ ] **Step 1: Write failing tests** for Now/Later/Done grouping, summary counts, and a non-destructive source-change notice.
- [ ] **Step 2: Run the focused test** and confirm it fails because the helpers do not exist.
- [ ] **Step 3: Implement minimal pure helpers** in `web/src/second-draft.ts`.
- [ ] **Step 4: Run focused tests and `npm test`**; confirm all pass.
- [ ] **Step 5: Commit** with `feat: add rewrite workspace queue helpers`.

### Task 2: Recompose the Second Draft canvas

**Files:**
- Modify: `web/src/SecondDraftPane.tsx`
- Modify: `web/src/v300-second-draft.css`
- Test: `scripts/v300-second-draft-preview.ts`

**Interfaces:**
- Consumes: Task 1 queue helpers.
- Produces: target-left/source-right workspace, explicit source setup state, source-change warning, and read-only source semantics.

- [ ] **Step 1: Write failing browser assertions** for left editable target, right read-only source, no-source empty state, and changed-source warning.
- [ ] **Step 2: Run browser QA** and confirm assertions fail against the old layout.
- [ ] **Step 3: Implement the minimal layout and CSS changes** with semantic labels and responsive collapse behavior.
- [ ] **Step 4: Re-run browser QA and `npm test`**; confirm all pass.
- [ ] **Step 5: Commit** with `feat: make Second Draft a target-first rewrite canvas`.

### Task 3: Build the rewrite queue and review drawer

**Files:**
- Modify: `web/src/SecondDraftPane.tsx`
- Modify: `web/src/v300-second-draft.css`
- Test: `scripts/v300-second-draft-preview.ts`
- Test: `tests/v300-second-draft.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers and existing Second Draft API methods.
- Produces: queue navigation, status actions, review drawer access, and preserved persisted state after remount.

- [ ] **Step 1: Write failing tests** for queue grouping/actions and re-open persistence.
- [ ] **Step 2: Run focused tests** and confirm the old UI does not meet them.
- [ ] **Step 3: Implement queue controls and a condensed review drawer** around existing persisted operations.
- [ ] **Step 4: Run browser QA and `npm test`**; confirm all pass.
- [ ] **Step 5: Commit** with `feat: add Second Draft rewrite queue and review drawer`.

### Task 4: Visual proof and release readiness

**Files:**
- Modify: `scripts/v300-second-draft-preview.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: final workspace controls.
- Produces: named screenshots covering normal rewrite, source warning, queue, review, and Midnight view.

- [ ] **Step 1: Add failing screenshot/interaction assertions** for every new state.
- [ ] **Step 2: Run QA and confirm missing screenshot states fail.**
- [ ] **Step 3: Add final visual captures and changelog entry.**
- [ ] **Step 4: Run `npm run typecheck`, `npm test`, build, and browser QA**; confirm all pass.
- [ ] **Step 5: Commit** with `test: prove Second Draft rewrite workflow`.
