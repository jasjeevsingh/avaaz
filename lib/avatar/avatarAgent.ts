/**
 * Live voice session for the Debate Avatar on the Deepgram Voice Agent API:
 * one WebSocket carries the student's microphone up and the avatar's speech
 * down, with Deepgram doing speech-to-text, turn detection, barge-in, and
 * text-to-speech around a Claude "think" step. This replaces the old
 * hold-to-talk → transcribe → LLM → per-sentence TTS pipeline, which added
 * several seconds per turn and fell back to silent text whenever any hop
 * failed.
 *
 * Pure plumbing: no React, no DOM. The socket, audio queue, and token fetch
 * are injected so tests can drive it with fakes (same seam as the helper).
 */

export type AgentPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type AvatarAgentEvent =
  | { type: "phase"; phase: AgentPhase }
  | { type: "turn"; speaker: "student" | "avatar"; text: string }
  | { type: "error"; message: string };

export type AgentSocket = {
  on(event: string, handler: (payload: unknown) => void): void;
  configure(options: unknown): void;
  updatePrompt(prompt: string): void;
  injectAgentMessage(message: string): void;
  send(data: ArrayBuffer): void;
  keepAlive(): void;
  requestClose(): void;
};

export type AgentQueue = { push(pcm: ArrayBuffer): void; drop(): void; close(): void };

export type AvatarAgentDeps = {
  fetchToken: () => Promise<string>;
  createSocket: (token: string) => AgentSocket;
  createQueue: () => AgentQueue;
  onEvent: (e: AvatarAgentEvent) => void;
};

// Browser-side, so hardcoded rather than env-driven. Matches the helper.
const LISTEN_MODEL = "nova-3";
const SPEAK_MODEL = "aura-2-thalia-en";
const THINK_MODEL = "claude-sonnet-5";

export function avatarAgentConfig(prompt: string, greeting?: string) {
  return {
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: { type: "en" },
      listen: { provider: { type: "deepgram", model: LISTEN_MODEL } },
      think: { provider: { type: "anthropic", model: THINK_MODEL }, prompt },
      speak: { provider: { type: "deepgram", model: SPEAK_MODEL } },
      ...(greeting ? { greeting } : {}),
    },
  };
}

export function createAvatarAgent(deps: AvatarAgentDeps) {
  let socket: AgentSocket | null = null;
  let queue: AgentQueue | null = null;
  let muted = false;
  let suppressAudio = false;
  let sessionId = 0;
  let lastInjected: string | null = null;

  const emit = (e: AvatarAgentEvent) => deps.onEvent(e);
  const phase = (p: AgentPhase) => emit({ type: "phase", phase: p });

  function teardown() {
    socket?.requestClose();
    queue?.close();
    socket = null;
    queue = null;
  }

  async function start(prompt: string, greeting?: string): Promise<void> {
    teardown();
    const mine = ++sessionId;
    suppressAudio = false;
    muted = false;
    phase("connecting");

    let token: string;
    try {
      token = await deps.fetchToken();
    } catch {
      if (mine !== sessionId) return;
      emit({ type: "error", message: "The debate avatar is unavailable right now." });
      phase("error");
      return;
    }
    if (mine !== sessionId) return;

    let s: AgentSocket;
    let q: AgentQueue;
    try {
      q = deps.createQueue();
      s = deps.createSocket(token);
    } catch {
      if (mine !== sessionId) return;
      emit({ type: "error", message: "Couldn't start the debate avatar." });
      phase("error");
      return;
    }
    socket = s;
    queue = q;

    const guard = (fn: () => void) => () => {
      if (mine === sessionId) fn();
    };

    s.on("Welcome", guard(() => phase("listening")));
    s.on("SettingsApplied", guard(() => phase("listening")));
    s.on("ConversationText", (p) => {
      if (mine !== sessionId) return;
      suppressAudio = false;
      const t = p as { role?: string; content?: string };
      const text = (t.content ?? "").trim();
      if (!text) return;
      const speaker = t.role === "user" ? "student" : "avatar";
      // An injected line was already recorded by the caller; don't double it.
      if (speaker === "avatar" && lastInjected && text === lastInjected) {
        lastInjected = null;
        return;
      }
      emit({ type: "turn", speaker, text });
    });
    s.on("UserStartedSpeaking", guard(() => {
      suppressAudio = true;
      queue?.drop();
      phase("listening");
    }));
    s.on("AgentThinking", guard(() => {
      suppressAudio = false;
      phase("thinking");
    }));
    s.on("AgentStartedSpeaking", guard(() => phase("speaking")));
    s.on("AgentAudioDone", guard(() => phase("listening")));
    s.on("Audio", (p) => {
      if (mine !== sessionId || suppressAudio) return;
      queue?.push(p as ArrayBuffer);
      phase("speaking");
    });
    s.on("Close", guard(() => phase("idle")));
    s.on("Error", (p) => {
      if (mine !== sessionId) return;
      const e = p as { message?: string };
      emit({ type: "error", message: e?.message ?? "The debate avatar hit a problem." });
      phase("error");
    });

    s.configure(avatarAgentConfig(prompt, greeting));
  }

  return {
    start,
    /** Swap the avatar's instructions mid-call (new round, side switch). */
    updatePrompt(prompt: string) {
      socket?.updatePrompt(prompt);
    },
    /** Make the avatar say a line verbatim in its own voice. */
    inject(text: string) {
      lastInjected = text.trim();
      socket?.injectAgentMessage(text);
    },
    /** While muted, mic audio is not forwarded (round review, phase interstitial). */
    setMuted(next: boolean) {
      muted = next;
    },
    isMuted: () => muted,
    send(pcm: ArrayBuffer) {
      if (!muted) socket?.send(pcm);
    },
    keepAlive() {
      socket?.keepAlive();
    },
    stop() {
      teardown();
      sessionId++;
      phase("idle");
    },
  };
}

export type AvatarAgent = ReturnType<typeof createAvatarAgent>;
