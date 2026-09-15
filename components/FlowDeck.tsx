"use client";
import { useEffect, useState } from "react";
import { getFlowMotions } from "@/lib/flowMotions";
import { FlowShell } from "@/components/FlowShell";
import { AppShell } from "@/components/ui/app-shell";
import { SectionBand } from "@/components/ui/section-band";
import { Landing } from "@/components/Landing";
import { Lesson } from "@/components/Lesson";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UniverseGenerator } from "@/components/UniverseGenerator";
import { PracticeDeck } from "@/components/PracticeDeck";
import { PracticeShell } from "@/components/PracticeShell";
import { AvatarShell } from "@/components/avatar/AvatarShell";
import type { PracticePart } from "@/lib/practice";
import type { FlowMotion } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Pressable } from "@/components/ui/motion";
import type { Side } from "@/lib/state/flowMachine";
import {
  loadAllFlowProgress,
  motionStatus,
  hasFlowProgress,
  type MotionStatus,
  type FlowProgress,
} from "@/lib/state/flowProgress";

const STATUS_META: Record<
  MotionStatus,
  { label: string; badge: string; variant: "secondary" | "default" | "success"; cta: string }
> = {
  "not-started": { label: "Not started", badge: "New", variant: "secondary", cta: "Start" },
  "in-progress": { label: "In progress", badge: "In progress", variant: "default", cta: "Resume" },
  "one-side-done": { label: "One side done", badge: "1 side done", variant: "default", cta: "Resume" },
  complete: { label: "Both sides done", badge: "✓ Both sides", variant: "success", cta: "Review" },
};

type Opened = { motion: FlowMotion; side: Side };

/** Decorative suspension bridge in the retreat's gold, low in the navy band. */
function BridgeSilhouette() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 220"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-44 w-full text-[var(--gold)] opacity-25"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    >
      <path d="M0 160 H1200" strokeWidth="6" />
      <path d="M300 30 V160 M900 30 V160" strokeWidth="8" />
      <path d="M0 40 Q300 170 600 130 T1200 40" strokeWidth="4" />
      {Array.from({ length: 23 }, (_, i) => 50 + i * 50).map((x) => {
        const t = x / 1200;
        const y = t < 0.5 ? 40 + (130 - 40) * Math.sin(Math.PI * t) : 130 - (130 - 40) * Math.sin(Math.PI * (t - 0.5));
        return <path key={x} d={`M${x} ${y} V160`} strokeWidth="2" />;
      })}
      <path d="M0 220 L120 175 L260 200 L380 170 L520 205 L680 180 L820 210 L960 175 L1100 200 L1200 185 V220 Z" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  );
}

export const TUTORIAL_URL = "https://www.loom.com/share/a4f9ac5bb1bc4722aa039637a49b908d";

