import { describe, it, expect, vi } from "vitest";
import { openAgentSocket, AGENT_URL } from "@/lib/voice/agentSocket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  url: string;
  protocols: string | string[] | undefined;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "bye" });
  });
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function make() {
  FakeWebSocket.instances = [];
  const sock = openAgentSocket("tok-123", { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket });
  const ws = FakeWebSocket.instances[0];
  return { sock, ws };
}

describe("openAgentSocket", () => {
  it("connects to the agent endpoint with the bearer subprotocol for an access token", () => {
    const { ws } = make();
    expect(ws.url).toBe(AGENT_URL);
    expect(ws.protocols).toEqual(["bearer", "tok-123"]);
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("queues Settings until the socket opens, then flushes in order", () => {
    const { sock, ws } = make();
    sock.configure({ agent: { think: { prompt: "p" } } });
    sock.keepAlive();
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.sent.map((s) => JSON.parse(s as string).type)).toEqual(["Settings", "KeepAlive"]);
    expect(JSON.parse(ws.sent[0] as string).agent.think.prompt).toBe("p");
  });

  it("sends prompt updates, injected messages, and audio once open", () => {
    const { sock, ws } = make();
    ws.open();
    sock.updatePrompt("new prompt");
    sock.injectAgentMessage("Round 2.");
    const pcm = new Int16Array([1, 2]).buffer;
    sock.send(pcm);
    expect(JSON.parse(ws.sent[0] as string)).toEqual({ type: "UpdatePrompt", prompt: "new prompt" });
    expect(JSON.parse(ws.sent[1] as string)).toEqual({ type: "InjectAgentMessage", message: "Round 2." });
    expect(ws.sent[2]).toBe(pcm);
  });

  it("emits typed JSON events by their type and binary frames as Audio", () => {
    const { sock, ws } = make();
    const text = vi.fn();
    const audio = vi.fn();
    sock.on("ConversationText", text);
    sock.on("Audio", audio);
    ws.open();
    ws.onmessage?.({ data: JSON.stringify({ type: "ConversationText", role: "assistant", content: "Hi" }) });
    const buf = new ArrayBuffer(4);
    ws.onmessage?.({ data: buf });
    expect(text).toHaveBeenCalledWith({ type: "ConversationText", role: "assistant", content: "Hi" });
    expect(audio).toHaveBeenCalledWith(buf);
  });

  it("emits Open, Close with the code, and Error", () => {
    const { sock, ws } = make();
    const opened = vi.fn();
    const closed = vi.fn();
    const errored = vi.fn();
    sock.on("Open", opened);
    sock.on("Close", closed);
    sock.on("Error", errored);
    ws.open();
    ws.onerror?.({ type: "error" });
    sock.requestClose();
    expect(opened).toHaveBeenCalled();
    expect(errored).toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith({ code: 1000, reason: "bye" });
    expect(ws.close).toHaveBeenCalled();
  });
});
