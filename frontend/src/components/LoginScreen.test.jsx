import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";

vi.mock("../api", () => ({ api: {}, setAccessToken: vi.fn() }));

const { default: LoginScreen } = await import("./LoginScreen");

afterEach(cleanup);

function renderLogin(props) {
  return render(
    <I18nProvider>
      <LoginScreen isSetup={false} onAuthenticated={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe("LoginScreen with OIDC", () => {
  it("has no provider button unless OIDC is enabled", () => {
    renderLogin({});
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  it("links to the server's OIDC login next to the password form", () => {
    renderLogin({ oidc: { enabled: true, providerName: "Kanidm" } });
    const link = screen.getByRole("link", { name: "Sign in with Kanidm" });
    // Relative, so it works behind a path prefix like every other API call.
    expect(link.getAttribute("href")).toBe("./api/auth/oidc/login");
    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  it("drops the password form when password sign-in is disabled", () => {
    renderLogin({ oidc: { enabled: true, providerName: "Kanidm" }, passwordLogin: false });
    expect(screen.getByRole("link", { name: "Sign in with Kanidm" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("explains a callback error, falling back to a generic message", () => {
    renderLogin({ oidc: { enabled: true, providerName: "Kanidm" }, oidcError: "not_allowed" });
    expect(screen.getByText("Your account at the provider isn't allowed to use BabyTracker.")).toBeTruthy();
    cleanup();
    renderLogin({ oidc: { enabled: true, providerName: "Kanidm" }, oidcError: "<script>" });
    expect(screen.getByText("Signing in with the provider failed. Please try again.")).toBeTruthy();
  });
});
