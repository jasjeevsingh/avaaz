"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { ModeCard } from "@/components/avatar/ModeCard";
import { TranscriptPane } from "@/components/avatar/TranscriptPane";
import { AvatarVoiceBar } from "@/components/avatar/AvatarVoiceBar";
import { ScoreCard } from "@/components/avatar/ScoreCard";
import { getFlowMotions } from "@/lib/flowMotions";
import { saveAvatarSession } from "@/lib/state/avatarSession";
import { createAudioQueue } from "@/lib/helper/audioQueue";
import { startMicCapture } from "@/lib/voice/micCapture";
import { openAgentSocket } from "@/lib/voice/agentSocket";
import { speakCoach, stopSpeech } from "@/lib/voice/playSpeech";
import {
  createAvatarAgent,
  type AgentPhase,
  type AvatarAgent,
  type AvatarAgentDeps,
} from "@/lib/avatar/avatarAgent";
import { avatarGreeting, buildAvatarAgentPrompt } from "@/lib/avatar/agentPrompt";
import {
  advanceRound,
  appendTurn,
  initSession,
  readyToDebate,
  startDebatePhase,
  type TurnAction,
} from "@/lib/avatar/sessionReducer";
import type { AvatarMode, AvatarSession, AvatarTurnRequest } from "@/lib/avatar/types";
import type { FlowMotion } from "@/lib/schemas";
import type { Side } from "@/lib/state/flowMachine";
import { cn } from "@/lib/utils";

const MODES: { mode: AvatarMode; title: string; description: string; how: string[]; tip: string }[] = [
  {
    mode: "sparring",
    title: "Sparring",
    description: "A real opponent. Three rounds, scored after each.",
    how: [
      "You pick a side; the avatar argues the other one and plays to win.",
      "A coin flip decides who opens. Then you simply take turns talking — no buttons.",
      "Three exchanges make a round. After each round you get a scorecard on your claims, links, impacts, and how well you engaged.",
      "Three rounds, then a final summary with one thing to work on next.",
    ],
    tip: "Rebut what the avatar just said before adding your own point.",
  },
  {
    mode: "pushback",
    title: "Pushback Coach",
    description: "Stress-test one argument, question by question.",
    how: [
      "State your strongest claim on the motion.",
      "The avatar finds the weakest part — your claim, your link, or your impact — and asks one sharp question about it.",
      "Answer, and it either moves to the next weak spot or pushes harder.",
      "Each exchange gets a small badge showing which part got stronger. Hang up whenever you're done.",
    ],
    tip: "Bring a piece of evidence; the coach will ask for one.",
  },
  {
    mode: "collaborative",
    title: "Build + Debate",
    description: "Build your case together, then face off.",
    how: [
      "Phase 1, Build: the avatar is on your side and helps you shape two or three complete arguments.",
      "When you're ready, hit 'Ready to debate'.",
      "Phase 2, Debate: the avatar switches sides and argues against the case you built together.",
      "Two exchanges make a round; you're scored on how well you respond and go deep.",
    ],
    tip: "Say the parts you're unsure about out loud in Phase 1 — that's what the coach is for.",
  },
];

type Step = "mode" | "intro" | "motion" | "side" | "session" | "transition" | "review";

// Cost guards, same shape as the voice helper.
const KEEP_ALIVE_MS = 5_000;
const IDLE_TIMEOUT_MS = 3 * 60_000;
const SESSION_CAP_MS = 15 * 60_000;

export type AgentFactory = (deps: AvatarAgentDeps) => AvatarAgent;
export type MicStarter = typeof startMicCapture;

function defaultAgentFactory(deps: AvatarAgentDeps): AvatarAgent {
  return createAvatarAgent(deps);
}

/** Generated line for the avatar to open with (sparring coin flip, or the
 *  Mode C side switch) via the existing turn endpoint. Empty on failure. */
