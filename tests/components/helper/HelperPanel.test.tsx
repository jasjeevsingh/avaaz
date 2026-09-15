import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelperPanel, HelperPanelView } from "@/components/helper/HelperPanel";
import { initialHelperState } from "@/lib/helper/agentMachine";

const base = initialHelperState();

const noop = () => {};

// A minimal fake Deepgram agent socket for the F2 wiring test below — just
// enough to capture event handlers and let the test fire them, mirroring the
// harness in tests/lib/helper/agentSession.test.ts. Defined via vi.hoisted so
// the (hoisted) vi.mock factory below can close over it and reference `vi`.
const { fakeSockets, makeFakeSocket } = vi.hoisted(() => {
  const fakeSockets: ReturnType<typeof makeFakeSocket>[] = [];
  function makeFakeSocket() {
    const handlers = new Map<string, (p: unknown) => void>();
    return {
      handlers,
      on: (e: string, h: (p: unknown) => void) => void handlers.set(e, h),
      configure: () => {},
      updatePrompt: () => {},
      send: () => {},
      keepAlive: () => {},
      injectAgentMessage: () => {},
      requestClose: () => {},
      fire: (event: string, payload?: unknown) => handlers.get(event)?.(payload),
    };
  }
  return { fakeSockets, makeFakeSocket };
});

vi.mock("@/lib/voice/agentSocket", () => ({
  openAgentSocket: () => {
    const socket = makeFakeSocket();
    fakeSockets.push(socket);
    return socket;
  },
}));

function renderView(overrides: Partial<React.ComponentProps<typeof HelperPanelView>> = {}) {
  return render(
    <HelperPanelView
      state={base}
      open={false}
      onOpen={noop}
      onClose={noop}
      inCall={false}
      sending={false}
      onSend={noop}
      onStartCall={noop}
      {...overrides}
    />
  );
}

