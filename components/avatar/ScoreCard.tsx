"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AvatarMode, InlineScore, RoundScore } from "@/lib/avatar/types";

const CRITERIA_LABELS: Record<string, string> = {
  claim: "Claim",
  link: "Link",
  impact: "Impact",
  weighing: "Weighing",
  breadth: "Breadth",
  depth: "Depth",
  responsive: "Responsive",
  crystallizing: "Crystallizing",
};

function ScoreCell({
  label,
  score,
  isFocus,
  rationale,
}: {
  label: string;
  score: number;
  isFocus: boolean;
  rationale?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3", isFocus ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className={cn("text-sm font-semibold", score >= 2 ? "text-emerald-600" : score === 1 ? "text-amber-600" : "text-red-500")}>
          {score}/3
        </span>
      </div>
      {rationale && <p className="mt-1 text-xs text-muted-foreground">{rationale}</p>}
    </div>
  );
}

export function ScoreCard({
  mode,
  roundScores,
  inlineScores = [],
  finished = false,
  onContinue,
  onEnd,
}: {
  mode: AvatarMode;
  roundScores: RoundScore[];
  /** Inline badges (pushback, Mode C debate) summarised when there is no round score. */
  inlineScores?: InlineScore[];
  /** The session is over: offer "Done" instead of "Next round". */
  finished?: boolean;
  onContinue: () => void;
  onEnd: () => void;
}) {
  const latest = roundScores[roundScores.length - 1];
  if (!latest) {
    if (inlineScores.length === 0) return null;
    return (
      <div className="space-y-6 py-6">
        <h3 className="font-display text-lg font-semibold text-foreground">
          {mode === "pushback" ? "Pushback session" : "Session"} summary
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {inlineScores.map((s, i) => (
            <ScoreCell key={i} label={CRITERIA_LABELS[s.criterion] ?? s.criterion} score={s.score} isFocus={false} rationale={s.rationale} />
          ))}
        </div>
        <div className="flex gap-3">
          <Button onClick={onEnd}>Done</Button>
        </div>
      </div>
    );
  }

  const argEntries = Object.entries(latest.argumentation) as [string, number][];
  const engEntries = Object.entries(latest.engagement) as [string, number][];

  return (
    <div className="space-y-6 py-6">
      <div>
        <h3 className="font-display text-lg font-semibold text-foreground">
          Round {latest.round} Score
        </h3>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">Argumentation</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {argEntries.map(([key, score]) => (
            <ScoreCell
              key={key}
              label={CRITERIA_LABELS[key] ?? key}
              score={score}
              isFocus={key === latest.focusArea}
              rationale={latest.rationales[key]}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">Engagement</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {engEntries.map(([key, score]) => (
            <ScoreCell
              key={key}
              label={CRITERIA_LABELS[key] ?? key}
              score={score}
              isFocus={key === latest.focusArea}
              rationale={latest.rationales[key]}
            />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-primary bg-primary/5 p-4">
        <div className="text-sm font-semibold text-foreground">Your focus for next time is highlighted above.</div>
        <p className="mt-1 text-sm text-muted-foreground">{latest.focusTip}</p>
      </div>

      <div className="flex gap-3">
        {finished ? (
          <Button onClick={onEnd}>Done</Button>
        ) : (
          <>
            <Button onClick={onContinue}>Next round →</Button>
            <Button variant="outline" onClick={onEnd}>End session</Button>
          </>
        )}
      </div>
    </div>
  );
}
