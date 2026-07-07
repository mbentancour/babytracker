import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Modal from "./Modal";
import { I18nProvider } from "../utils/i18n";

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
