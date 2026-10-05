import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { WritingTargets } from "./write-studio";

export type ProgressScope = "book" | "chapter" | "today";

interface Props {
  totalWords: number;
  chapterWords: number;
  todayWords: number;
  selectedSectionId: string | null;
  chapterAvailable: boolean;
  targets: WritingTargets | null;
  onSaveTargets: (targets: WritingTargets) => Promise<void>;
}

function clampPercent(value: number, target: number | null | undefined): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, Math.min(100, (value / target) * 100));
}

function scopeLabel(scope: ProgressScope): string {
  if (scope === "chapter") return "Chapter";
  if (scope === "today") return "Today";
  return "Book";
}

type HaloPosition = { x: number; y: number };

function readHaloPosition(): HaloPosition | null {
  try {
    const raw = window.localStorage.getItem("folio-progress-halo-position");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HaloPosition>;
    return Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: Number(parsed.x), y: Number(parsed.y) }
      : null;
  } catch {
    return null;
  }
}

function clampHaloPosition(position: HaloPosition, size: number): HaloPosition {
  const margin = 8;
  const statusBar = document.querySelector<HTMLElement>(".folio-statusbar");
  const statusTop = statusBar && getComputedStyle(statusBar).display !== "none"
    ? statusBar.getBoundingClientRect().top
    : window.innerHeight;
  const minX = margin;
  const minY = margin;
  const maxX = window.innerWidth - size - margin;
  const maxY = statusTop - size - margin;
  return {
    x: Math.max(minX, Math.min(Math.max(minX, maxX), position.x)),
    y: Math.max(minY, Math.min(Math.max(minY, maxY), position.y)),
  };
}

