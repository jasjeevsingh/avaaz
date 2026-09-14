import type { AvatarMode, AvatarSession, AvatarTurn, Cohort, Side } from "@/lib/avatar/types";
import { getModeConfig } from "@/lib/avatar/cohortAdapter";

/**
 * Pure session logic for the live avatar. The voice agent replies on its own
 * every time the student stops talking, so the app no longer decides *when*
 * the avatar speaks; it only observes turns and decides when a round ends,
 * what to score, and when the session is over.
 */

export const EXCHANGES_PER_ROUND: Record<AvatarMode, number> = {
  sparring: 3,
  pushback: Infinity,
  collaborative: 2,
};

export function initSession(
  mode: AvatarMode,
  motion: string,
  motionId: string,
  cohort: Cohort,
  studentSide: Side,
  opts: { avatarOpens?: boolean } = {},
): AvatarSession {
  const config = getModeConfig(mode, cohort);
  const sameSide = mode === "collaborative";
  return {
    id: "",
    mode,
    motionId,
    motionText: motion,
    cohort,
    studentSide,
    avatarSide: sameSide ? studentSide : studentSide === "for" ? "against" : "for",
    transcript: [],
    inlineScores: [],
    roundScores: [],
    phase: mode === "collaborative" ? "collaborative" : "debate",
    currentRound: 1,
    totalRounds: config.rounds,
    roundStart: 0,
    avatarOpens: mode === "sparring" ? (opts.avatarOpens ?? Math.random() < 0.5) : false,
    startedAt: 0,
    endedAt: null,
  };
}

export type ScoreAction = {
  type: "score";
  scoreType: "round" | "inline";
  criteria: ("argumentation" | "engagement")[];
  slice: [number, number];
  /** Transcript index the inline badge attaches to (the student's turn). */
  turnIndex: number;
};

export type TurnAction = ScoreAction | { type: "roundComplete" } | { type: "sessionComplete" };

export type TurnOutcome = { session: AvatarSession; actions: TurnAction[] };

/** Number of avatar replies in the current round window (an avatar turn that
 *  follows a student turn; an opening statement is not an exchange). */
export function exchangesInRound(s: AvatarSession): number {
  const window = s.transcript.slice(s.roundStart);
  let n = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].speaker === "avatar" && window[i - 1].speaker === "student") n++;
  }
  return n;
}

export function appendTurn(session: AvatarSession, speaker: AvatarTurn["speaker"], text: string): TurnOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { session, actions: [] };
  const turn: AvatarTurn = {
    speaker,
    text: trimmed,
    timestampMs: session.startedAt ? Date.now() - session.startedAt : 0,
    durationMs: 0,
  };
  const s: AvatarSession = { ...session, transcript: [...session.transcript, turn] };
  const actions: TurnAction[] = [];
  const len = s.transcript.length;
  const lastStudentIndex = (() => {
    for (let i = len - 1; i >= 0; i--) if (s.transcript[i].speaker === "student") return i;
    return -1;
  })();

  if (speaker !== "avatar" || lastStudentIndex < 0) return { session: s, actions };
  // Everything below fires once an exchange completes (student spoke, avatar replied).

  const exchanges = exchangesInRound(s);
  const roundDone = exchanges >= EXCHANGES_PER_ROUND[s.mode];

  if (s.mode === "pushback") {
    actions.push({
      type: "score",
      scoreType: "inline",
      criteria: ["argumentation"],
      slice: [Math.max(0, lastStudentIndex - 1), len],
      turnIndex: lastStudentIndex,
    });
    return { session: s, actions };
  }

  if (s.mode === "collaborative" && s.phase === "collaborative") return { session: s, actions };

  if (s.mode === "collaborative" && !roundDone) {
    actions.push({
      type: "score",
      scoreType: "inline",
      criteria: ["engagement"],
      slice: [lastStudentIndex, len],
      turnIndex: lastStudentIndex,
    });
    return { session: s, actions };
  }

  if (roundDone) {
    actions.push({
      type: "score",
      scoreType: "round",
      criteria: s.mode === "collaborative" ? ["engagement"] : ["argumentation", "engagement"],
      slice: [s.roundStart, len],
      turnIndex: lastStudentIndex,
    });
    actions.push({ type: "roundComplete" });
    if (s.currentRound >= s.totalRounds) actions.push({ type: "sessionComplete" });
  }
  return { session: s, actions };
}

export function advanceRound(s: AvatarSession): AvatarSession {
  return { ...s, currentRound: s.currentRound + 1, roundStart: s.transcript.length };
}

/** Mode C: flip the avatar to the opposing side and start the debate phase. */
export function startDebatePhase(s: AvatarSession): AvatarSession {
  return {
    ...s,
    phase: "debate",
    avatarSide: s.studentSide === "for" ? "against" : "for",
    currentRound: 1,
    roundStart: s.transcript.length,
  };
}

/** True once the student has produced enough while building to be worth debating. */
export function readyToDebate(s: AvatarSession): boolean {
  return s.mode === "collaborative" && s.phase === "collaborative" && s.transcript.filter((t) => t.speaker === "student").length >= 2;
}
