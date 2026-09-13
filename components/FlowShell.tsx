"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion as m } from "motion/react";
import { transitions } from "@/lib/motion";
import { useFlowProgress } from "@/lib/state/useFlowProgress";
import { claimToScenario } from "@/lib/flowMotions";
import { otherSideUnlocked, type FlowStage, type Side } from "@/lib/state/flowMachine";
import { KeyTermsStrip } from "@/components/steps/KeyTermsStrip";
import { CliCheatSheet } from "@/components/CliCheatSheet";
import { ClaimStage } from "@/components/stages/ClaimStage";
import { ChoiceStage } from "@/components/stages/ChoiceStage";
import { strongChoice } from "@/lib/choices";
import { ImpactStage } from "@/components/stages/ImpactStage";
import { LinkCard } from "@/components/LinkCard";
import { FlowRail } from "@/components/FlowRail";
import { StageHeader } from "@/components/stages/StageHeader";
import { AppShell } from "@/components/ui/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HelperContextProvider,
  usePublishHelperContext,
} from "@/components/helper/HelperContextProvider";
import { HelperPanel } from "@/components/helper/HelperPanel";
import type { FlowMotion } from "@/lib/schemas";

export function FlowShell(props: { motion: FlowMotion; startSide?: Side; onExit: () => void }) {
  return (
    <HelperContextProvider>
      <FlowShellInner {...props} />
      <HelperPanel />
    </HelperContextProvider>
  );
}

