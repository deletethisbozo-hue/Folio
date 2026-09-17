import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  forgetRecentProject,
  readRecentProjects,
  type RecentProject,
} from "./recent-projects";

function displayFolder(folder: string): string {
  const clean = folder.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || clean;
}

function openedLabel(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "Just now";
  if (elapsed < hour) return `${Math.max(1, Math.floor(elapsed / minute))} min ago`;
  if (elapsed < day) return `${Math.max(1, Math.floor(elapsed / hour))} hr ago`;
  if (elapsed < day * 7) return `${Math.max(1, Math.floor(elapsed / day))} d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function projectMonogram(project: RecentProject): string {
  return (project.title.trim()[0] || "F").toLocaleUpperCase();
}

export default function StartScreen(props: { onOpenPath: (path: string) => Promise<void>; onOpenProject: (project: Awaited<ReturnType<typeof api.newBook>>) => void; onOpenSample: () => Promise<void> }) {
  const [recent, setRecent] = useState<RecentProject[]>(() => readRecentProjects());
  const [busy, setBusy] = useState<"open" | "new" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newBook, setNewBook] = useState({ path: "", title: "", author: "" });
  const tone = useMemo(() => window.localStorage.getItem("folio-ui-tone") === "midnight" ? "midnight" : "ivory", []);

  useEffect(() => {
    let cancelled = false;
    api.recentProjects().then((items) => {
      if (!cancelled && items.length) setRecent(items);
    }).catch(() => { /* localStorage remains a same-session fallback */ });
    return () => { cancelled = true; };
  }, []);

  async function chooseExisting() {
    setBusy("open"); setError(null);
    try {
      const selected = (await api.pickFolder(recent[0]?.folder)).path;
      if (selected) await props.onOpenPath(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function chooseNewLocation() {
    setBusy("new"); setError(null);
    try {
      const selected = (await api.pickFolder()).path;
      if (!selected) return;
      setNewBook({ path: selected, title: "", author: "" });
      setShowCreate(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function createBook() {
    const title = newBook.title.trim();
    const author = newBook.author.trim();
    if (!newBook.path || !title || !author) return;
    setBusy("create"); setError(null);
    try {
      const summary = await api.newBook(newBook.path, title, author);
      setRecent(readRecentProjects());
      setShowCreate(false);
      props.onOpenProject(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openRecent(folder: string) {
    if (busy !== null) return;
    setBusy("open"); setError(null);
    try { await props.onOpenPath(folder); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function openBundledSample() {
    if (busy !== null) return;
    setBusy("open"); setError(null);
    try { await props.onOpenSample(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  function removeRecent(event: React.MouseEvent, folder: string) {
    event.stopPropagation();
    setRecent(forgetRecentProject(folder));
    void api.forgetRecentProject(folder).catch(() => {});
  }

  return (
    <div className="start-shell" data-ui-tone={tone}>
      <div className="start-windowbar">
        <div className="start-brand">folio</div>
        <div className="start-version">2.0.8</div>
      </div>

      <main className="start-main">
        <section className="start-intro" aria-labelledby="start-title">
          <p className="start-kicker">Book formatting studio</p>
          <h1 id="start-title">Your books,<br/>ready to continue.</h1>
          <p className="start-copy">Open a recent project without hunting through folders, or start something new.</p>
          <div className="start-actions">
            <button className="start-button primary" disabled={busy !== null} onClick={() => void chooseNewLocation()}>
              {busy === "new" ? "Choosing folder…" : "New Book"}
            </button>
            <button className="start-button" disabled={busy !== null} onClick={() => void chooseExisting()}>
              {busy === "open" ? "Opening…" : "Open Book…"}
            </button>
            <button className="start-button sample" disabled={busy !== null} onClick={() => void openBundledSample()}>Open Sample</button>
          </div>
          {error && <button className="start-error" onClick={() => setError(null)}>{error}</button>}
        </section>

        <section className="recent-section" aria-labelledby="recent-title">
          <div className="recent-heading">
            <div>
              <p className="recent-eyebrow">Library</p>
              <h2 id="recent-title">Recent Books</h2>
            </div>
            <span>{recent.length > 0 ? `${recent.length} project${recent.length === 1 ? "" : "s"}` : "Local history"}</span>
          </div>

          {recent.length > 0 ? (
            <div className="recent-list">
              {recent.map((item) => (
                <button key={item.folder} className="recent-row" disabled={busy !== null} onClick={() => void openRecent(item.folder)} title={item.folder}>
                  <span className="recent-cover" aria-hidden="true"><b>{projectMonogram(item)}</b><i>folio</i></span>
                  <span className="recent-meta">
                    <strong>{item.title}</strong>
                    <span className="recent-author">{item.author}</span>
                    <span className="recent-path"><b>{displayFolder(item.folder)}</b><span>{item.folder}</span></span>
                  </span>
                  <span className="recent-time">{openedLabel(item.lastOpened)}</span>
                  <span
                    className="recent-remove"
                    role="button"
                    tabIndex={0}
                    title="Remove from recent books"
                    aria-label={`Remove ${item.title} from recent books`}
                    onClick={(event) => removeRecent(event, item.folder)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        setRecent(forgetRecentProject(item.folder));
                        void api.forgetRecentProject(item.folder).catch(() => {});
                      }
                    }}
                  >×</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="recent-empty">
              <h3>No recent books yet</h3>
              <p>Books you open in Folio will appear here automatically.</p>
              <button className="start-button" disabled={busy !== null} onClick={() => void chooseExisting()}>Open your first book…</button>
            </div>
          )}
        </section>
      </main>

      {showCreate && (
        <div className="start-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowCreate(false)}>
          <section className="start-modal" role="dialog" aria-modal="true" aria-labelledby="new-book-title">
            <div className="start-modal-head">
              <div><p>New project</p><h2 id="new-book-title">Create Book</h2></div>
              <button className="start-modal-close" aria-label="Close" disabled={busy === "create"} onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="start-folder-summary"><span>Folder</span><strong>{newBook.path}</strong></div>
            <label className="start-field"><span>Title</span><input autoFocus value={newBook.title} onChange={(event) => setNewBook({ ...newBook, title: event.target.value })}/></label>
            <label className="start-field"><span>Author</span><input value={newBook.author} onChange={(event) => setNewBook({ ...newBook, author: event.target.value })} onKeyDown={(event) => event.key === "Enter" && void createBook()}/></label>
            <div className="start-modal-actions">
              <button className="start-button" disabled={busy === "create"} onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="start-button primary" disabled={busy === "create" || !newBook.title.trim() || !newBook.author.trim()} onClick={() => void createBook()}>{busy === "create" ? "Creating…" : "Create Book"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
