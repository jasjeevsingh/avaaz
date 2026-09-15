"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CoachBubble } from "@/components/CoachBubble";
import { useHelperContext } from "@/components/helper/HelperContextProvider";
import {
  initialHelperState,
  type HelperPhase,
  type HelperReplyTurn,
  type HelperState,
} from "@/lib/helper/agentMachine";
import { createAgentSession } from "@/lib/helper/agentSession";
import { openAgentSocket } from "@/lib/voice/agentSocket";
import { createAudioQueue } from "@/lib/helper/audioQueue";
import { helperSendGuard } from "@/lib/helper/limits";
import { riseIn, transitions } from "@/lib/motion";

const PHASE_LABEL: Partial<Record<HelperPhase, string>> = {
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Error",
};

// Live audio is billed per minute; if the conversation goes quiet this long
// we close the socket rather than let it idle on the meter. Reset only on
// STUDENT turns — the helper's own replies (or noise transcribed as a turn)
// must never keep this open indefinitely.
const IDLE_TIMEOUT_MS = 90_000;
// Deepgram closes the agent socket if it hears nothing for 8s.
const KEEP_ALIVE_MS = 5_000;
// Hard ceiling on a single session, regardless of activity — a cost/safety
// backstop for a panel left open (echo, noise, or someone just walking away).
const SESSION_CAP_MS = 10 * 60_000;

const HELPER_UNAVAILABLE_MESSAGE = "Voice helper is unavailable right now.";
const MIC_UNAVAILABLE_MESSAGE =
  "I couldn't hear your microphone — check that it's connected and that this page has permission to use it.";
const SEND_FAILED_MESSAGE = "Couldn't reach the helper. Try again.";

/** Pure presentation — no sockets, no AudioContext, no fetch. This is what
 *  tests drive directly. Text chat is the default surface; a live call is an
 *  escalation the student explicitly starts. */
