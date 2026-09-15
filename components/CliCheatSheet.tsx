"use client";
import { useEffect, useState } from "react";
import { CLI_DEFINITIONS, CLI_PARTS, type CliPart } from "@/lib/cli";
import { FALLACIES, FALLACY_IDS, type FallacyId } from "@/lib/fallacies";
import { FallacyCard } from "@/components/FallacyCard";
import { hasAdvancedAnywhere } from "@/lib/state/flowProgress";
import type { FlowStage } from "@/lib/state/flowMachine";
import { cn } from "@/lib/utils";

export const CHEATSHEET_STORAGE_KEY = "constructive:cheatsheet:v1";

type Tab = "cli" | "fallacies";

/** A student's explicit open/close choice wins; before they've made one, the
 *  sheet is open until they've advanced past Claim anywhere. */
export function cheatSheetDefaultOpen(storage: Storage): boolean {
  const stored = storage.getItem(CHEATSHEET_STORAGE_KEY);
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return !hasAdvancedAnywhere(storage);
}

const PART_TONE: Record<CliPart, string> = {
  claim: "bg-foreground",
  link: "bg-evidence",
  impact: "bg-success",
};

function MiniBridge({ current }: { current: FlowStage }) {
  const lit = (p: CliPart) => (p === current ? "opacity-100" : "opacity-35");
  return (
    <div aria-hidden className="mt-3 flex h-10 items-end gap-0.5">
      <div className={cn("h-8 w-1/4 rounded-tl-md bg-foreground", lit("claim"))} />
      <div className="flex h-full w-1/2 flex-col justify-end">
        <div className={cn("h-2 rounded-sm bg-reasoning", lit("link"))} />
        <div className={cn("mt-0.5 h-2.5 rounded-sm bg-evidence", lit("link"))} />
      </div>
      <div className={cn("h-7 w-1/4 rounded-tr-md bg-success", lit("impact"))} />
    </div>
  );
}

function CliTab({ stage }: { stage: FlowStage }) {
  return (
    <>
      <MiniBridge current={stage} />
      <dl className="mt-3 space-y-3">
        {CLI_PARTS.map((part) => {
          const d = CLI_DEFINITIONS[part];
          const current = part === stage;
          return (
            <div
              key={part}
              data-testid={current ? "cheatsheet-current" : undefined}
              className={cn(
                "rounded-md border-l-2 py-1 pl-2.5",
                current ? "border-primary bg-white/70" : "border-transparent",
              )}
            >
              <dt className="flex items-center gap-1.5 text-sm">
                <span className={cn("h-2 w-2 rounded-full", PART_TONE[part])} aria-hidden />
                <span className={cn("font-semibold", current ? "text-foreground" : "text-muted-foreground")}>
                  {d.label}
                </span>
                <span className="text-muted-foreground">{d.tag}</span>
              </dt>
              <dd className={cn("mt-0.5 text-sm leading-snug", current ? "text-foreground" : "text-muted-foreground")}>
                {d.definition}
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

/** The eight penalty cards as a compact list; tapping one shows the full card. */
function FallaciesTab() {
  const [openId, setOpenId] = useState<FallacyId | null>(null);
  return (
    <ul className="mt-2 space-y-1.5" data-testid="cheatsheet-fallacies">
      {FALLACY_IDS.map((id) => {
        const f = FALLACIES[id];
        const open = openId === id;
        return (
          <li key={id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : id)}
              className="flex w-full items-start gap-1.5 rounded text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn("mt-1 h-2 w-2 shrink-0 rounded-sm", f.card === "red" ? "bg-[#D63030]" : "bg-[#E8C840]")}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">{f.name}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{f.definition}</span>
              </span>
            </button>
            {open && <FallacyCard id={id} className="mt-2" />}
          </li>
        );
      })}
    </ul>
  );
}

export function CliCheatSheet({ stage, className }: { stage: FlowStage; className?: string }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("cli");

  useEffect(() => {
    setOpen(cheatSheetDefaultOpen(window.localStorage));
  }, []);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      window.localStorage.setItem(CHEATSHEET_STORAGE_KEY, next ? "open" : "closed");
      return next;
    });
  }

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold",
        tab === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <section
      data-testid="cli-cheatsheet"
      data-open={open}
      className={cn(
        "rounded-xl border transition-colors",
        open ? "border-primary/30 bg-[#E3EBF7] shadow-sm" : "border-border bg-muted/30",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide",
          open ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>📖</span> Quick reference
        </span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="min-h-[22rem] px-4 pb-4">
          <div role="tablist" aria-label="Quick reference sections" className="flex gap-1 rounded-md bg-white/60 p-0.5">
            {tabButton("cli", "Claim · Link · Impact")}
            {tabButton("fallacies", "Fallacies")}
          </div>
          {tab === "cli" ? <CliTab stage={stage} /> : <FallaciesTab />}
        </div>
      )}
    </section>
  );
}
