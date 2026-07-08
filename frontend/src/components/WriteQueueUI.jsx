/**
 * Write-queue UI — hook + badge/list for pending & failed writes.
 *
 * Exported:
 *   - useFailedWrites   React hook → { pendingCount, failedCount, failedWrites }
 *   - FailedWritesList  React component → badge + per-item retry buttons
 *   - WriteQueueIndicator  compact status badge (for inline header use)
 *
 * Uses queueSubscribe() from writeQueue.js for reactive state updates.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  queueAdd,
  queueClearFailed,
  queueGetFailed,
  queueSubscribe,
} from "../utils/writeQueue";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reactive hook over the write queue.
 * @returns {{ pendingCount: number, failedCount: number, failedWrites: Array }}
 */
export function useFailedWrites() {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [failedWrites, setFailedWrites] = useState([]);

  const onQueueChange = useCallback(async () => {
    const failed = await queueGetFailed();
    setFailedWrites(failed);
    setFailedCount(failed.length);
  }, []);

  useEffect(() => {
    // Run once on mount to hydrate failedWrites
    onQueueChange();
    // Subscribe to future mutations
    const unsubscribe = queueSubscribe((state) => {
      setPendingCount(state.pendingCount);
      setFailedCount(state.failedCount);
      // Refresh failedWrites so the list updates when writes are retried or cleared
      queueGetFailed().then((failed) => {
        setFailedWrites(failed);
      });
    });
    return unsubscribe;
  }, [onQueueChange]);

  return useMemo(
    () => ({ pendingCount, failedCount, failedWrites }),
    [pendingCount, failedCount, failedWrites],
  );
}

// ---------------------------------------------------------------------------
// Compact indicator (for header / inline use)
// ---------------------------------------------------------------------------

export function WriteQueueIndicator() {
  const { pendingCount, failedCount } = useFailedWrites();

  const hasWork = pendingCount > 0 || failedCount > 0;

  if (!hasWork) return null;

  return (
    <span
      className="write-queue-indicator"
      title={
        pendingCount > 0
          ? `${pendingCount} write(s) pending sync`
          : `${failedCount} write(s) failed`
      }
      aria-label={`${failedCount} failed, ${pendingCount} pending writes`}
    >
      {pendingCount > 0 && (
        <span className="write-queue-badge write-queue-pending" aria-label={`${pendingCount} pending`}>
          {pendingCount}
        </span>
      )}
      {failedCount > 0 && (
        <span className="write-queue-badge write-queue-failed" aria-label={`${failedCount} failed`}>
          ✕ {failedCount}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Full list component
// ---------------------------------------------------------------------------

/**
 * Render a list of failed writes with per-item retry buttons.
 * Lightweight: no modal, just a card with items.
 *
 * @param {{ compact?: boolean }} props
 */
export function FailedWritesList({ compact = false }) {
  const { pendingCount, failedCount, failedWrites } = useFailedWrites();

  const handleRetry = useCallback(async (op) => {
    try {
      // Re-add the failed operation so it gets picked up by queueReplay()
      await queueAdd({
        method: op.method,
        entity: op.entity,
        path: op.path,
        body: op.body,
      });
    } catch {
      // Silently fail — the user can try again
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    await queueClearFailed();
  }, []);

  const hasWork = pendingCount > 0 || failedCount > 0;

  if (!hasWork) return null;

  return (
    <div className={compact ? "write-queue-compact" : "write-queue-list"}>
      {/* Summary bar */}
      <div className="write-queue-summary">
        {pendingCount > 0 && (
          <span className="write-queue-badge write-queue-pending">
            {pendingCount} pending
          </span>
        )}
        {failedCount > 0 && (
          <span className="write-queue-badge write-queue-failed">
            {failedCount} failed
          </span>
        )}
      </div>

      {/* Failed items */}
      {failedCount > 0 && (
        <div className="write-queue-items">
          {failedWrites.map((op) => (
            <div key={op.id} className="write-queue-item fade-in">
              <div className="write-queue-item-header">
                <span className="write-queue-item-type">{op.entity}</span>
                <span className="write-queue-item-method">{op.method}</span>
              </div>
              <div className="write-queue-item-error" title={op.error}>
                {op.error}
              </div>
              <div className="write-queue-item-actions">
                <button
                  className="write-queue-retry-btn"
                  onClick={() => handleRetry(op)}
                  aria-label={`Retry ${op.entity} write`}
                >
                  Retry
                </button>
              </div>
            </div>
          ))}
          <button
            className="write-queue-clear-btn"
            onClick={handleClearAll}
            aria-label="Clear all failed writes"
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}