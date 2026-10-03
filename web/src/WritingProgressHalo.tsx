import { useEffect, useMemo, useRef, useState } from "react";
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
  const resizeRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);

  const effectiveScope: ProgressScope = scope === "chapter" && !props.chapterAvailable ? "book" : scope;
  const chapterTarget = props.selectedSectionId ? props.targets?.chapters[props.selectedSectionId] ?? null : null;
  const value = effectiveScope === "chapter" ? props.chapterWords : effectiveScope === "today" ? props.todayWords : props.totalWords;
  const target = effectiveScope === "chapter" ? chapterTarget : effectiveScope === "today" ? props.targets?.daily ?? null : props.targets?.book ?? null;
  const percent = clampPercent(value, target);
  const todayPercent = clampPercent(props.todayWords, props.targets?.daily);
  const circumference = 2 * Math.PI * 47;
  const innerCircumference = 2 * Math.PI * 41;

  useEffect(() => {
    window.localStorage.setItem("folio-progress-scope", scope);
  }, [scope]);

  useEffect(() => {
    window.localStorage.setItem("folio-progress-halo-size", String(Math.round(haloSize)));
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

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, startY: event.clientY, startSize: haloSize };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: React.PointerEvent<HTMLButtonElement>) {
    const state = resizeRef.current;
    if (!state) return;
    const delta = ((state.startX - event.clientX) + (state.startY - event.clientY)) / 2;
    setHaloSize(Math.max(88, Math.min(184, Math.round(state.startSize + delta))));
  }

  function stopResize(event: React.PointerEvent<HTMLButtonElement>) {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div
    className={`writing-progress-halo ${open ? "open" : ""}`}
    style={{
      "--folio-halo-size": `${haloSize}px`,
      "--folio-halo-scale": haloSize / 118,
    } as React.CSSProperties}
  >
    <button
      type="button"
      className="progress-halo-orb"
      aria-label="Writing progress"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <svg className="progress-halo-rings" viewBox="0 0 112 112" aria-hidden="true">
        <circle className="progress-halo-track" cx="56" cy="56" r="47"/>
        <circle
          className="progress-halo-ring progress-halo-ring-main"
          cx="56" cy="56" r="47"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
        <circle className="progress-halo-today-track" cx="56" cy="56" r="41"/>
        <circle
          className="progress-halo-ring progress-halo-ring-today"
          cx="56" cy="56" r="41"
          strokeDasharray={innerCircumference}
          strokeDashoffset={innerCircumference * (1 - todayPercent / 100)}
        />
        <path className="progress-halo-notch" d="M84 94 L94 84"/>
      </svg>
      <span className="progress-halo-copy">
        <small>{scopeLabel(effectiveScope)}</small>
        <strong>{value.toLocaleString()}</strong>
        <span>{target ? `of ${target.toLocaleString()}` : "words"}</span>
        <em>{subtitle}</em>
      </span>
    </button>
    <button
      type="button"
      className="progress-halo-resize-handle"
      aria-label="Resize writing progress halo"
      title="Drag to resize"
      onPointerDown={startResize}
      onPointerMove={resize}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
    ><span aria-hidden="true">↖</span></button>

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