async function fetchOpening(s: AvatarSession): Promise<string> {
  const req: AvatarTurnRequest = {
    mode: s.mode,
    phase: s.phase,
    motion: s.motionText,
    cohort: s.cohort,
    avatarSide: s.avatarSide,
    studentSide: s.studentSide,
    transcript: s.transcript,
    collaborativeArgs:
      s.mode === "collaborative" ? s.transcript.filter((t) => t.speaker === "student").map((t) => t.text) : undefined,
  };
  try {
    const res = await fetch("/api/avatar/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  } catch {
    return "";
  }
}

export function AvatarShell({
  onExit,
  agentFactory = defaultAgentFactory,
  startMic = startMicCapture,
}: {
  onExit: () => void;
  /** Test seam: build the live agent from injected deps. */
  agentFactory?: AgentFactory;
  /** Test seam: microphone capture. */
  startMic?: MicStarter;
}) {
  const motions = getFlowMotions();
  const [step, setStep] = useState<Step>("mode");
  const [selectedMode, setSelectedMode] = useState<AvatarMode | null>(null);
  const [selectedMotion, setSelectedMotion] = useState<FlowMotion | null>(null);
  const [session, setSession] = useState<AvatarSession | null>(null);
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [muted, setMuted] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const sessionRef = useRef<AvatarSession | null>(null);
  const agentRef = useRef<AvatarAgent | null>(null);
  const agentLiveRef = useRef(false);
  const micRef = useRef<{ stop: () => void } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<Step>("mode");
  stepRef.current = step;

  function commit(next: AvatarSession) {
    sessionRef.current = next;
    setSession(next);
    try {
      saveAvatarSession(window.localStorage, next);
    } catch {
      // storage unavailable — the live session still works
    }
  }

  const teardownLive = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    if (idleRef.current) clearTimeout(idleRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    keepAliveRef.current = null;
    idleRef.current = null;
    capRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    agentRef.current?.stop();
    agentRef.current = null;
    agentLiveRef.current = false;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    stopSpeech();
  }, []);

  useEffect(() => teardownLive, [teardownLive]);

  function resetIdle() {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      setHint("Paused after a few quiet minutes. Hang up or start again.");
      agentRef.current?.setMuted(true);
      setMuted(true);
    }, IDLE_TIMEOUT_MS);
  }

  function setAgentMuted(next: boolean) {
    agentRef.current?.setMuted(next);
    setMuted(next);
  }

  async function runScore(s: AvatarSession, action: Extract<TurnAction, { type: "score" }>): Promise<AvatarSession> {
    try {
      const res = await fetch("/api/avatar/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scoreType: action.scoreType,
          mode: s.mode,
          transcript: s.transcript.slice(action.slice[0], action.slice[1]),
          criteria: action.criteria,
          cohort: s.cohort,
        }),
      });
      if (!res.ok) return s;
      const data = await res.json();
      const latest = sessionRef.current ?? s;
      return action.scoreType === "round"
        ? { ...latest, roundScores: [...latest.roundScores, { ...data, round: latest.currentRound }] }
        : { ...latest, inlineScores: [...latest.inlineScores, { ...data, turnIndex: action.turnIndex }] };
    } catch {
      return s;
    }
  }

  /** Every spoken or typed turn lands here, from either side. */
  async function recordTurn(speaker: "student" | "avatar", text: string) {
    const current = sessionRef.current;
    if (!current) return;
    const { session: next, actions } = appendTurn(current, speaker, text);
    commit(next);
    if (speaker === "student") resetIdle();

    let working = next;
    for (const action of actions) {
      if (action.type === "score") {
        working = await runScore(working, action);
        commit(working);
      } else if (action.type === "roundComplete") {
        setAgentMuted(true);
        setStep("review");
      } else if (action.type === "sessionComplete") {
        working = { ...working, endedAt: Date.now() };
        commit(working);
      }
    }
  }

  /** Typed input works with or without a live call: the reply is generated
   *  by the turn endpoint and spoken by the agent's voice when connected. */
  async function handleTypedTurn(text: string) {
    const current = sessionRef.current;
    if (!current) return;
    await recordTurn("student", text);
    const after = sessionRef.current ?? current;
    if (stepRef.current !== "session") return;
    setPhase("thinking");
    const reply = await fetchOpening(after);
    if (!reply) {
      setPhase(agentLiveRef.current ? "listening" : "error");
      setHint("The avatar didn't answer — try again.");
      return;
    }
    setHint(null);
    if (agentLiveRef.current) {
      agentRef.current?.inject(reply);
    } else {
      setPhase("speaking");
      void speakCoach(reply).finally(() => setPhase("idle"));
    }
    await recordTurn("avatar", reply);
  }

  async function connect(s: AvatarSession, greeting: string) {
    const audioCtx = typeof AudioContext !== "undefined" ? new AudioContext() : null;
    audioCtxRef.current = audioCtx;
    const agent = agentFactory({
      fetchToken: async () => {
        const res = await fetch("/api/deepgram/token", { method: "POST" });
        if (!res.ok) throw new Error("no token");
        return (await res.json()).access_token as string;
      },
      createSocket: (token) => openAgentSocket(token),
      createQueue: () => (audioCtx ? createAudioQueue(audioCtx) : { push() {}, drop() {}, close() {} }),
      onEvent: (e) => {
        if (e.type === "phase") {
          setPhase(e.phase);
          if (e.phase === "listening" || e.phase === "speaking" || e.phase === "thinking") agentLiveRef.current = true;
          if (e.phase === "idle" || e.phase === "error") agentLiveRef.current = false;
        } else if (e.type === "turn") {
          void recordTurn(e.speaker, e.text);
        } else if (e.type === "error") {
          setHint(e.message);
          setTextMode(true);
        }
      },
    });
    agentRef.current = agent;
    await agent.start(buildAvatarAgentPrompt(s), greeting);

    keepAliveRef.current = setInterval(() => agent.keepAlive(), KEEP_ALIVE_MS);
    capRef.current = setTimeout(() => {
      setHint("Time's up for this call — hang up to see your summary.");
      setAgentMuted(true);
    }, SESSION_CAP_MS);
    resetIdle();

    try {
      micRef.current = await startMic((pcm) => agent.send(pcm));
      setMicAvailable(true);
    } catch {
      setMicAvailable(false);
      setTextMode(true);
      setHint("Microphone unavailable — type your arguments instead.");
    }
  }

  async function startSession(m: FlowMotion, side: Side) {
    if (!selectedMode || starting) return;
    setStarting(true);
    const cohort = "darshan"; // TODO: read from user settings
    let s = initSession(selectedMode, m.motion, m.id, cohort, side);
    s = { ...s, id: crypto.randomUUID(), startedAt: Date.now() };
    commit(s);
    setHint(null);
    setTextMode(false);
    setMuted(false);

    let opening: string | null = null;
    if (s.mode === "sparring" && s.avatarOpens) {
      opening = (await fetchOpening(s)) || null;
      if (opening) {
        const { session: withOpening } = appendTurn(s, "avatar", opening);
        s = withOpening;
        commit(s);
      }
    }
    const greeting = avatarGreeting(s, opening);
    if (!opening) {
      // A fixed cue is context, not debate content: keep it out of the round window.
      const { session: withGreeting } = appendTurn(s, "avatar", greeting);
      s = { ...withGreeting, roundStart: withGreeting.transcript.length };
      commit(s);
    }
    setStep("session");
    setStarting(false);
    await connect(s, greeting);
  }

  function nextRound() {
    const current = sessionRef.current;
    if (!current) return;
    const advanced = advanceRound(current);
    commit(advanced);
    agentRef.current?.updatePrompt(buildAvatarAgentPrompt(advanced));
    setStep("session");
    setAgentMuted(false);
    setHint(null);
    if (agentLiveRef.current) agentRef.current?.inject(`Round ${advanced.currentRound}. Your turn, go ahead.`);
  }

  async function beginDebatePhase() {
    const current = sessionRef.current;
    if (!current) return;
    const debating = startDebatePhase(current);
    commit(debating);
    setStep("session");
    setPhase("thinking");
    const opening = await fetchOpening(debating);
    agentRef.current?.updatePrompt(buildAvatarAgentPrompt(debating));
    const line = opening || avatarGreeting(debating);
    if (agentLiveRef.current) agentRef.current?.inject(line);
    else void speakCoach(line);
    const { session: withOpening } = appendTurn(debating, "avatar", line);
    commit(withOpening);
    setAgentMuted(false);
    setHint(null);
  }

  function endCall() {
    teardownLive();
    const current = sessionRef.current;
    if (current && !current.endedAt) commit({ ...current, endedAt: Date.now() });
    setPhase("idle");
    if (current && (current.roundScores.length > 0 || current.inlineScores.length > 0)) {
      setStep("review");
    } else {
      setSession(null);
      sessionRef.current = null;
      setStep("mode");
    }
  }

  function leaveToModes() {
    teardownLive();
    setSession(null);
    sessionRef.current = null;
    setStep("mode");
  }

  if (step === "mode") {
    return (
      <AppShell>
        <Button variant="ghost" className="mb-4 text-muted-foreground" onClick={onExit}>← Back</Button>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">Debate Avatar</div>
        <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">Choose your mode</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A live voice call: just talk, the avatar talks back, and you can interrupt each other. Type instead any time.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {MODES.map((m, i) => (
            <ModeCard key={m.mode} title={m.title} description={m.description} index={i} onClick={() => { setSelectedMode(m.mode); setStep("intro"); }} />
          ))}
        </div>
      </AppShell>
    );
  }

  if (step === "intro" && selectedMode) {
    const m = MODES.find((x) => x.mode === selectedMode)!;
    return (
      <AppShell>
        <Button variant="ghost" className="mb-4 text-muted-foreground" onClick={() => setStep("mode")}>← Back</Button>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">How this mode works</div>
        <h2 className="mt-1 font-display text-3xl font-semibold text-foreground">{m.title}</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">{m.description}</p>
        <ol className="mt-6 max-w-2xl space-y-3">
          {m.how.map((line, i) => (
            <li key={i} className="flex gap-3 text-sm text-foreground">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="leading-relaxed">{line}</span>
            </li>
          ))}
        </ol>
        <div className="mt-6 max-w-2xl rounded-xl border border-evidence/40 bg-evidence/10 p-4 text-sm">
          <span className="font-semibold text-foreground">Tip: </span>
          <span className="text-muted-foreground">{m.tip}</span>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          It&apos;s a live voice call: just talk, and interrupt whenever you like. You can type instead at any point.
        </p>
        <Button className="mt-4" onClick={() => setStep("motion")}>Pick a motion →</Button>
      </AppShell>
    );
  }

  if (step === "motion") {
    return (
      <AppShell>
        <Button variant="ghost" className="mb-4 text-muted-foreground" onClick={() => setStep("intro")}>← Back</Button>
        <h2 className="font-display text-2xl font-semibold text-foreground">Pick a motion</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {motions.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              className="h-auto whitespace-normal p-4 text-left"
              onClick={() => {
                setSelectedMotion(m);
                if (selectedMode === "collaborative") void startSession(m, "for");
                else setStep("side");
              }}
            >
              {m.motion}
            </Button>
          ))}
        </div>
      </AppShell>
    );
  }

  if (step === "side" && selectedMotion) {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg py-10 text-center">
          <h2 className="font-display text-2xl font-semibold text-foreground">{selectedMotion.motion}</h2>
          <p className="mt-3 text-sm text-muted-foreground">Which side do you want to argue?</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button disabled={starting} onClick={() => void startSession(selectedMotion, "for")}>Argue FOR</Button>
            <Button disabled={starting} onClick={() => void startSession(selectedMotion, "against")}>Argue AGAINST</Button>
          </div>
          {starting && <p className="mt-4 text-sm text-muted-foreground">Setting up your opponent…</p>}
        </div>
      </AppShell>
    );
  }

  if (step === "transition" && session?.mode === "collaborative") {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg py-16 text-center">
          <h2 className="font-display text-2xl font-semibold text-foreground">Ready to debate?</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The avatar will switch sides and argue against you using the case you built together.
          </p>
          <Button className="mt-6" onClick={() => void beginDebatePhase()}>Let&apos;s go →</Button>
        </div>
      </AppShell>
    );
  }

  if (step === "review" && session) {
    const finished = !!session.endedAt;
    return (
      <AppShell>
        <ScoreCard
          mode={session.mode}
          roundScores={session.roundScores}
          inlineScores={session.inlineScores}
          finished={finished}
          onContinue={nextRound}
          onEnd={leaveToModes}
        />
      </AppShell>
    );
  }

  if (step === "session" && session) {
    const modeLabel = MODES.find((m) => m.mode === session.mode)?.title ?? "";
    const roundLabel =
      session.mode === "sparring"
        ? `Round ${session.currentRound} of ${session.totalRounds}`
        : session.mode === "collaborative"
          ? session.phase === "collaborative" ? "Building your case" : "Debating"
          : "";
    const lastAvatarText = [...session.transcript].reverse().find((t) => t.speaker === "avatar")?.text;
    const lastStudentText = [...session.transcript].reverse().find((t) => t.speaker === "student")?.text;
    const studentActive = phase === "listening" && !muted;
    const avatarActive = phase === "speaking" || phase === "thinking";
    const building = session.mode === "collaborative" && session.phase === "collaborative";

    return (
      <div
        data-phase={building ? "build" : "debate"}
        className={cn(
          "fixed inset-0 z-30 flex flex-col text-white",
          building
            ? "bg-gradient-to-b from-emerald-950 via-teal-950 to-gray-950"
            : "bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950",
        )}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm font-medium text-white/60">
            {modeLabel}
            {roundLabel && (
              <span
                className={cn(
                  "ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                  building ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60",
                )}
              >
                {roundLabel}
              </span>
            )}
          </div>
          <TranscriptPane transcript={session.transcript} inlineScores={session.inlineScores} />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
          <p className="max-w-lg text-center text-sm font-medium leading-relaxed text-white/50">{session.motionText}</p>
          {building && (
            <p className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
              Phase 1 · Building together — the avatar is on your side
            </p>
          )}
          {session.mode === "collaborative" && !building && (
            <p className="rounded-full border border-red-300/30 bg-red-400/10 px-3 py-1 text-xs font-medium text-red-200">
              Phase 2 · Debate — the avatar has switched sides
            </p>
          )}

          <div className="flex items-center gap-12">
            <div className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  "flex h-24 w-24 items-center justify-center rounded-full border-2 text-3xl font-bold transition-all duration-300",
                  studentActive ? "border-green-400 bg-green-500/20 shadow-[0_0_32px_rgba(74,222,128,0.35)]" : "border-white/20 bg-white/5",
                )}
              >
                <span className="text-white/80">You</span>
              </div>
              <span className="text-xs text-white/40">
                {session.studentSide.toUpperCase()}
                {muted ? " · muted" : ""}
              </span>
            </div>

            <div className={cn("text-2xl font-light", building ? "text-emerald-300/60" : "text-white/20")}>
              {building ? "+" : "vs"}
            </div>

            <div className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  "flex h-24 w-24 items-center justify-center rounded-full border-2 text-lg font-semibold transition-all duration-300",
                  avatarActive ? "border-blue-400 bg-blue-500/20 shadow-[0_0_32px_rgba(96,165,250,0.35)]" : "border-white/20 bg-white/5",
                )}
              >
                <svg className="h-10 w-10 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                </svg>
              </div>
              <span className="text-xs text-white/40">
                {session.avatarSide.toUpperCase()}
                {phase === "thinking" ? " · thinking…" : phase === "speaking" ? " · speaking" : ""}
              </span>
            </div>
          </div>

          {(lastStudentText || lastAvatarText) && (
            <div className="w-full max-w-xl space-y-2">
              {lastStudentText && (
                <div className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm leading-relaxed text-white/70">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/70">You</span>
                  {lastStudentText}
                </div>
              )}
              {lastAvatarText && (
                <div
                  data-testid="last-avatar-line"
                  className="max-h-40 overflow-y-auto rounded-xl bg-blue-500/10 px-4 py-2.5 text-sm leading-relaxed text-white/90"
                >
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-blue-300/70">Avatar</span>
                  {lastAvatarText}
                </div>
              )}
            </div>
          )}
        </div>

        <AvatarVoiceBar
          phase={phase}
          muted={muted}
          onToggleMute={() => {
            setHint(null);
            setAgentMuted(!muted);
          }}
          textMode={textMode}
          onToggleText={() => setTextMode((t) => !t)}
          onSubmitText={(t) => void handleTypedTurn(t)}
          onEnd={endCall}
          micAvailable={micAvailable}
          hint={hint}
          extra={
            readyToDebate(session) ? (
              <button
                type="button"
                onClick={() => {
                  setAgentMuted(true);
                  setStep("transition");
                }}
                className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-gray-900 shadow-[0_0_20px_rgba(251,191,36,0.4)] transition-colors hover:bg-amber-300"
              >
                Ready to debate →
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return null;
}