function TutorialLink() {
  return (
    <a
      href={TUTORIAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
      Watch the tutorial
    </a>
  );
}

export function FlowDeck() {
  const motions = getFlowMotions();
  const [active, setActive] = useState<Opened | null>(null);
  const [choosing, setChoosing] = useState<FlowMotion | null>(null);
  const [practicePart, setPracticePart] = useState<PracticePart | null>(null);
  const [progress, setProgress] = useState<Record<string, FlowProgress>>({});
  const [showLesson, setShowLesson] = useState(false);
  const [showAvatar, setShowAvatar] = useState(false);

  useEffect(() => {
    setProgress(loadAllFlowProgress(window.localStorage));
  }, []);

  /** Resume in place if the motion is already started; otherwise ask which side first. */
  function open(m: FlowMotion) {
    if (hasFlowProgress(window.localStorage, m.id)) {
      setActive({ motion: m, side: "for" }); // ignored — saved progress wins
      return;
    }
    setChoosing(m);
  }

  if (active) {
    return (
      <FlowShell
        motion={active.motion}
        startSide={active.side}
        onExit={() => {
          // Progress was written to localStorage during the journey (e.g. a side just got
          // completed) — re-read it so the deck's badges aren't stale on return.
          setProgress(loadAllFlowProgress(window.localStorage));
          setActive(null);
        }}
      />
    );
  }
  if (practicePart) return <PracticeShell part={practicePart} onExit={() => setPracticePart(null)} />;
  if (showLesson) {
    return (
      <AppShell>
        <Lesson onBack={() => setShowLesson(false)} />
      </AppShell>
    );
  }
  if (showAvatar) return <AvatarShell onExit={() => setShowAvatar(false)} />;
  if (choosing) {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg py-10 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            Pick your starting side
          </div>
          <h2 className="mt-2 font-display text-2xl font-semibold leading-snug text-foreground">
            {choosing.motion}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Which side do you want to argue first? You&apos;ll argue the other side as Part 2.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={() => { setActive({ motion: choosing, side: "for" }); setChoosing(null); }}>
              Argue FOR first
            </Button>
            <Button onClick={() => { setActive({ motion: choosing, side: "against" }); setChoosing(null); }}>
              Argue AGAINST first
            </Button>
          </div>
          <Button variant="ghost" className="mt-4 text-muted-foreground" onClick={() => setChoosing(null)}>
            ← back to motions
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell layout="full" headerAction={<TutorialLink />}>
      <div className="mx-auto max-w-5xl px-4 pb-14 pt-10 sm:px-6 sm:pt-12">
        <Landing onOpenLesson={() => setShowLesson(true)} />
      </div>

      <SectionBand
        tone="sky"
        eyebrow="Step 2 · Build core skills"
        title="Pick a motion"
        blurb="Argue both sides of a motion. Choose the strongest claim, build the link, and pick the impact that shows why it matters."
      >
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {motions.map((m, i) => {
            const status = motionStatus(progress[m.id]);
            const meta = STATUS_META[status];
            return (
              <Pressable
                key={m.id}
                index={i}
                type="button"
                onClick={() => open(m)}
                aria-label={`${m.motion} — ${meta.label}`}
                className={cn(
                  "group flex flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  status === "complete" && "ring-1 ring-success"
                )}
              >
                <Badge variant={meta.variant} className="self-start">
                  {meta.badge}
                </Badge>
                <div className="mt-3 font-display text-lg font-semibold leading-snug text-foreground">
                  {m.motion}
                </div>
                <div className="mt-auto pt-4 text-sm font-semibold text-primary">{meta.cta} →</div>
              </Pressable>
            );
          })}
        </div>
      </SectionBand>

      <SectionBand
        tone="sand"
        eyebrow="Step 2 · Guided reps"
        title="Practice a skill"
        blurb="Drill one part of the framework with quick reps."
      >
        <PracticeDeck onPick={setPracticePart} />
      </SectionBand>

      <SectionBand
        tone="gold"
        eyebrow="Step 3 · Your own universe"
        title="Bring your own universe"
        blurb="This is where you write your own claims, links, and impacts. Name a book, show, or game you love and we'll build debates from it."
      >
        <UniverseGenerator onOpen={(m, side) => setActive({ motion: m, side })} />
      </SectionBand>

      <SectionBand
        tone="navy"
        eyebrow="Step 4 · Spar with an AI"
        title="Debate Avatar"
        blurb="A live voice call with an AI opponent. Spar for three scored rounds, get your argument stress-tested question by question, or build a case together and then defend it."
        className="relative overflow-hidden"
      >
        <Button type="button" variant="secondary" className="mt-6" onClick={() => setShowAvatar(true)}>
          Debate Avatar →
        </Button>
        <BridgeSilhouette />
        <p className="relative mt-24 text-xs text-[var(--dim)]">
          Constructive · Claim → Link → Impact · Built for the MPLR debate retreat
        </p>
      </SectionBand>
    </AppShell>
  );
}
