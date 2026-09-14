import { z } from "zod";
import type { ChatTurn } from "@/lib/ai/claude";
import type { Side } from "@/lib/state/flowMachine";

export type AvatarMode = "sparring" | "pushback" | "collaborative";
export type Cohort = "surat" | "darshan" | "pyaas";
export type { Side };
export type Speaker = "student" | "avatar";

export interface AvatarTurn {
  speaker: Speaker;
  text: string;
  timestampMs: number;
  durationMs: number;
}

export interface InlineScore {
  criterion: string;
  score: number;
  rationale: string;
  turnIndex: number;
}

export interface RoundScore {
  round: number;
  argumentation: { claim: number; link: number; impact: number; weighing: number };
  engagement: { breadth: number; depth: number; responsive: number; crystallizing: number };
  rationales: Record<string, string>;
  focusArea: string;
  focusTip: string;
}

export interface AvatarSession {
  id: string;
  mode: AvatarMode;
  motionId: string;
  motionText: string;
  cohort: Cohort;
  studentSide: Side;
  avatarSide: Side;
  transcript: AvatarTurn[];
  inlineScores: InlineScore[];
  roundScores: RoundScore[];
  phase: "collaborative" | "debate" | "review";
  currentRound: number;
  totalRounds: number;
  /** Transcript index where the current round (or debate phase) began. */
  roundStart: number;
  /** Sparring coin flip: the avatar delivers the opening statement. */
  avatarOpens: boolean;
  startedAt: number;
  endedAt: number | null;
}

export interface ModeConfig {
  turnDurationSec: number;
  wordLimit: number;
  rounds: number;
  prepPauseSec: number;
  scaffoldingLevel: "high" | "medium" | "low";
}

export interface TurnResult {
  avatarShouldRespond: boolean;
  shouldScore: boolean;
  scoreCriteria?: ("argumentation" | "engagement")[];
  scoreSlice?: [number, number];
  roundComplete?: boolean;
  phaseTransition?: AvatarSession["phase"];
  sessionComplete?: boolean;
}

const scoreField = z.number().int().min(0).max(3);

export const InlineScoreSchema = z.object({
  criterion: z.string().min(1),
  score: scoreField,
  rationale: z.string().min(1),
});

export const RoundScoreSchema = z.object({
  argumentation: z.object({
    claim: scoreField,
    link: scoreField,
    impact: scoreField,
    weighing: scoreField,
  }),
  engagement: z.object({
    breadth: scoreField,
    depth: scoreField,
    responsive: scoreField,
    crystallizing: scoreField,
  }),
  rationales: z.record(z.string(), z.string()),
  focusArea: z.string().min(1),
  focusTip: z.string().min(1),
});

export type AvatarTurnRequest = {
  mode: AvatarMode;
  phase: AvatarSession["phase"];
  motion: string;
  cohort: Cohort;
  avatarSide: Side;
  studentSide: Side;
  transcript: AvatarTurn[];
  collaborativeArgs?: string[];
};

export type AvatarScoreRequest = {
  mode: AvatarMode;
  transcript: AvatarTurn[];
  criteria: ("argumentation" | "engagement")[];
  cohort: Cohort;
};

export function transcriptToHistory(transcript: AvatarTurn[]): ChatTurn[] {
  return transcript.map((t) => ({
    role: t.speaker === "student" ? ("user" as const) : ("assistant" as const),
    content: t.text,
  }));
}