function FlowShellInner({
  motion,
  startSide = "for",
  onExit,
}: {
  motion: FlowMotion;
  startSide?: Side;
  onExit: () => void;
}) {
  const [progress, update, hydrated] = useFlowProgress(motion.id, startSide);
  // Browsing a completed stage from the rail never touches `progress` — it's a
  // look-back, not navigation, so nothing here can push you backward or forward.
  const [viewStage, setViewStage] = useState<FlowStage | null>(null);
  const returnToWhereYouWere = () => setViewStage(null);
  usePublishHelperContext({
    activity: "journey",
    motion: motion.motion,
    side: progress.side,
    stage: progress.stage,
  });
  const sideClaims = motion.sides[progress.side].claims;
  const mappedClaim = sideClaims.find((c) => c.id === progress.mappedClaimId) ?? null;
  const claimChoices = motion.sides[progress.side].claimChoices ?? null;
  const impactChoices = mappedClaim?.impactChoices ?? null;

  /** Seeded motions ship pick-the-best options; generated motions (no choices)
   *  keep the open-input coached stage. */
  function claimStage() {
    if (claimChoices) {
      return (
        <ChoiceStage
          part="claim"
          eyebrow="Stage 1 · Claim"
          prompt={`Which is the strongest claim ${progress.side === "for" ? "for" : "against"} this motion?`}
          motion={motion.motion}
          side={progress.side}
          choices={claimChoices}
          seed={`${motion.id}:${progress.side}:claim`}
          continueLabel="Build the link →"
          onComplete={() => update({ mappedClaimId: strongChoice(claimChoices).claimId ?? null, stage: "link" })}
        />
      );
    }
    return (
      <ClaimStage
        motion={motion.motion}
        side={progress.side}
        claims={sideClaims.map((c) => ({ id: c.id, claim: c.claim }))}
        onComplete={(mappedClaimId) => update({ mappedClaimId, stage: "link" })}
      />
    );
  }

  function finishSide(impact: string) {
    update({
      impact,
      forComplete: progress.side === "for" ? true : progress.forComplete,
      againstComplete: progress.side === "against" ? true : progress.againstComplete,
    });
  }

  function impactStage(claim: NonNullable<typeof mappedClaim>) {
    if (impactChoices) {
      return (
        <ChoiceStage
          part="impact"
          eyebrow="Stage 3 · Impact"
          prompt="Which impact shows why your argument matters?"
          motion={motion.motion}
          side={progress.side}
          claim={claim.claim}
          choices={impactChoices}
          seed={`${motion.id}:${claim.id}:impact`}
          context={
            <div className="mb-4 rounded-lg border border-evidence bg-evidence/10 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your claim</div>
              <p className="mt-0.5 font-medium text-foreground">{claim.claim}</p>
            </div>
          }
          continueLabel="Finish this side ✓"
          onComplete={(chosen) => finishSide(chosen.text)}
        />
      );
    }
    return (
      <ImpactStage
        motion={motion.motion}
        claim={claim.claim}
        authoredImpact={claim.impact}
        onComplete={finishSide}
      />
    );
  }

  const otherSide: Side = progress.side === "for" ? "against" : "for";
  const isComplete = (s: Side) => (s === "for" ? progress.forComplete : progress.againstComplete);
  const label = (s: Side) => (s === "for" ? "FOR" : "AGAINST");

  function pill(s: Side) {
    if (isComplete(s)) return <Badge key={s} variant="success">✓ {label(s)}</Badge>;
    if (progress.side === s) return <Badge key={s} variant="default">{label(s)}</Badge>;
    if (otherSideUnlocked(progress)) return <Badge key={s} variant="secondary">{label(s)}</Badge>;
    return <Badge key={s} variant="outline">🔒 {label(s)} · Part 2</Badge>;
  }

  const bothComplete = progress.forComplete && progress.againstComplete;
  const currentSideDone = isComplete(progress.side) && !bothComplete;

  // Fire the both-sides celebration once per transition into "bothComplete",
  // not on every re-render while it stays complete.
  const [celebrationId, setCelebrationId] = useState(0);
  const wasBothCompleteRef = useRef(false);
  useEffect(() => {
    if (bothComplete && !wasBothCompleteRef.current) {
      setCelebrationId((n) => n + 1);
    }
    wasBothCompleteRef.current = bothComplete;
  }, [bothComplete]);

  return (
    <AppShell layout="wide">
      <Card className="flex min-h-[70vh] flex-col overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div>
            <Button variant="ghost" size="sm" onClick={onExit} className="mb-1 h-8 px-2 text-muted-foreground">
              ← Motions
            </Button>
            <div className="font-display text-lg font-semibold leading-snug text-foreground sm:text-xl">
              {motion.motion}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {pill("for")}
            {pill("against")}
          </div>
        </div>

        <div className="flex flex-1 flex-col md:flex-row">
          <FlowRail stage={progress.stage} onSelect={setViewStage}>
            <CliCheatSheet stage={viewStage ?? progress.stage} />
          </FlowRail>
          <div className="min-w-0 flex-1 p-5 sm:p-6">
            <AnimatePresence mode="wait">
              {hydrated && (
              <m.div
                key={viewStage ? `view-${viewStage}` : progress.stage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.snappy}
              >
                {viewStage === "claim" ? (
                  <ClaimRecap side={progress.side} claim={mappedClaim?.claim ?? null} onReturn={returnToWhereYouWere} />
                ) : viewStage === "link" ? (
                  <div>
                    <RevisitBanner onReturn={returnToWhereYouWere} />
                    {mappedClaim ? (
                      <LinkCard scenario={claimToScenario(motion.id, mappedClaim)} onComplete={returnToWhereYouWere} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Your earlier claim isn&apos;t available anymore.</p>
                    )}
                  </div>
                ) : bothComplete ? (
                  <div className="mx-auto max-w-md py-8 text-center">
                    <m.div
                      key={celebrationId}
                      data-testid="both-sides-celebration"
                      aria-hidden="true"
                      className="text-4xl leading-none"
                      initial={{ opacity: 0, scale: 0.4, rotate: -10 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      transition={transitions.spring}
                    >
                      🏆
                    </m.div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary">
                      Complete
                    </div>
                    <p className="mt-2 font-display text-xl font-semibold text-foreground">
                      You&apos;ve argued both sides of this motion — FOR and AGAINST.{" "}
                      <span aria-hidden>🎉</span>
                    </p>
                    <Button variant="secondary" className="mt-4" onClick={onExit}>
                      ← back to motions
                    </Button>
                  </div>
                ) : currentSideDone ? (
                  <div className="mx-auto max-w-md py-8 text-center">
                    <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                      {label(progress.side)} side complete
                    </div>
                    <p className="mt-2 text-lg text-foreground">
                      Nice — you built the {label(progress.side)} case: claim, link, and impact. Now flip
                      it and argue the other side.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button
                        onClick={() =>
                          update({ side: otherSide, stage: "claim", mappedClaimId: null, impact: "" })
                        }
                      >
                        Now argue the other side →
                      </Button>
                      <Button variant="ghost" onClick={onExit}>
                        ← back to motions
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {progress.stage === "claim" && (
                      <>
                        <KeyTermsStrip motion={motion.motion} keywords={motion.keywords} />
                        {claimStage()}
                      </>
                    )}
                    {(progress.stage === "link" || progress.stage === "impact") && !mappedClaim && claimStage()}
                    {progress.stage === "link" && mappedClaim && (
                      <LinkCard
                        scenario={claimToScenario(motion.id, mappedClaim)}
                        onComplete={() => update({ stage: "impact" })}
                      />
                    )}
                    {progress.stage === "impact" && mappedClaim && impactStage(mappedClaim)}
                  </>
                )}
              </m.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}

function RevisitBanner({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <span className="font-medium text-muted-foreground">Revisiting a completed stage — your progress is safe.</span>
      <Button type="button" variant="ghost" size="sm" onClick={onReturn}>
        ← Back to where you were
      </Button>
    </div>
  );
}

function ClaimRecap({
  side,
  claim,
  onReturn,
}: {
  side: Side;
  claim: string | null;
  onReturn: () => void;
}) {
  return (
    <div>
      <RevisitBanner onReturn={onReturn} />
      <StageHeader eyebrow="Stage 1 · Claim" />
      {claim ? (
        <>
          <p className="text-sm text-muted-foreground">
            Your claim {side === "for" ? "for" : "against"} this motion:
          </p>
          <div className="mt-3 rounded-lg border border-evidence bg-evidence/10 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your claim</div>
            <p className="mt-0.5 font-medium text-foreground">{claim}</p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Your earlier claim isn&apos;t available anymore.</p>
      )}
    </div>
  );
}
