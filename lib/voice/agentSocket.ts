/**
 * Minimal browser client for the Deepgram Voice Agent WebSocket.
 *
 * Why not `createClient(token).agent()` from @deepgram/sdk? Its live client
 * always opens the socket with the `token` subprotocol, which is only valid
 * for a long-lived API key. We hand the browser a short-lived access token
 * (minted by /api/deepgram/token), and those need the `bearer` subprotocol;
 * with `token` the handshake is refused and the browser reports close code
 * 1006 with no message. The SDK client also lacks `requestClose`, which the
 * app was calling on teardown. This client speaks the same messages the SDK
 * would (Settings, UpdatePrompt, InjectAgentMessage, KeepAlive) and emits the
 * same event names Deepgram sends, so the session code above it is unchanged.
 */

export const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

export type AgentSocketLike = {
  on(event: string, handler: (payload: unknown) => void): void;
  configure(options: unknown): void;
  updatePrompt(prompt: string): void;
  injectAgentMessage(message: string): void;
  send(data: ArrayBuffer): void;
  keepAlive(): void;
  requestClose(): void;
};

type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocket;

export function openAgentSocket(
  accessToken: string,
  opts: { url?: string; WebSocketImpl?: WebSocketCtor } = {},
): AgentSocketLike {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const ws = new Impl(opts.url ?? AGENT_URL, ["bearer", accessToken]);
  ws.binaryType = "arraybuffer";

  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const emit = (event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) h(payload);
  };
  // Messages queued until the socket opens; Settings must be the first
  // frame Deepgram sees, and callers configure() right after construction.
  const pending: (string | ArrayBuffer)[] = [];
  let open = false;

  const sendRaw = (data: string | ArrayBuffer) => {
    if (open && ws.readyState === ws.OPEN) ws.send(data);
    else if (!open) pending.push(data);
  };

  ws.onopen = () => {
    open = true;
    for (const p of pending) ws.send(p);
    pending.length = 0;
    emit("Open", undefined);
  };
  ws.onclose = (ev) => {
    open = false;
    emit("Close", { code: ev.code, reason: ev.reason });
  };
  ws.onerror = (ev) => emit("Error", ev);
  ws.onmessage = (ev) => {
    const data = ev.data;
    if (typeof data === "string") {
      let parsed: { type?: string } | null = null;
      try {
        parsed = JSON.parse(data) as { type?: string };
      } catch {
        emit("Error", { message: "Unparseable message from the agent." });
        return;
      }
      if (parsed?.type) emit(parsed.type, parsed);
      return;
    }
    if (data instanceof ArrayBuffer) emit("Audio", data);
    else if (data instanceof Blob) void data.arrayBuffer().then((buf) => emit("Audio", buf));
  };

  return {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    configure(options) {
      sendRaw(JSON.stringify({ type: "Settings", ...(options as object) }));
    },
    updatePrompt(prompt) {
      sendRaw(JSON.stringify({ type: "UpdatePrompt", prompt }));
    },
    injectAgentMessage(message) {
      sendRaw(JSON.stringify({ type: "InjectAgentMessage", message }));
    },
    send(data) {
      sendRaw(data);
    },
    keepAlive() {
      sendRaw(JSON.stringify({ type: "KeepAlive" }));
    },
    requestClose() {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}
