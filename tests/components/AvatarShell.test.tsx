import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvatarShell } from "@/components/avatar/AvatarShell";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "Avatar response." }), { status: 200 })));
});

describe("AvatarShell", () => {
  it("renders the three mode cards", () => {
    render(<AvatarShell onExit={() => {}} />);
    expect(screen.getByRole("button", { name: /sparring/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pushback/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build.*debate/i })).toBeInTheDocument();
  });

  it("explains the mode after selecting it, then shows the motion picker", async () => {
    render(<AvatarShell onExit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /sparring/i }));
    expect(screen.getByText(/how this mode works/i)).toBeInTheDocument();
    expect(screen.getByText(/coin flip decides who opens/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /pick a motion/i }));
    expect(screen.getByRole("heading", { name: /pick a motion/i })).toBeInTheDocument();
  });

  it("describes each mode's phases in its intro", async () => {
    render(<AvatarShell onExit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /build.*debate/i }));
    expect(screen.getByText(/phase 1, build/i)).toBeInTheDocument();
    expect(screen.getByText(/phase 2, debate/i)).toBeInTheDocument();
  });

  it("shows side picker after selecting a motion in sparring mode", async () => {
    render(<AvatarShell onExit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /sparring/i }));
    await userEvent.click(screen.getByRole("button", { name: /pick a motion/i }));
    const motionButtons = screen.getAllByRole("button", { name: /This House/ });
    await userEvent.click(motionButtons[0]);
    expect(screen.getByText(/which side/i)).toBeInTheDocument();
  });

  it("calls onExit when exit button is clicked from mode selection", async () => {
    const onExit = vi.fn();
    render(<AvatarShell onExit={onExit} />);
    // Note: getByRole would throw here because "Pushback Coach" also matches
    // /back/i. The real exit control renders first in document order, so
    // take the first match rather than requiring a single unique match.
    await userEvent.click(screen.getAllByRole("button", { name: /exit|back/i })[0]);
    expect(onExit).toHaveBeenCalled();
  });
});
