import { Component } from "react";

// App-wide error boundary. On a wall-mounted appliance an uncaught render
// error otherwise blanks the screen with no way to recover; this catches it
// and shows a reload affordance plus the error for debugging. Placed at the
// very top (outside the i18n/preferences providers) so it also catches errors
// thrown inside those — which is why the copy is plain English rather than
// translated: the translation layer may be the thing that failed.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaces in the browser console and any remote log capture.
    console.error("Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "var(--bg, #111)",
          color: "var(--text, #eee)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: 420, color: "var(--text-muted, #999)", margin: 0 }}>
          BabyTracker hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            fontFamily: "inherit",
            background: "var(--accent, #6C5CE7)",
            color: "#fff",
          }}
        >
          Reload
        </button>
        <details style={{ maxWidth: "90vw", color: "var(--text-muted, #999)", fontSize: 12 }}>
          <summary style={{ cursor: "pointer" }}>Technical details</summary>
          <pre
            style={{
              textAlign: "left",
              overflow: "auto",
              maxHeight: "40vh",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        </details>
      </div>
    );
  }
}
