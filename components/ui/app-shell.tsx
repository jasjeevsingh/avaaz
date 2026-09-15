import type { ReactNode } from "react";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";

/**
 * Page chrome. `layout="contained"` (default) centers content in a reading
 * column; `layout="wide"` gives working screens (the journey, drills) most of
 * the viewport so multi-column stages have room; `layout="full"` hands the
 * whole width to the page so it can lay down full-bleed color bands.
 */
export function AppShell({
  children,
  layout = "contained",
  headerAction,
}: {
  children: ReactNode;
  layout?: "contained" | "wide" | "full";
  /** Optional control rendered at the top right of the header (e.g. a tutorial link). */
  headerAction?: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <span className="font-display text-xl font-semibold text-foreground">Constructive</span>
          {headerAction}
        </div>
      </header>
      {layout === "full" ? (
        <main>{children}</main>
      ) : layout === "wide" ? (
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      ) : (
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      )}
      <FeedbackPanel />
    </div>
  );
}
