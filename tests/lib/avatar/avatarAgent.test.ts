import { describe, it, expect, vi } from "vitest";
import { createAvatarAgent, avatarAgentConfig, type AvatarAgentEvent } from "@/lib/avatar/avatarAgent";

function harness(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (p: unknown) => void>();
  const socket = {
    on: (e: string, h: (p: unknown) => void) => void handlers.set(e, h),
    configure: vi.fn(),
    updatePrompt: vi.fn(),
    injectAgentMessage: vi.fn(),
    send: vi.fn(),
    keepAlive: vi.fn(),
    requestClose: vi.fn(),
  };
  const queue = { push: vi.fn(), drop: vi.fn(), close: vi.fn() };
  const events: AvatarAgentEvent[] = [];
  const agent = createAvatarAgent({
    fetchToken: async () => "tok",
    createSocket: () => socket,
    createQueue: () => queue,
    onEvent: (e) => events.push(e),
    ...overrides,
  });
  return { agent, socket, queue, events, fire: (e: string, p?: unknown) => handlers.get(e)?.(p) };
}

const turns = (events: AvatarAgentEvent[]) => events.filter((e) => e.type === "turn");
const phases = (events: AvatarAgentEvent[]) => events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase);

describe("avatarAgentConfig", () => {
  it("uses Deepgram listen/speak with Claude thinking and an optional greeting", () => {
    const cfg = avatarAgentConfig("PROMPT", "Hello there") as { agent: { think: { prompt: string; provider: { type: string } }; greeting?: string } };
    expect(cfg.agent.think.prompt).toBe("PROMPT");
    expect(cfg.agent.think.provider.type).toBe("anthropic");
    expect(cfg.agent.greeting).toBe("Hello there");
    expect((avatarAgentConfig("P") as { agent: { greeting?: string } }).agent.greeting).toBeUndefined();
  });
});

describe("createAvatarAgent", () => {
  it("configures the socket with the prompt and greeting before any audio", async () => {
    const h = harness();
    await h.agent.start("You are arguing AGAINST.", "You're up first.");
    expect(h.socket.configure).toHaveBeenCalledTimes(1);
    const cfg = JSON.stringify(h.socket.configure.mock.calls[0][0]);
    expect(cfg).toContain("You are arguing AGAINST.");
    expect(cfg).toContain("You're up first.");
    expect(phases(h.events)).toEqual(["connecting"]);
  });

  it("emits student and avatar turns from ConversationText", async () => {
    const h = harness();
    await h.agent.start("p");
    h.fire("SettingsApplied");
    h.fire("ConversationText", { role: "user", content: "Homework should go." });
    h.fire("ConversationText", { role: "assistant", content: "Practice makes skills stick." });
    expect(turns(h.events)).toEqual([
      { type: "turn", speaker: "student", text: "Homework should go." },
      { type: "turn", speaker: "avatar", text: "Practice makes skills stick." },
    ]);
  });

  it("tracks listening / thinking / speaking phases", async () => {
    const h = harness();
    await h.agent.start("p");
    h.fire("SettingsApplied");
    h.fire("AgentThinking");
    h.fire("Audio", new Int16Array([1, 2]).buffer);
    h.fire("AgentAudioDone");
    expect(phases(h.events)).toEqual(["connecting", "listening", "thinking", "speaking", "listening"]);
    expect(h.queue.push).toHaveBeenCalledTimes(1);
  });

  it("drops queued audio and suppresses trailing frames when the student interrupts", async () => {
    const h = harness();
    await h.agent.start("p");
    h.fire("Audio", new Int16Array([1, 2]).buffer);
    h.fire("UserStartedSpeaking");
    expect(h.queue.drop).toHaveBeenCalled();
    h.fire("Audio", new Int16Array([3, 4]).buffer);
    expect(h.queue.push).toHaveBeenCalledTimes(1);
    h.fire("AgentThinking");
    h.fire("Audio", new Int16Array([5, 6]).buffer);
    expect(h.queue.push).toHaveBeenCalledTimes(2);
  });

  it("does not forward microphone audio while muted", async () => {
    const h = harness();
    await h.agent.start("p");
    const pcm = new Int16Array([1]).buffer;
    h.agent.send(pcm);
    h.agent.setMuted(true);
    h.agent.send(pcm);
    expect(h.socket.send).toHaveBeenCalledTimes(1);
    expect(h.agent.isMuted()).toBe(true);
  });

  it("passes prompt updates and injected lines through, and does not double-record an injected line", async () => {
    const h = harness();
    await h.agent.start("p");
    h.agent.updatePrompt("Round 2 prompt");
    expect(h.socket.updatePrompt).toHaveBeenCalledWith("Round 2 prompt");
    h.agent.inject("Round 2. Your turn.");
    expect(h.socket.injectAgentMessage).toHaveBeenCalledWith("Round 2. Your turn.");
    h.fire("ConversationText", { role: "assistant", content: "Round 2. Your turn." });
    expect(turns(h.events)).toEqual([]);
    h.fire("ConversationText", { role: "assistant", content: "A fresh reply." });
    expect(turns(h.events)).toHaveLength(1);
  });

  it("reports an error and stops when the token cannot be minted", async () => {
    const h = harness({ fetchToken: async () => { throw new Error("503"); } });
    await h.agent.start("p");
    expect(h.events.some((e) => e.type === "error")).toBe(true);
    expect(phases(h.events)).toEqual(["connecting", "error"]);
    expect(h.socket.configure).not.toHaveBeenCalled();
  });

  it("stop closes the socket and queue and ignores late events", async () => {
    const h = harness();
    await h.agent.start("p");
    h.agent.stop();
    expect(h.socket.requestClose).toHaveBeenCalled();
    expect(h.queue.close).toHaveBeenCalled();
    h.fire("ConversationText", { role: "user", content: "late" });
    expect(turns(h.events)).toEqual([]);
  });
});
