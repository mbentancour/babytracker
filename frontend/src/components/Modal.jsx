import { useEffect, useRef } from "react";
import { Icons } from "./Icons";
import { useI18n } from "../utils/i18n";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ title, children, onClose, headerAction }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const contentRef = useRef(null);
  const restoreFocusRef = useRef(null);
  // Hold the latest onClose in a ref so the mount-only effect below can call
  // it without re-running (which would re-steal focus to the first field on
  // every render if the parent passes a fresh onClose identity).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Remember what had focus so we can restore it when the modal closes.
    restoreFocusRef.current = document.activeElement;
    const el = dialogRef.current;
    // Move focus to the first field in the content (so a form is ready to
    // type into), falling back to the dialog itself. Deliberately not the
    // header's close button, which is the first focusable in DOM order.
    // On touch devices, focus the dialog instead: focusing a field while the
    // opening tap's gesture is still active makes the browser activate it —
    // a select pops its dropdown, an input raises the keyboard — so the tap
    // appears to "fall through" into the form.
    if (el) {
      const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
      const first = coarsePointer ? null : contentRef.current?.querySelector(FOCUSABLE);
      (first || el).focus();
    }

    const onKey = (e) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key === "Tab" && el) {
        // Keep focus within the dialog (basic focus trap).
        const nodes = Array.from(el.querySelectorAll(FOCUSABLE)).filter(
          (n) => n.offsetParent !== null,
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to the element that opened the modal.
      const prev = restoreFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
    // Mount-only: focus capture/restore and the listener must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 400,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </span>
            {headerAction}
          </div>
          <button
            onClick={onClose}
            aria-label={t("general.close")}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Icons.X />
          </button>
        </div>
        <div ref={contentRef} style={{ padding: "20px" }}>{children}</div>
      </div>
    </div>
  );
}

export function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-muted)",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function FormInput({ type = "text", ...props }) {
  return (
    <input
      type={type}
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: 14,
        fontFamily: "inherit",
        outline: "none",
        ...props.style,
      }}
    />
  );
}

export function FormSelect({ options, ...props }) {
  return (
    <select
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: 14,
        fontFamily: "inherit",
        outline: "none",
        ...props.style,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FormButton({ children, color, ...props }) {
  return (
    <button
      {...props}
      style={{
        width: "100%",
        padding: "12px 20px",
        borderRadius: 12,
        border: "none",
        background: color || "#F59E0B",
        color: "#000",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "opacity 0.2s",
        ...props.style,
      }}
    >
      {children}
    </button>
  );
}

export function FormDeleteButton({ onDelete }) {
  return (
    <button
      type="button"
      className="form-delete-btn"
      onClick={() => {
        if (confirm("Delete this entry?")) onDelete();
      }}
    >
      Delete Entry
    </button>
  );
}
