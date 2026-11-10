# Second Draft Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Second Draft into a coherent rewrite workspace with a clear primary flow.

**Architecture:** `SecondDraftPane` remains the behavior owner. Its right pane gets a compact rewrite desk and Session drawer while the existing primary editor remains the editable new-draft surface. CSS uses the existing container-query strategy.

**Tech Stack:** React, TypeScript, CSS container queries, Puppeteer browser QA.

**Spec:** `docs/superpowers/specs/2026-11-08-second-draft-workspace-redesign-design.md`

## Global Constraints

- New draft stays left and editable; old source stays right and read-only.
- Existing Second Draft decisions and review data remain available.
- Desktop and sidebar-open layouts must not overlap controls.

## Review Focus

- A no-decision chapter shows one useful next step rather than a disabled wall of actions.
- Active and Later decisions remain immediately recoverable.
- Source changes still block unsafe decisions.
- Session tools remain reachable without competing with the rewrite action.
- Narrow panes preserve clickable controls without clipping labels.

---

### Task 1: Rewrite desk structure

**Files:**
- Modify: `web/src/SecondDraftPane.tsx`
- Test: `tests/v300-second-draft.test.ts`

- [ ] Write a failing source-level contract test for the Session drawer and rewrite desk landmarks.
- [ ] Run `node --import tsx tests/v300-second-draft.test.ts` and confirm the contract fails.
- [ ] Replace header action clusters with a Session trigger and introduce labelled desk/status landmarks.
- [ ] Run the Second Draft test file and confirm it passes.

### Task 2: Focused visual hierarchy

**Files:**
- Modify: `web/src/v300-second-draft.css`
- Test: `scripts/v300-second-draft-preview.ts`

- [ ] Add a failing browser assertion for the Session trigger and rewrite-desk geometry.
- [ ] Run `node --import tsx scripts/v300-second-draft-preview.ts` and confirm it fails.
- [ ] Style the rewrite desk, decision dock, source header and responsive states.
- [ ] Run browser QA and confirm it passes.

### Task 3: Full verification

**Files:**
- Test: `tests/v300-second-draft.test.ts`, `scripts/v300-second-draft-preview.ts`

- [ ] Run targeted helper tests, typecheck and browser QA.
- [ ] Run `npm test` with the pinned publishing runtimes.
- [ ] Capture all redesign screenshots for review.