export function HelperPanelView({
  state,
  open,
  onOpen,
  onClose,
  inCall,
  sending,
  onSend,
  onStartCall,
  onStartNewConversation,
  voiceUnavailable = null,
}: {
  state: HelperState;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  inCall: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  onStartCall: () => void;
  // Clears a stuck chat (e.g. the conversation-length cap) in place, without
  // needing a full page reload. Only offered in the text-chat error slot.
  onStartNewConversation?: () => void;
  // A reason voice is unavailable (e.g. no Deepgram key configured), if any.
  // This only ever disables "Start voice call" — text chat needs neither a
  // key nor a microphone, so the trigger and the composer must both keep
  // working regardless of this.
  voiceUnavailable?: string | null;
}) {
  const [draft, setDraft] = useState("");
  // Mirrors the feedback panel: clear the draft once a send actually goes
  // through (sending flips back off with no error). A failed send must
  // never land here — losing what someone typed is the worst outcome.
  const prevSendingRef = useRef(sending);
  useEffect(() => {
    if (prevSendingRef.current && !sending && !state.error) {
      setDraft("");
    }
    prevSendingRef.current = sending;
  }, [sending, state.error]);

  // Focus management: opening the panel drops a keyboard user straight into
  // the composer, and closing it returns focus to the trigger that opened
  // it — otherwise both leave focus stranded on <body>.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      textareaRef.current?.focus();
    } else if (!open && wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  if (!open) {
    // The trigger always opens the chat — text needs neither a microphone
    // nor Deepgram, so no availability probe may ever gate it.
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <Button ref={triggerRef} onClick={onOpen}>
          <span aria-hidden>💬</span> Talk it through
        </Button>
      </div>
    );
  }

  // The idle guard closes the live session but leaves the panel open and
  // `inCall` true, so a one-tap "Resume" (via onStartCall) can reconnect.
  if (inCall && state.phase === "idle") {
    return (
      <motion.div
        data-testid="helper-panel"
        className="fixed inset-x-0 bottom-0 z-40 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
        variants={riseIn}
        initial="hidden"
        animate="show"
        transition={transitions.spring}
      >
        <Card className="border-border">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-xs text-muted-foreground">Paused to save time on the call.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={onStartCall}>
                Resume
              </Button>
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (inCall) {
    return (
      <motion.div
        data-testid="helper-panel"
        className="fixed inset-x-0 bottom-0 z-40 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
        variants={riseIn}
        initial="hidden"
        animate="show"
        transition={transitions.spring}
      >
        <Card className="border-border">
          <CardContent className="flex max-h-[70vh] flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{PHASE_LABEL[state.phase] ?? ""}</span>
              <div className="flex gap-2">
                {state.phase === "error" && (
                  <Button size="sm" onClick={onStartCall}>
                    Retry
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onClose}>
                  End call
                </Button>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {state.turns.map((t, i) =>
                t.role === "helper" ? (
                  <CoachBubble key={i}>{t.text}</CoachBubble>
                ) : (
                  <p key={i} className="text-sm text-muted-foreground">
                    {t.text}
                  </p>
                )
              )}
            </div>
            {state.error && <p className="text-xs text-muted-foreground">{state.error}</p>}
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Text chat — the default surface. Two simultaneous input channels into
  // one agent would be confusing, so this only ever renders while !inCall.
  const trimmed = draft.trim();
  const sendDisabled = trimmed.length === 0 || sending;
  const handleSend = () => {
    if (sendDisabled) return;
    onSend(trimmed);
  };
  // Enter sends (matching what students expect from every chat app);
  // Shift+Enter keeps its default behavior of inserting a newline.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      data-testid="helper-panel"
      className="fixed inset-x-0 bottom-0 z-40 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
      variants={riseIn}
      initial="hidden"
      animate="show"
      transition={transitions.spring}
    >
      <Card className="border-border">
        <CardContent className="flex max-h-[70vh] flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Talk it through</span>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto" aria-live="polite">
            {state.turns.map((t, i) =>
              t.role === "helper" ? (
                <CoachBubble key={i}>{t.text}</CoachBubble>
              ) : (
                <p key={i} className="text-sm text-muted-foreground">
                  {t.text}
                </p>
              )
            )}
            {sending && <p className="text-xs text-muted-foreground">Sending…</p>}
          </div>
          {state.error && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{state.error}</p>
              {onStartNewConversation && (
                <Button variant="outline" size="sm" onClick={onStartNewConversation}>
                  Start a new conversation
                </Button>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message the helper"
            placeholder="Ask about your claim, or talk through your argument…"
            rows={3}
            className="w-full resize-none rounded-lg border border-input bg-background p-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-col items-end gap-1 border-t border-border pt-3">
            {voiceUnavailable && <p className="text-xs text-muted-foreground">{voiceUnavailable}</p>}
            <div className="flex items-center justify-end gap-2">
              {/* Disabled while a send is in flight: starting a call snapshots
                  `turns` into the session's initialTurns, and ending the call
                  later overwrites `turns` wholesale with the session's final
                  turns — a send that resolves mid-call would be silently
                  discarded by that overwrite. Blocking the escalation until
                  the send settles keeps the snapshot (and therefore the
                  merge) complete. Also disabled when voice itself is
                  unavailable — text chat never is. */}
              <Button
                variant="outline"
                size="sm"
                onClick={onStartCall}
                disabled={sending || Boolean(voiceUnavailable)}
                title={voiceUnavailable ?? undefined}
              >
                Start voice call
              </Button>
              <Button size="sm" onClick={handleSend} disabled={sendDisabled}>
                Send
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

type Mic = {
  stream: MediaStream;
  audioContext: AudioContext;
  processor: ScriptProcessorNode;
};

/** Live wiring: the untestable seam. Real fetch, real WebSocket, real
 *  AudioContext, real microphone capture. Not covered by unit tests — see
 *  task report. `turns` is the single source of truth for the conversation;
 *  opening the panel touches none of the above — only pressing "Start voice
 *  call" does. */
export function HelperPanel() {
  const ctx = useHelperContext();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const [open, setOpen] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [turns, setTurns] = useState<HelperReplyTurn[]>([]);
  const [sending, setSending] = useState(false);
  // The live voice session's own state machine — only meaningful while a
  // call is being started or is live.
  const [callState, setCallState] = useState<HelperState>(initialHelperState());
  // A reason voice is unavailable (mount-time probe came back non-ok), if
  // any. Deliberately separate from `callState.error` — that field also
  // carries mid-call errors and send failures, which must never disable
  // "Start voice call" the way an availability probe should.
  const [voiceUnavailable, setVoiceUnavailable] = useState<string | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const callStateRef = useRef(callState);
  callStateRef.current = callState;
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;

  const sessionRef = useRef<ReturnType<typeof createAgentSession> | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRef = useRef<Mic | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const turnCountRef = useRef(0);
  // Bumped by every teardownLive() and by connect() itself. A connect() in
  // flight (awaiting the token round-trip, or awaiting the mic permission
  // prompt — either can take minutes) captures the epoch it started with; if
  // that epoch has moved on by the time an await resolves, this call has
  // been superseded (closed, reopened, or unmounted) and must not touch any
  // ref or acquire the mic further.
  const connectEpochRef = useRef(0);

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Cost guard: stop the session but leave the panel open for a resume tap.
      teardownLive();
    }, IDLE_TIMEOUT_MS);
  };

  const teardownMic = () => {
    const mic = micRef.current;
    if (!mic) return;
    mic.processor.onaudioprocess = null;
    mic.processor.disconnect();
    mic.stream.getTracks().forEach((track) => track.stop());
    void mic.audioContext.close();
    micRef.current = null;
  };

  /** Tears down the socket, mic, and timers, but leaves `open`/`inCall`
   *  alone. Used both by the idle guard (call stays "paused", showing
   *  Resume) and as the first half of ending a call. Also invalidates any
   *  connect() still awaiting a token or the mic permission prompt (see
   *  connectEpochRef). */
  const teardownLive = () => {
    connectEpochRef.current++;
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (sessionCapRef.current) {
      clearTimeout(sessionCapRef.current);
      sessionCapRef.current = null;
    }
    teardownMic();
    if (outputAudioContextRef.current) {
      void outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    sessionRef.current?.stop();
    sessionRef.current = null;
    turnCountRef.current = 0;
  };

  const connect = async (initialTurns: HelperReplyTurn[]) => {
    const epoch = ++connectEpochRef.current;
    const isCurrent = () => connectEpochRef.current === epoch;

    const outputAudioContext = new AudioContext();
    outputAudioContextRef.current = outputAudioContext;

    const session = createAgentSession({
      fetchToken: async () => {
        const res = await fetch("/api/deepgram/token", { method: "POST" });
        if (!res.ok) throw new Error("no token");
        return (await res.json()).access_token as string;
      },
      createSocket: (token) => openAgentSocket(token),
      createQueue: () => createAudioQueue(outputAudioContext),
      onState: (next) => {
        setCallState(next);
        if (next.turns.length > turnCountRef.current) {
          turnCountRef.current = next.turns.length;
          // Only a STUDENT turn counts as activity — the helper's own reply
          // (or noise misheard as a turn) must never keep the meter running.
          if (next.turns[next.turns.length - 1]?.role === "student") resetIdleTimer();
        }
      },
      // Continue the conversation this call should carry forward: the typed
      // thread on a fresh start, or the call's own turns-so-far on a resume
      // (see handleStartCall) — never the stale text ref on a resume, or
      // every spoken turn since the last pause/cap/retry would be lost.
      initialTurns,
    });
    sessionRef.current = session;
    await session.start(ctxRef.current);

    if (!isCurrent()) {
      // Superseded while awaiting the token round-trip. Whoever superseded
      // us already ran teardownLive(), which stopped this exact session
      // (still referenced by sessionRef at that point) — nothing left to do.
      return;
    }

    keepAliveRef.current = setInterval(() => session.keepAlive(), KEEP_ALIVE_MS);
    resetIdleTimer();
    sessionCapRef.current = setTimeout(() => {
      // Hard cost/safety ceiling: close regardless of activity, same Resume
      // affordance as the idle guard.
      teardownLive();
    }, SESSION_CAP_MS);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      if (!isCurrent()) return; // superseded before we even knew whether the mic would work
      // Mic permission denied or unavailable. The socket is up but nothing
      // is being heard — don't leave a "Listening…" panel that never
      // responds. Tear the whole session down and say why.
      teardownLive();
      setCallState((prev) => ({ ...prev, phase: "error", error: MIC_UNAVAILABLE_MESSAGE }));
      return;
    }

    if (!isCurrent()) {
      // Superseded while the permission prompt was open. Nothing else has a
      // reference to this stream yet — stop it directly so the browser's
      // recording indicator turns off immediately.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      session.send(int16.buffer);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    micRef.current = { stream, audioContext, processor };
  };

  // Opening the panel is inert: no fetch, no mic, no socket. Only pressing
  // "Start voice call" (handleStartCall) touches any of that.
  const handleOpen = () => {
    setOpen(true);
  };

  // Escalate the text chat to a live voice call, carrying the typed
  // conversation across as initialTurns. Guarded against a send still in
  // flight (the view also disables the button for this, but this defends
  // any other caller): starting now would snapshot `turns` before that
  // send's reply lands, and ending the call later overwrites `turns`
  // wholesale with the session's turns — silently discarding the pending
  // exchange once it resolves.
  const handleStartCall = () => {
    if (sending || voiceUnavailable) return;
    // A call is already "in call" (live, paused after the idle guard or the
    // session cap, or sitting in the error phase from Retry) exactly when
    // this is a resume, not a fresh start — in every one of those cases the
    // turns spoken so far live in callState, not in the text ref. Seeding
    // from turnsRef there would silently drop every spoken turn (see F2).
    // A fresh start from text chat has no live call yet, so it seeds from
    // the typed conversation instead.
    const seedTurns = inCallRef.current ? callStateRef.current.turns : turnsRef.current;
    teardownLive(); // defensive: no live session should exist yet, invalidates any stale connect()
    setInCall(true);
    setCallState(initialHelperState(seedTurns));
    void connect(seedTurns);
  };

  // Reused for every "leave this screen" control. While a call is live (or
  // paused/erroring), this ends the call and returns to text chat with the
  // conversation so far preserved. Otherwise it closes the whole panel.
  const handleClose = () => {
    teardownLive();
    if (inCallRef.current) {
      setTurns(callStateRef.current.turns);
      setInCall(false);
      setCallState(initialHelperState());
    } else {
      setOpen(false);
      setCallState(initialHelperState());
      // `turns` is deliberately left alone — a plain close only hides the
      // panel for this session; only a reload clears the thread.
    }
  };

  // Clears a stuck text thread in place (e.g. the conversation-length cap) —
  // otherwise the only way out is a full page reload, which loses it anyway.
  const handleStartNewConversation = () => {
    setTurns([]);
    setCallState(initialHelperState());
  };

  const handleSend = async (text: string) => {
    if (sending) return;
    const guardMessage = helperSendGuard(turnsRef.current.length, text);
    if (guardMessage) {
      setCallState((prev) => ({ ...prev, error: guardMessage }));
      return;
    }
    setSending(true);
    setCallState((prev) => ({ ...prev, error: null }));
    try {
      const res = await fetch("/api/helper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [...turnsRef.current, { role: "student", text }],
          context: ctxRef.current,
        }),
      });
      if (!res.ok) {
        setCallState((prev) => ({ ...prev, error: SEND_FAILED_MESSAGE }));
        return;
      }
      const data = (await res.json()) as { reply: string };
      setTurns([...turnsRef.current, { role: "student", text }, { role: "helper", text: data.reply }]);
      setCallState((prev) => ({ ...prev, error: null }));
    } catch {
      setCallState((prev) => ({ ...prev, error: SEND_FAILED_MESSAGE }));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    sessionRef.current?.updateContext(ctx);
  }, [ctx]);

  // One-time availability probe so an unusable key disables just "Start voice
  // call" with an explanation up front, instead of an enabled button that
  // fails on click. GET attempts a real grant server-side and caches success
  // briefly, because a key can be present and still be refused when minting a
  // browser token — an env-presence check reported exactly that key as
  // available. Text chat needs neither Deepgram nor a microphone, so this must
  // never touch the trigger, `open`, or `callState` — only the voice-specific
  // affordance.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/deepgram/token", { method: "GET" })
      .then((res) => {
        if (cancelled || res.ok) return;
        setVoiceUnavailable(HELPER_UNAVAILABLE_MESSAGE);
      })
      .catch(() => {
        // Couldn't check — leave the affordance enabled and let a real
        // connect attempt surface any error through the normal path.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Full teardown on unmount, regardless of open/closed state.
  useEffect(() => teardownLive, []);

  // The view only ever needs one HelperState: while a call is live (or
  // paused/erroring), that's the session's own state; otherwise it's the
  // text thread plus any send error, synthesized here so the view stays
  // agnostic to where the turns came from.
  const viewState: HelperState = open && !inCall ? { phase: "idle", turns, error: callState.error } : callState;

  return (
    <HelperPanelView
      state={viewState}
      open={open}
      onOpen={handleOpen}
      onClose={handleClose}
      inCall={inCall}
      sending={sending}
      onSend={(text) => void handleSend(text)}
      onStartCall={handleStartCall}
      onStartNewConversation={handleStartNewConversation}
      voiceUnavailable={voiceUnavailable}
    />
  );
}
