import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Gate } from "@/components/Gate";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
});

describe("Gate", () => {
  it("renders the branded gate with a labelled password field and Enter button", () => {
    render(<Gate />);
    expect(screen.getByRole("heading", { name: "Avaaz" })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /enter/i })).toBeInTheDocument();
  });

  it("submits the typed password to /api/auth", async () => {
    render(<Gate />);
    await userEvent.type(screen.getByLabelText(/password/i), "letmein");
    await userEvent.click(screen.getByRole("button", { name: /enter/i }));
    expect(fetch).toHaveBeenCalledWith("/api/auth", expect.objectContaining({ method: "POST" }));
  });

  it("shows an inline error when the password is rejected", async () => {
    render(<Gate />);
    await userEvent.type(screen.getByLabelText(/password/i), "nope");
    await userEvent.click(screen.getByRole("button", { name: /enter/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn.?t work/i);
  });
});
