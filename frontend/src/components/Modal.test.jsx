import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Modal from "./Modal";
import { I18nProvider } from "../utils/i18n";

// jsdom has no layout, so offsetParent is always null, and the Tab trap
// (which skips controls that aren't rendered by that) would see none.
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode; },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent));
afterEach(cleanup);

function renderModal(props = {}) {
  const onClose = props.onClose || vi.fn();
  render(
    <I18nProvider>
      <Modal title="Edit feeding" onClose={onClose} {...props}>
        <input aria-label="amount" />
        <button>Save</button>
      </Modal>
    </I18nProvider>,
  );
  return { onClose };
}

describe("Modal accessibility", () => {
  it("exposes dialog semantics", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Edit feeding");
  });

  it("closes on Escape", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has an accessible close button", () => {
    renderModal();
    // "Close" comes from the general.close translation.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("moves focus into the dialog on open", () => {
    renderModal();
    // First focusable is the amount input.
    expect(document.activeElement).toBe(screen.getByLabelText("amount"));
  });

  it("focuses the dialog itself on touch devices, not the first field", () => {
    // On coarse-pointer devices, focusing a field during the opening tap
    // makes the browser pop its picker/keyboard, so the dialog gets focus.
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      renderModal();
      expect(document.activeElement).toBe(screen.getByRole("dialog"));
    } finally {
      window.matchMedia = original;
    }
  });

  it("keeps Tab inside the dialog", () => {
    renderModal();
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("closes on backdrop click but not on content click", () => {
    const { onClose } = renderModal();
    // Clicking the dialog content should not close.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // Clicking the backdrop (dialog's parent overlay) closes.
    fireEvent.click(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(
      <I18nProvider>
        <Modal title="X" onClose={vi.fn()}>
          <input aria-label="field" />
        </Modal>
      </I18nProvider>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
