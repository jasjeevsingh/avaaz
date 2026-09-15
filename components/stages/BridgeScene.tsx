/* eslint-disable @next/next/no-img-element */
"use client";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type SceneMaterial = "evidence" | "reasoning";

/**
 * The bridge illustration from the lesson, sitting above the Link stage so
 * the metaphor stays consistent through the tool. The placed planks are
 * listed in the span below it; here the picture just reacts to the test:
 * a green frame and a "holds" tag when the bridge stands, a shake when it
 * doesn't. (Testers found the previous abstract beam bar unreadable.)
 */
export function BridgeScene({
  placed,
  testResult,
}: {
  placed: { id: string; material: SceneMaterial }[];
  testResult: "held" | "failed" | null;
}) {
  const reduced = useReducedMotion() ?? false;
  const shake = testResult === "failed" && !reduced;

  return (
    <motion.figure
      aria-hidden
      data-testid="bridge-scene"
      data-planks={placed.length}
      data-result={testResult ?? undefined}
      className={cn(
        "relative mb-4 overflow-hidden rounded-xl border bg-[#F6F0E3] transition-colors",
        testResult === "held" ? "border-success ring-2 ring-success/40" : "border-border",
      )}
      animate={shake ? { x: [0, -5, 5, -4, 4, 0] } : { x: 0 }}
      transition={shake ? { duration: 0.5, delay: 0.3 } : { duration: 0 }}
    >
      <img
        src="/lesson/cli-bridge.jpg"
        alt=""
        width={1600}
        height={1194}
        // Full width. Small screens keep the whole picture; wider stages crop to a
        // 3:1 banner positioned so the three labels and the deck stay in frame.
        className={cn(
          "block w-full object-cover object-[50%_33%] transition-opacity",
          "aspect-[4/3] sm:aspect-[3/1]",
          testResult === "failed" && "opacity-80",
        )}
      />
      {testResult === "held" && (
        <div className="absolute right-3 top-3 rounded-full bg-success px-3 py-1 text-xs font-semibold text-success-foreground shadow">
          ✓ It holds
        </div>
      )}
      {testResult === "failed" && (
        <div className="absolute right-3 top-3 rounded-full bg-reasoning px-3 py-1 text-xs font-semibold text-reasoning-foreground shadow">
          ✗ Not yet
        </div>
      )}
    </motion.figure>
  );
}
