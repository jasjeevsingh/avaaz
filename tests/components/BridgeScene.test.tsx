import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BridgeScene } from "@/components/stages/BridgeScene";

const placed = [
  { id: "e1", material: "evidence" as const },
  { id: "r1", material: "reasoning" as const },
];

describe("BridgeScene", () => {
  it("shows the lesson's bridge illustration, decoratively", () => {
    render(<BridgeScene placed={placed} testResult={null} />);
    const scene = screen.getByTestId("bridge-scene");
    expect(scene).toHaveAttribute("aria-hidden", "true");
    expect(scene.querySelector("img")).toHaveAttribute("src", "/lesson/cli-bridge.jpg");
    expect(scene).toHaveAttribute("data-planks", "2");
    expect(screen.queryByText(/it holds/i)).toBeNull();
  });

  it("tags the picture when the bridge holds", () => {
    render(<BridgeScene placed={placed} testResult="held" />);
    expect(screen.getByText(/it holds/i)).toBeInTheDocument();
    expect(screen.getByTestId("bridge-scene")).toHaveAttribute("data-result", "held");
  });

  it("tags the picture when the bridge fails", () => {
    render(<BridgeScene placed={placed} testResult="failed" />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
  });
});
