"use client";
import { useEffect, useState } from "react";
import { getFlowMotions } from "@/lib/flowMotions";
import { drawItem, type PracticePart, type PracticeItem } from "@/lib/practice";
import type { Side } from "@/lib/state/flowMachine";
import { loadPracticeCounts, incrementPracticeCount } from "@/lib/state/practiceProgress";
import { ClaimStage } from "@/components/stages/ClaimStage";
import { ImpactStage } from "@/components/stages/ImpactStage";
import { LinkCard } from "@/components/LinkCard";
import { AppShell } from "@/components/ui/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HelperContextProvider,
  usePublishHelperContext,
} from "@/components/helper/HelperContextProvider";
import { HelperPanel } from "@/components/helper/HelperPanel";

const TITLES: Record<PracticePart, string> = {
  claim: "Practice: Claims",
  link: "Practice: the Link",
  impact: "Practice: Impacts",
};

export function PracticeShell(props: { part: PracticePart; onExit: () => void }) {
  return (
    <HelperContextProvider>
      <PracticeShellInner {...props} />
      <HelperPanel />
    </HelperContextProvider>
  );
}

/** Only the claim variant of a PracticeItem carries a side — the link variant
 *  drills the bridge between a claim and its impact and has none. */
export function sideForPracticeItem(item: PracticeItem): Side | null {
  return item.part === "claim" ? item.side : null;
}

function PracticeShellInner({ part, onExit }: { part: PracticePart; onExit: () => void }) {
  const [item, setItem] = useState<PracticeItem>(() => drawItem(part, getFlowMotions()));
  const [done, setDone] = useState(false);
  const [count, setCount] = useState(0);

  usePublishHelperContext({
    activity: "practice",
    stage: part,
    motion: item.motion,
    side: sideForPracticeItem(item),
  });

  useEffect(() => {
    setCount(loadPracticeCounts(window.localStorage)[part]);
  }, [part]);

  function finishRep() {
    setCount(incrementPracticeCount(window.localStorage, part)[part]);
    setDone(true);
  }

  function nextRep() {
    setItem(drawItem(part, getFlowMotions()));
    setDone(false);
  }

  const drilledClaim = item.part === "link" ? item.scenario.claim : null;

  return (
    <AppShell layout="wide">
      <Card className="flex min-h-[70vh] flex-col overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div>
            <Button variant="ghost" size="sm" onClick={onExit} className="mb-1 h-8 px-2 text-muted-foreground">
              ← Practice
            </Button>
            <div className="font-display text-lg font-semibold leading-snug text-foreground sm:text-xl">
              {TITLES[part]}
            </div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{item.motion}</p>
            {drilledClaim && (
              <p className="mt-1 max-w-xl text-sm text-foreground">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Building on: </span>
                {drilledClaim}
              </p>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0">{count} done</Badge>
        </div>

        <div className="min-w-0 flex-1 p-5 sm:p-6">
          {done ? (
            <div className="mx-auto max-w-md py-8 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">Nice rep!</div>
              <p className="mt-2 font-display text-xl font-semibold text-foreground">One more?</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button onClick={nextRep}>Next rep →</Button>
                <Button variant="ghost" onClick={onExit}>← Back</Button>
              </div>
            </div>
          ) : item.part === "claim" ? (
            <ClaimStage motion={item.motion} side={item.side} claims={item.claims} onComplete={finishRep} />
          ) : item.part === "link" ? (
            <LinkCard scenario={item.scenario} onComplete={finishRep} />
          ) : (
            <ImpactStage
              motion={item.motion}
              claim={item.claim}
              authoredImpact={item.authoredImpact}
              onComplete={finishRep}
            />
          )}
        </div>
      </Card>
    </AppShell>
  );
}
