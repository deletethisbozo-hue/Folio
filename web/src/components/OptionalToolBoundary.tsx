import { Component, Suspense, type ReactNode } from "react";

/** A failed optional chunk cannot replace the editor or discard its draft. */
export default class OptionalToolBoundary extends Component<{ label: string; active?: boolean; children: ReactNode; onClose?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed && this.props.active === false) return null;
    if (this.state.failed) return <aside className="optional-tool-error" role="alert"><strong>{this.props.label} could not load.</strong><p>Your manuscript remains open. Save it before restarting Folio.</p>{this.props.onClose && <button className="native-button" onClick={this.props.onClose}>Close</button>}</aside>;
    return <Suspense fallback={<div className="optional-tool-loading" role="status">Loading {this.props.label}…</div>}>{this.props.children}</Suspense>;
  }
}
