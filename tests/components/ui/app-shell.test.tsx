import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/ui/app-shell";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AppShell", () => {
  it("renders the wordmark header and its children", () => {
    render(<AppShell><p>page body</p></AppShell>);
    expect(screen.getByText("Avaaz")).toBeInTheDocument();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("offers the feedback panel when enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_ENABLED", "1");
    render(<AppShell><p>page body</p></AppShell>);
    expect(screen.getByRole("button", { name: /user feedback/i })).toBeInTheDocument();
  });

  it("renders no feedback affordance when the flag is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_ENABLED", "");
    render(<AppShell><p>page body</p></AppShell>);
    expect(screen.queryByRole("button", { name: /user feedback/i })).toBeNull();
  });
});