describe("HelperPanelView — collapsed", () => {
  it("shows a collapsed affordance reading 'Talk it through' when closed", () => {
    renderView();
    expect(screen.getByRole("button", { name: /talk it through/i })).toBeInTheDocument();
  });

  it("opens on click", async () => {
    const onOpen = vi.fn();
    renderView({ onOpen });
    await userEvent.click(screen.getByRole("button", { name: /talk it through/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("still shows the enabled affordance when closed with no error", () => {
    renderView();
    expect(screen.getByRole("button", { name: /talk it through/i })).toBeEnabled();
  });

  // F1: text chat needs neither Deepgram nor a microphone, so a voice
  // availability probe must never gate the trigger — only "Start voice
  // call" (tested below) may ever be disabled by it.
  it("stays enabled when voice is unavailable — the trigger is never gated by voice", () => {
    renderView({ voiceUnavailable: "Voice helper is unavailable right now." });
    const button = screen.getByRole("button", { name: /talk it through/i });
    expect(button).toBeEnabled();
  });

  it("stays enabled even if state itself reports an error", () => {
    renderView({ state: { ...base, phase: "error", error: "Voice helper is unavailable right now." } });
    expect(screen.getByRole("button", { name: /talk it through/i })).toBeEnabled();
  });
});

describe("HelperPanelView — text chat (open, not in call)", () => {
  it("shows a textbox and both Send and Start voice call", () => {
    renderView({ open: true });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start voice call/i })).toBeInTheDocument();
  });

  it("disables Send when the textbox is empty", () => {
    renderView({ open: true });
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("disables Send while whitespace-only", async () => {
    renderView({ open: true });
    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("disables Send while sending", async () => {
    renderView({ open: true, sending: true });
    await userEvent.type(screen.getByRole("textbox"), "what makes a claim good");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("shows a typing indicator while sending", () => {
    renderView({ open: true, sending: true });
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
  });

  it("does not show a typing indicator when idle", () => {
    renderView({ open: true, sending: false });
    expect(screen.queryByText(/sending/i)).not.toBeInTheDocument();
  });

  it("calls onSend with the typed text", async () => {
    const onSend = vi.fn();
    renderView({ open: true, onSend });
    await userEvent.type(screen.getByRole("textbox"), "what makes a claim good");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onSend).toHaveBeenCalledWith("what makes a claim good");
  });

  it("calls onStartCall when Start voice call is pressed", async () => {
    const onStartCall = vi.fn();
    renderView({ open: true, onStartCall });
    await userEvent.click(screen.getByRole("button", { name: /start voice call/i }));
    expect(onStartCall).toHaveBeenCalled();
  });

  // A stuck chat (e.g. the conversation-length cap) otherwise has no way
  // out short of a full page reload, which loses the thread anyway — this
  // gives students a way to recover in place instead of the chat looking
  // permanently broken.
  it("offers a way to start a fresh conversation when the chat has an error", async () => {
    const onStartNewConversation = vi.fn();
    renderView({
      open: true,
      state: { ...base, error: "This conversation has gotten long enough that the helper can't keep going." },
      onStartNewConversation,
    });
    await userEvent.click(screen.getByRole("button", { name: /start a new conversation/i }));
    expect(onStartNewConversation).toHaveBeenCalled();
  });

  it("does not show a way to start over when there is no error", () => {
    renderView({ open: true });
    expect(screen.queryByRole("button", { name: /start a new conversation/i })).toBeNull();
  });

  // F1: voice availability may only ever disable "Start voice call" — never
  // the trigger (covered above) and never the composer (covered by the
  // surrounding tests in this block, all of which render with no
  // voiceUnavailable prop and still pass).
  it("disables only Start voice call when voice is unavailable, leaving the composer usable", async () => {
    const onSend = vi.fn();
    renderView({ open: true, onSend, voiceUnavailable: "Voice helper is unavailable right now." });
    const startCall = screen.getByRole("button", { name: /start voice call/i });
    expect(startCall).toBeDisabled();
    expect(screen.getByText(/voice helper is unavailable right now/i)).toBeInTheDocument();

    expect(screen.getByRole("textbox")).toBeEnabled();
    await userEvent.type(screen.getByRole("textbox"), "what makes a claim good");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onSend).toHaveBeenCalledWith("what makes a claim good");
  });

  it("does not show a voice-unavailable explanation when voice is available", () => {
    renderView({ open: true });
    expect(screen.getByRole("button", { name: /start voice call/i })).toBeEnabled();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("renders a thread with student and helper turns", () => {
    renderView({
      open: true,
      state: {
        ...base,
        turns: [
          { role: "student", text: "what makes a claim good" },
          { role: "helper", text: "what do you think it needs?" },
        ],
      },
    });
    expect(screen.getByText("what makes a claim good")).toBeInTheDocument();
    expect(screen.getByText("what do you think it needs?")).toBeInTheDocument();
  });

  it("preserves the typed text when a send fails", async () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <HelperPanelView
        state={base}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={onSend}
        onStartCall={noop}
      />
    );
    const textbox = screen.getByRole("textbox");
    await userEvent.type(textbox, "a paragraph I do not want to lose");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // Simulate the wiring: a send begins...
    rerender(
      <HelperPanelView
        state={base}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending
        onSend={onSend}
        onStartCall={noop}
      />
    );
    // ...and then fails.
    rerender(
      <HelperPanelView
        state={{ ...base, error: "Couldn't reach the helper. Try again." }}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={onSend}
        onStartCall={noop}
      />
    );

    expect(screen.getByRole("textbox")).toHaveValue("a paragraph I do not want to lose");
  });

  it("clears the typed text after a send succeeds", async () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <HelperPanelView
        state={base}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={onSend}
        onStartCall={noop}
      />
    );
    const textbox = screen.getByRole("textbox");
    await userEvent.type(textbox, "hello there");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    rerender(
      <HelperPanelView
        state={base}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending
        onSend={onSend}
        onStartCall={noop}
      />
    );
    rerender(
      <HelperPanelView
        state={{ ...base, turns: [{ role: "student", text: "hello there" }] }}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={onSend}
        onStartCall={noop}
      />
    );

    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  // F4: a screen-reader user needs an accessible name for the composer, not
  // just a placeholder (placeholders aren't reliably exposed as a label).
  it("gives the composer an accessible label", () => {
    renderView({ open: true });
    expect(screen.getByRole("textbox", { name: /message the helper/i })).toBeInTheDocument();
  });

  // F4: the thread and the "Sending…" indicator must be announced to a
  // screen-reader user as replies arrive, the same way FeedbackPanel's
  // status line is (components/feedback/FeedbackPanel.tsx).
  it("announces the thread and the sending indicator via an aria-live region", () => {
    renderView({ open: true, sending: true });
    const live = screen.getByText(/sending/i).closest('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it("sends on Enter", async () => {
    const onSend = vi.fn();
    renderView({ open: true, onSend });
    const textbox = screen.getByRole("textbox");
    await userEvent.type(textbox, "hello{Enter}");
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const onSend = vi.fn();
    renderView({ open: true, onSend });
    const textbox = screen.getByRole("textbox");
    await userEvent.type(textbox, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(textbox).toHaveValue("line one\nline two");
  });

  it("does not send on Enter while empty", async () => {
    const onSend = vi.fn();
    renderView({ open: true, onSend });
    const textbox = screen.getByRole("textbox");
    textbox.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("offers a way to close the chat", async () => {
    const onClose = vi.fn();
    renderView({ open: true, onClose });
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("mounts the open panel inside an animated (spring) entrance wrapper", () => {
    renderView({ open: true });
    const panel = screen.getByTestId("helper-panel");
    // Framer Motion applies `initial` variant values synchronously as inline
    // style on mount, before the animation frame runs — a plain <div> would
    // carry no such style. This is our signal that entrance motion is wired.
    const style = panel.getAttribute("style") ?? "";
    expect(style).toContain("opacity");
    expect(panel).toContainElement(screen.getByRole("textbox"));
  });
});

describe("HelperPanelView — in a live call", () => {
  it("hides the composer but keeps the thread and offers End call", () => {
    renderView({
      open: true,
      inCall: true,
      state: {
        ...base,
        phase: "listening",
        turns: [
          { role: "student", text: "what makes a claim good" },
          { role: "helper", text: "what do you think it needs?" },
        ],
      },
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.getByText("what makes a claim good")).toBeInTheDocument();
    expect(screen.getByText("what do you think it needs?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /end call/i })).toBeInTheDocument();
  });

  it("ends the call on click", async () => {
    const onClose = vi.fn();
    renderView({ open: true, inCall: true, state: { ...base, phase: "listening" }, onClose });
    await userEvent.click(screen.getByRole("button", { name: /end call/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("names each phase while in a call", () => {
    for (const [phase, label] of [
      ["listening", /listening/i],
      ["thinking", /thinking/i],
      ["speaking", /speaking/i],
      ["connecting", /connecting/i],
      ["error", /error/i],
    ] as const) {
      const { unmount } = renderView({ open: true, inCall: true, state: { ...base, phase } });
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("explains itself instead of failing when the helper is unavailable", () => {
    renderView({
      open: true,
      inCall: true,
      state: { ...base, phase: "error", error: "Voice helper is unavailable right now." },
    });
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it("offers a retry control in the error phase", async () => {
    const onStartCall = vi.fn();
    renderView({
      open: true,
      inCall: true,
      state: { ...base, phase: "error", error: "The voice helper hit a problem." },
      onStartCall,
    });
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onStartCall).toHaveBeenCalled();
  });

  it("does not offer a retry control outside the error phase", () => {
    renderView({ open: true, inCall: true, state: { ...base, phase: "listening" } });
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows a paused state with a resume control after the idle guard closes the session", () => {
    renderView({ open: true, inCall: true, state: { ...base, phase: "idle" } });
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("resumes on click", async () => {
    const onStartCall = vi.fn();
    renderView({ open: true, inCall: true, state: { ...base, phase: "idle" }, onStartCall });
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(onStartCall).toHaveBeenCalled();
  });

  it("does not show live phase text while paused", () => {
    renderView({ open: true, inCall: true, state: { ...base, phase: "idle" } });
    expect(screen.queryByText(/listening/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/speaking/i)).not.toBeInTheDocument();
  });

  it("offers a close control while paused", async () => {
    const onClose = vi.fn();
    renderView({ open: true, inCall: true, state: { ...base, phase: "idle" }, onClose });
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("mounts the live-call panel inside an animated (spring) entrance wrapper", () => {
    renderView({ open: true, inCall: true, state: { ...base, phase: "listening" } });
    const panel = screen.getByTestId("helper-panel");
    const style = panel.getAttribute("style") ?? "";
    expect(style).toContain("opacity");
  });

  it("renders a helper turn inside its own rise-in wrapper as it arrives", () => {
    renderView({
      open: true,
      inCall: true,
      state: {
        ...base,
        phase: "listening",
        turns: [{ role: "helper", text: "what do you think it needs?" }],
      },
    });
    const bubble = screen.getByText("what do you think it needs?");
    // CoachBubble wraps helper turns in the Rise entrance primitive — the
    // ancestor carrying the animated `style` attribute is that wrapper, not
    // the panel's own spring wrapper (both apply, but this checks the inner one).
    const animatedAncestor = bubble.closest("[style]");
    expect(animatedAncestor).not.toBeNull();
    expect(animatedAncestor?.getAttribute("style") ?? "").toContain("opacity");
  });
});

// F4: keyboard focus must move into the composer on open, and back to the
// trigger that opened it on close — otherwise both actions strand focus on
// <body>.
describe("HelperPanelView — focus management", () => {
  it("focuses the composer when the panel opens", () => {
    const { rerender } = render(
      <HelperPanelView
        state={base}
        open={false}
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={noop}
        onStartCall={noop}
      />
    );
    rerender(
      <HelperPanelView
        state={base}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={noop}
        onStartCall={noop}
      />
    );
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("returns focus to the trigger when the panel closes", () => {
    const { rerender } = render(
      <HelperPanelView
        state={base}
        open
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={noop}
        onStartCall={noop}
      />
    );
    rerender(
      <HelperPanelView
        state={base}
        open={false}
        onOpen={noop}
        onClose={noop}
        inCall={false}
        sending={false}
        onSend={noop}
        onStartCall={noop}
      />
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /talk it through/i }));
  });
});

// The two tests below drive the real wired `HelperPanel`, not the pure
// view — they exist to guard the exact guarantees the view can't see: that
// opening never touches the mic/socket, and that a send racing a call start
// can't lose a message.
describe("HelperPanel — wiring", () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let audioContextMock: ReturnType<typeof vi.fn>;
  let originalMediaDevices: PropertyDescriptor | undefined;
  let originalAudioContext: unknown;

  beforeEach(() => {
    originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, "mediaDevices");
    originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;

    getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream);
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });

    // A minimal stand-in — just enough that connect() (if it runs) doesn't
    // throw. Real Web Audio isn't available in jsdom.
    audioContextMock = vi.fn(() => ({
      createMediaStreamSource: () => ({ connect: () => {} }),
      createScriptProcessor: () => ({ connect: () => {}, disconnect: () => {}, onaudioprocess: null }),
      close: () => Promise.resolve(),
    }));
    (window as unknown as { AudioContext: unknown }).AudioContext = audioContextMock;
  });

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(window.navigator, "mediaDevices", originalMediaDevices);
    } else {
      delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    vi.unstubAllGlobals();
  });

  it("never touches the mic, a socket, or fetch just by opening", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/deepgram/token") return { ok: true, json: async () => ({}) } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HelperPanel />);
    // Let the mount-time availability probe (a plain GET, no token minted)
    // settle before measuring what opening itself does.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /talk it through/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(audioContextMock).not.toHaveBeenCalled();
  });

  it("does not lose a message whose reply resolves while a call is starting", async () => {
    let resolveHelperFetch: (value: unknown) => void = () => {};
    const helperFetchPromise = new Promise((resolve) => {
      resolveHelperFetch = resolve;
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/deepgram/token") {
        if (init?.method === "POST") {
          // No token minted — a real connect attempt fails fast and
          // harmlessly, without needing a fake socket.
          return { ok: false, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url === "/api/helper") return helperFetchPromise as Promise<Response>;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HelperPanel />);
    await userEvent.click(screen.getByRole("button", { name: /talk it through/i }));
    await userEvent.type(screen.getByRole("textbox"), "what makes a claim good");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // The send is now in flight (sending === true). Attempt to escalate
    // before it resolves — this is the race: Start voice call must be
    // inert right now, not snapshot a stale `turns`.
    await userEvent.click(screen.getByRole("button", { name: /start voice call/i }));

    resolveHelperFetch({ ok: true, json: async () => ({ reply: "what do you think it needs?" }) });

    // If the race had been lost, a call would now be live on a stale
    // snapshot and this reply — appended to `turns`, not the session's
    // state — would never reach the screen.
    await waitFor(() => expect(screen.getByText("what do you think it needs?")).toBeInTheDocument());
    expect(screen.getByText("what makes a claim good")).toBeInTheDocument();

    // Now actually start a call (no send in flight) and end it, to prove
    // the end-of-call merge itself doesn't drop turns that are legitimately
    // part of the up-to-date snapshot.
    await userEvent.click(screen.getByRole("button", { name: /start voice call/i }));
    await userEvent.click(await screen.findByRole("button", { name: /end call/i }));

    expect(screen.getByText("what makes a claim good")).toBeInTheDocument();
    expect(screen.getByText("what do you think it needs?")).toBeInTheDocument();
  });

  // F1: a deploy with ANTHROPIC_API_KEY but no DEEPGRAM_API_KEY must still
  // let a student open and use text chat — only "Start voice call" may be
  // affected by the voice availability probe.
  it("keeps the trigger, the panel, and the composer working when the voice probe 503s — only Start voice call is disabled", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/deepgram/token") {
        if (init?.method === "GET") return { ok: false, json: async () => ({}) } as Response;
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url === "/api/helper") {
        return { ok: true, json: async () => ({ reply: "what do you think it needs?" }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HelperPanel />);

    // The trigger opens the chat regardless of the probe's outcome or timing.
    const trigger = screen.getByRole("button", { name: /talk it through/i });
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger);
    expect(await screen.findByRole("textbox")).toBeInTheDocument();

    // Once the 503 probe settles, only Start voice call is affected.
    await waitFor(() => expect(screen.getByRole("button", { name: /start voice call/i })).toBeDisabled());
    expect(screen.getByText(/voice helper is unavailable right now/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();

    // And the composer actually works — text chat needs neither Deepgram
    // nor a microphone.
    await userEvent.type(screen.getByRole("textbox"), "what makes a claim good");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText("what do you think it needs?")).toBeInTheDocument());
  });

  // A message over the server's per-turn cap always 400s. Warning before
  // sending — instead of dispatching a doomed request and showing the
  // generic "try again" message — means Send never fails in a way that
  // looks fixable by retrying when it isn't.
  it("warns before sending a message over the length cap, without calling the helper API", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/deepgram/token") return { ok: true, json: async () => ({}) } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HelperPanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /talk it through/i }));
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.paste("x".repeat(2001));
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText(/too long/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a student start a fresh conversation, clearing the stuck thread", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/deepgram/token") return { ok: true, json: async () => ({}) } as Response;
      if (url === "/api/helper") return { ok: true, json: async () => ({ reply: "got it" }) } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HelperPanel />);
    await userEvent.click(screen.getByRole("button", { name: /talk it through/i }));
    const textbox = screen.getByRole("textbox");
    await userEvent.click(textbox);
    await userEvent.paste("what makes a claim good");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText("got it")).toBeInTheDocument());

    // Force the stuck-chat state a student would actually hit, then recover.
    await userEvent.click(textbox);
    await userEvent.paste("x".repeat(2001));
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await screen.findByText(/too long/i);

    await userEvent.click(screen.getByRole("button", { name: /start a new conversation/i }));

    expect(screen.queryByText("what makes a claim good")).toBeNull();
    expect(screen.queryByText("got it")).toBeNull();
    expect(screen.queryByText(/too long/i)).toBeNull();
  }, 15000);
});

// F2: turns spoken before an idle pause must survive Resume, and survive
// End call afterward. This drives the real wired HelperPanel through a full
// text-then-voice-then-pause-then-resume sequence, with a fake Deepgram
// agent socket standing in for the real one.
describe("HelperPanel — wiring (resume after an idle pause)", () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let originalMediaDevices: PropertyDescriptor | undefined;
  let originalAudioContext: unknown;

  beforeEach(() => {
    fakeSockets.length = 0;
    originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, "mediaDevices");
    originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;

    getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream);
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });
    (window as unknown as { AudioContext: unknown }).AudioContext = vi.fn(() => ({
      createMediaStreamSource: () => ({ connect: () => {} }),
      createScriptProcessor: () => ({ connect: () => {}, disconnect: () => {}, onaudioprocess: null }),
      close: () => Promise.resolve(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalMediaDevices) {
      Object.defineProperty(window.navigator, "mediaDevices", originalMediaDevices);
    } else {
      delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    vi.unstubAllGlobals();
  });

  it("keeps turns spoken before a 90s idle pause through Resume, and through End call", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/deepgram/token") {
        if (init?.method === "GET") return { ok: true, json: async () => ({}) } as Response;
        return { ok: true, json: async () => ({ access_token: "tok" }) } as Response;
      }
      if (url === "/api/helper") {
        const body = JSON.parse(String(init?.body)) as { messages: { text: string }[] };
        const last = body.messages[body.messages.length - 1].text;
        return { ok: true, json: async () => ({ reply: `re: ${last}` }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const flush = async (ms = 0) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    render(<HelperPanel />);
    await flush(); // let the mount-time voice probe settle

    // Type two messages before ever touching voice.
    await user.click(screen.getByRole("button", { name: /talk it through/i }));
    await user.type(screen.getByRole("textbox"), "typed message one");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await flush();
    expect(screen.getByText("re: typed message one")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "typed message two");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await flush();
    expect(screen.getByText("re: typed message two")).toBeInTheDocument();

    // Start a call — this carries the typed thread across as initialTurns.
    await user.click(screen.getByRole("button", { name: /start voice call/i }));
    await flush();
    expect(fakeSockets).toHaveLength(1);
    const firstSocket = fakeSockets[0];

    // Speak four turns.
    await act(async () => {
      firstSocket.fire("ConversationText", { role: "user", content: "spoken turn one" });
      firstSocket.fire("ConversationText", { role: "assistant", content: "spoken reply one" });
      firstSocket.fire("ConversationText", { role: "user", content: "spoken turn two" });
      firstSocket.fire("ConversationText", { role: "assistant", content: "spoken reply two" });
    });
    expect(screen.getByText("spoken turn one")).toBeInTheDocument();
    expect(screen.getByText("spoken reply two")).toBeInTheDocument();

    // Pause: 90s of silence trips the idle guard, closing the session but
    // leaving the panel open on a "Resume" affordance.
    await flush(90_000);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    const resumeButton = screen.getByRole("button", { name: /resume/i });

    // Resume — this is the bug: a reseed from the stale typed-turns ref
    // would wipe out everything spoken above.
    await user.click(resumeButton);
    await flush();

    expect(screen.getByText("typed message one")).toBeInTheDocument();
    expect(screen.getByText("typed message two")).toBeInTheDocument();
    expect(screen.getByText("spoken turn one")).toBeInTheDocument();
    expect(screen.getByText("spoken reply one")).toBeInTheDocument();
    expect(screen.getByText("spoken turn two")).toBeInTheDocument();
    expect(screen.getByText("spoken reply two")).toBeInTheDocument();

    // End the call — the merge back into the text thread must not drop them
    // either.
    await user.click(screen.getByRole("button", { name: /end call/i }));
    await flush();

    expect(screen.getByText("typed message one")).toBeInTheDocument();
    expect(screen.getByText("typed message two")).toBeInTheDocument();
    expect(screen.getByText("spoken turn one")).toBeInTheDocument();
    expect(screen.getByText("spoken reply one")).toBeInTheDocument();
    expect(screen.getByText("spoken turn two")).toBeInTheDocument();
    expect(screen.getByText("spoken reply two")).toBeInTheDocument();
  });
});