export default function WritingProgressHalo(props: Props) {
  const [scope, setScope] = useState<ProgressScope>(() => {
    const stored = window.localStorage.getItem("folio-progress-scope");
    return stored === "chapter" || stored === "today" ? stored : "book";
  });
  const [open, setOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [haloSize, setHaloSize] = useState(() => {
    const stored = Number(window.localStorage.getItem("folio-progress-halo-size"));
    return Number.isFinite(stored) && stored >= 88 && stored <= 184 ? stored : 118;
  });
  const [haloPosition, setHaloPosition] = useState<HaloPosition | null>(() => readHaloPosition());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const haloRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    clientCenterX: number;
    clientCenterY: number;
    localCenterX: number;
    localCenterY: number;
    startDistance: number;
    startSize: number;
  } | null>(null);

  const effectiveScope: ProgressScope = scope === "chapter" && !props.chapterAvailable ? "book" : scope;
  const chapterTarget = props.selectedSectionId ? props.targets?.chapters[props.selectedSectionId] ?? null : null;
  const value = effectiveScope === "chapter" ? props.chapterWords : effectiveScope === "today" ? props.todayWords : props.totalWords;
  const target = effectiveScope === "chapter" ? chapterTarget : effectiveScope === "today" ? props.targets?.daily ?? null : props.targets?.book ?? null;
  const percent = clampPercent(value, target);
  const bookPercent = clampPercent(props.totalWords, props.targets?.book);
  const chapterPercent = clampPercent(props.chapterWords, chapterTarget);
  const todayPercent = clampPercent(props.todayWords, props.targets?.daily);
  const bookCircumference = 2 * Math.PI * 47;
  const chapterCircumference = 2 * Math.PI * 40;
  const todayCircumference = 2 * Math.PI * 34;

  useEffect(() => {
    window.localStorage.setItem("folio-progress-scope", scope);
  }, [scope]);

  useEffect(() => {
    window.localStorage.setItem("folio-progress-halo-size", String(Math.round(haloSize)));
  }, [haloSize]);

  useEffect(() => {
    if (!haloPosition) return;
    window.localStorage.setItem("folio-progress-halo-position", JSON.stringify({
      x: Math.round(haloPosition.x),
      y: Math.round(haloPosition.y),
    }));
  }, [haloPosition]);

  useEffect(() => {
    const clampToViewport = () => setHaloPosition((current) => current ? clampHaloPosition(current, haloSize) : current);
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [haloSize]);

  useEffect(() => {
    setGoalDraft(target ? String(target) : "");
  }, [effectiveScope, target, props.selectedSectionId]);

  const subtitle = useMemo(() => {
    if (!target) return "Set a goal";
    return `${Math.round(percent)}% complete`;
  }, [percent, target]);

  async function saveGoal() {
    if (!props.targets) return;
    const parsed = goalDraft.trim() === "" ? null : Math.max(0, Math.round(Number(goalDraft) || 0));
    const next: WritingTargets = {
      ...props.targets,
      chapters: { ...props.targets.chapters },
    };
    if (effectiveScope === "book") next.book = parsed;
    else if (effectiveScope === "today") next.daily = parsed;
    else if (props.selectedSectionId) {
      if (parsed === null) delete next.chapters[props.selectedSectionId];
      else next.chapters[props.selectedSectionId] = parsed;
    }
    setSaving(true);
    try {
      await props.onSaveTargets(next);
    } finally {
      setSaving(false);
    }
  }

  function choose(next: ProgressScope) {
    if (next === "chapter" && !props.chapterAvailable) return;
    setScope(next);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const halo = event.currentTarget.closest<HTMLElement>(".writing-progress-halo");
    if (!halo) return;
    const bounds = halo.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: bounds.left,
      startY: bounds.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragHalo(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    state.moved = true;
    setDragging(true);
    event.preventDefault();
    setHaloPosition(clampHaloPosition({
      x: state.startX + dx,
      y: state.startY + dy,
    }, haloSize));
  }

  function stopDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function toggleOpen() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpen((value) => !value);
  }

  function startResize(event: ReactPointerEvent<SVGCircleElement>) {
    event.preventDefault();
    event.stopPropagation();
    const halo = event.currentTarget.closest<HTMLElement>(".writing-progress-halo");
    if (!halo) return;
    const bounds = halo.getBoundingClientRect();
    const clientCenterX = bounds.left + bounds.width / 2;
    const clientCenterY = bounds.top + bounds.height / 2;
    const localCenterX = bounds.left + bounds.width / 2;
    const localCenterY = bounds.top + bounds.height / 2;
    setHaloPosition(clampHaloPosition({ x: bounds.left, y: bounds.top }, haloSize));
    resizeRef.current = {
      clientCenterX,
      clientCenterY,
      localCenterX,
      localCenterY,
      startDistance: Math.hypot(event.clientX - clientCenterX, event.clientY - clientCenterY),
      startSize: haloSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: ReactPointerEvent<SVGCircleElement>) {
    const state = resizeRef.current;
    if (!state) return;
    const distance = Math.hypot(event.clientX - state.clientCenterX, event.clientY - state.clientCenterY);
    const nextSize = Math.max(88, Math.min(184, Math.round(state.startSize + (distance - state.startDistance) * 2)));
    setHaloSize(nextSize);
    const halo = event.currentTarget.closest<HTMLElement>(".writing-progress-halo");
    setHaloPosition(clampHaloPosition({
      x: state.localCenterX - nextSize / 2,
      y: state.localCenterY - nextSize / 2,
    }, nextSize));
  }

  function stopResize(event: ReactPointerEvent<SVGCircleElement>) {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const popoverBelow = haloPosition !== null && haloPosition.y < 340;
  const popoverAlignLeft = haloPosition !== null && haloPosition.x < 310;

  return <div
    ref={haloRef}
    className={`writing-progress-halo ${open ? "open" : ""} ${dragging ? "dragging" : ""} ${popoverBelow ? "popover-below" : ""} ${popoverAlignLeft ? "popover-align-left" : ""}`}
    data-progress-section-id={props.selectedSectionId ?? ""}
    data-progress-scope={effectiveScope}
    style={{
      "--folio-halo-size": `${haloSize}px`,
      "--folio-halo-scale": haloSize / 118,
      ...(haloPosition ? {
        left: `${haloPosition.x}px`,
        top: `${haloPosition.y}px`,
        right: "auto",
        bottom: "auto",
      } : {}),
    } as CSSProperties}
  >
    <button
      type="button"
      className="progress-halo-orb"
      aria-label="Writing progress. Drag to move Folio Halo; click for details."
      aria-expanded={open}
      onClick={toggleOpen}
      onPointerDown={startDrag}
      onPointerMove={dragHalo}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <svg className="progress-halo-rings" viewBox="0 0 112 112" aria-hidden="true">
        <circle className="progress-halo-track progress-halo-track-book" cx="56" cy="56" r="47"/>
        <circle
          className="progress-halo-ring progress-halo-ring-main progress-halo-ring-book"
          cx="56"
          cy="56"
          r="47"
          strokeDasharray={bookCircumference}
          strokeDashoffset={bookCircumference * (1 - bookPercent / 100)}
        />
        <circle className="progress-halo-chapter-track" cx="56" cy="56" r="40"/>
        <circle
          className="progress-halo-ring progress-halo-ring-chapter"
          cx="56"
          cy="56"
          r="40"
          strokeDasharray={chapterCircumference}
          strokeDashoffset={chapterCircumference * (1 - chapterPercent / 100)}
        />
        <circle className="progress-halo-today-track" cx="56" cy="56" r="34"/>
        <circle
          className="progress-halo-ring progress-halo-ring-today"
          cx="56"
          cy="56"
          r="34"
          strokeDasharray={todayCircumference}
          strokeDashoffset={todayCircumference * (1 - todayPercent / 100)}
        />
      </svg>
      <span className="progress-halo-copy">
        <small>{scopeLabel(effectiveScope)}</small>
        <strong>{value.toLocaleString()}</strong>
        <span>{target ? `of ${target.toLocaleString()}` : "words"}</span>
        <em>{subtitle}</em>
      </span>
    </button>
    <svg className="progress-halo-resize-edge" viewBox="0 0 112 112" aria-hidden="true">
      <circle
        cx="56"
        cy="56"
        r="54"
        fill="none"
        stroke="transparent"
        strokeWidth="4"
        pointerEvents="stroke"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />
    </svg>

    {open && <div className="progress-halo-popover">
      <header>
        <div><small>Writing progress</small><strong>Folio Halo</strong></div>
        <button type="button" aria-label="Close progress" onClick={() => setOpen(false)}>×</button>
      </header>
      <nav className="progress-scope-tabs" aria-label="Progress scope">
        <button type="button" className={effectiveScope === "book" ? "active" : ""} onClick={() => choose("book")}>Book</button>
        <button type="button" disabled={!props.chapterAvailable} className={effectiveScope === "chapter" ? "active" : ""} onClick={() => choose("chapter")}>Chapter</button>
        <button type="button" className={effectiveScope === "today" ? "active" : ""} onClick={() => choose("today")}>Today</button>
      </nav>
      <div className="progress-halo-stat">
        <span><small>Current</small><strong>{value.toLocaleString()}</strong></span>
        <span><small>Goal</small><strong>{target?.toLocaleString() ?? "—"}</strong></span>
        <span><small>Progress</small><strong>{target ? `${Math.round(percent)}%` : "—"}</strong></span>
      </div>
      <label className="progress-goal-field">
        <span>{scopeLabel(effectiveScope)} goal</span>
        <div><input type="number" min="0" step="100" value={goalDraft} placeholder="No goal" onChange={(event) => setGoalDraft(event.target.value)}/><button type="button" disabled={saving || !props.targets} onClick={() => void saveGoal()}>{saving ? "Saving…" : "Save"}</button></div>
      </label>
      <div className="progress-halo-today-row">
        <span>Today</span>
        <strong>+{Math.max(0, props.todayWords).toLocaleString()}</strong>
        <small>{props.targets?.daily ? `of ${props.targets.daily.toLocaleString()}` : "no daily goal"}</small>
      </div>
    </div>}
  </div>;
}
