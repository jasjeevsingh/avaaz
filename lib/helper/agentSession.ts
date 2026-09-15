import { helperPrompt } from "@/lib/helper/helperPrompt";
import {
  initialHelperState,
  reduceHelper,
  type HelperEvent,
  type HelperReplyTurn,
  type HelperState,
} from "@/lib/helper/agentMachine";
import type { HelperContext } from "@/lib/helper/context";

export type AgentSocket = {
  on(event: string, handler: (payload: unknown) => void): void;
  configure(options: unknown): void;
  updatePrompt(prompt: string): void;
  send(data: ArrayBuffer): void;
  keepAlive(): void;
  requestClose(): void;
};

export type AgentQueue = { push(pcm: ArrayBuffer): void; drop(): void; close(): void };

export type SessionDeps = {
  fetchToken: () => Promise<string>;
  createSocket: (token: string) => AgentSocket;
  createQueue: () => AgentQueue;
  onState: (s: HelperState) => void;
  // The typed transcript this call is continuing, if any — so a voice call
  // started from the text chat carries that history into the agent's prompt.
  initialTurns?: HelperReplyTurn[];
};

// Hardcoded, not env-driven: agentConfig runs in the browser, where server-only
// env vars are unreadable. Matches the repo's COACH_MODEL default and the Aura
// voice already used by /api/speak.
const LISTEN_MODEL = "nova-3";
const SPEAK_MODEL = "aura-2-thalia-en";
const THINK_MODEL = "claude-sonnet-5";

export function agentConfig(prompt: string) {
  return {
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: "en",
      listen: { provider: { type: "deepgram", model: LISTEN_MODEL } },
      think: { provider: { type: "anthropic", model: THINK_MODEL }, prompt },
      speak: { provider: { type: "deepgram", model: SPEAK_MODEL } },
    },
  };
}

export function createAgentSession(deps: SessionDeps) {
  let socket: AgentSocket | null = null;
  let queue: AgentQueue | null = null;
  const initialTurns = deps.initialTurns ?? [];
  let state = initialHelperState(initialTurns);
  // WebSocket ordering plus Deepgram's own server-side stop make a trailing
  // Audio frame after barge-in rare, but not impossible. Suppress playback of
  // any Audio frame that arrives after the student starts talking, until the
  // next turn (a fresh ConversationText or AgentThinking) confirms the agent
  // has moved on and later Audio frames belong to its new reply.
  let suppressUntilNextTurn = false;
  // Bumped on every start()/stop() call. A start() in flight (awaiting the
  // token fetch, or awaiting nothing at all yet) captures the id it was
  // issued with; if a later start()/stop() bumps the counter before that
  // in-flight call resumes, it recognizes itself as superseded and backs
  // out instead of standing up a second live socket/queue.
  let sessionId = 0;

  function dispatch(event: HelperEvent) {
    const { state: next, effect } = reduceHelper(state, event);
    state = next;
    if (effect === "dropAudio") queue?.drop();
    deps.onState(state);
  }

  function teardown(): void {
    socket?.requestClose();
    queue?.close();
    socket = null;
    queue = null;
  }

  async function start(ctx: HelperContext): Promise<void> {
    // Tear down any previous live session (or in-flight one, via the id
    // bump below) so at most one socket and one queue are ever live.
    teardown();
    const mySession = ++sessionId;
    suppressUntilNextTurn = false;

    dispatch({ type: "connecting" });
    let token: string;
    try {
      token = await deps.fetchToken();
    } catch {
      if (mySession !== sessionId) return; // superseded while awaiting the token
      dispatch({ type: "error", message: "Voice helper is unavailable right now." });
      return;
    }
    if (mySession !== sessionId) return; // superseded while awaiting the token

    let mySocket: AgentSocket;
    let myQueue: AgentQueue;
    try {
      myQueue = deps.createQueue();
      mySocket = deps.createSocket(token);
    } catch {
      if (mySession !== sessionId) return;
      dispatch({ type: "error", message: "Couldn't start the voice helper." });
      return;
    }

    socket = mySocket;
    queue = myQueue;

    // Handlers close over mySession so a socket that has lost ownership
    // (a newer start(), or stop(), ran after this one began) can no longer
    // drive shared state even if events keep arriving before it fully closes.
    const guardedDispatch = (event: HelperEvent) => {
      if (mySession !== sessionId) return;
      dispatch(event);
    };

    mySocket.on("Open", () => guardedDispatch({ type: "open" }));
    mySocket.on("Welcome", () => guardedDispatch({ type: "ready" }));
    mySocket.on("SettingsApplied", () => guardedDispatch({ type: "ready" }));
    mySocket.on("ConversationText", (p) => {
      suppressUntilNextTurn = false;
      const t = p as { role?: string; content?: string };
      guardedDispatch({ type: "conversationText", role: t.role ?? "assistant", content: t.content ?? "" });
    });
    mySocket.on("UserStartedSpeaking", () => {
      suppressUntilNextTurn = true;
      guardedDispatch({ type: "userStartedSpeaking" });
    });
    mySocket.on("AgentThinking", () => {
      suppressUntilNextTurn = false;
      guardedDispatch({ type: "thinking" });
    });
    mySocket.on("AgentAudioDone", () => guardedDispatch({ type: "audioDone" }));
    mySocket.on("Audio", (p) => {
      if (mySession !== sessionId) return;
      // Trailing audio from before the barge-in — drop it rather than play
      // (or even queue) it; the student has already moved on.
      if (suppressUntilNextTurn) return;
      const buf = p as ArrayBuffer;
      queue?.push(buf);
      dispatch({ type: "audio" });
    });
    mySocket.on("Close", () => guardedDispatch({ type: "closed" }));
    mySocket.on("Error", (p) => {
      const e = p as { message?: string };
      guardedDispatch({ type: "error", message: e?.message ?? "The voice helper hit a problem." });
    });

    // configure() MUST precede any audio.
    mySocket.configure(agentConfig(helperPrompt(ctx, "voice", initialTurns)));
  }

  function updateContext(ctx: HelperContext): void {
    // Keep passing the same prior turns — a context change mid-call must not
    // erase the agent's memory of the text thread it's continuing.
    socket?.updatePrompt(helperPrompt(ctx, "voice", initialTurns));
  }

  function stop(): void {
    teardown();
    sessionId++; // invalidate any start() still awaiting its token fetch
    dispatch({ type: "closed" });
  }

  return {
    start,
    updateContext,
    stop,
    send: (d: ArrayBuffer) => socket?.send(d),
    keepAlive: () => socket?.keepAlive(),
  };
}
