import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvatarShell } from "@/components/avatar/AvatarShell";
import type { AvatarAgentDeps, AvatarAgentEvent } from "@/lib/avatar/avatarAgent";

vi.mock("@/lib/voice/playSpeech", () => ({
  speakCoach: vi.fn(async () => {}),
  stopSpeech: vi.fn(),
}));

/** A fake live agent: the test fires the events Deepgram would. */
function makeFakeAgent() {
  let emit: ((e: AvatarAgentEvent) => void) | null = null;
  const agent = {
    start: vi.fn(async () => {
      emit?.({ type: "phase", phase: "listening" });
    }),
    updatePrompt: vi.fn(),
    inject: vi.fn(),
    setMuted: vi.fn(),
    isMuted: () => false,
    send: vi.fn(),
    keepAlive: vi.fn(),
    stop: vi.fn(),
  };
  const factory = (deps: AvatarAgentDeps) => {
    emit = deps.onEvent;
    return agent;
  };
  const fire = (e: AvatarAgentEvent) => act(() => emit?.(e));
  const say = (speaker: "student" | "avatar", text: string) => fire({ type: "turn", speaker, text });
  return { agent, factory, fire, say };
}

const ROUND_SCORE = {
  argumentation: { claim: 2, link: 2, impact: 2, weighing: 1 },
  engagement: { breadth: 2, depth: 2, responsive: 2, crystallizing: 1 },
  rationales: { claim: "ok", link: "ok", impact: "ok", weighing: "ok", breadth: "ok", depth: "ok", responsive: "ok", crystallizing: "ok" },
  focusArea: "weighing",
  focusTip: "Compare worlds.",
};

let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  localStorage.clear();
  fetchCalls = [];
  vi.spyOn(Math, "random").mockReturnValue(0.9); // student opens sparring
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      fetchCalls.push({ url, body });
      if (url.includes("/api/avatar/score")) {
        const payload = body.scoreType === "round" ? ROUND_SCORE : { criterion: "link", score: 2, rationale: "Solid link." };
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      if (url.includes("/api/avatar/turn")) {
        return new Response(JSON.stringify({ text: "Generated avatar line." }), { status: 200 });
      }
      if (url.includes("/api/deepgram/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

const mic = vi.fn(async () => ({ stop: vi.fn() }));

async function startSparring(user: ReturnType<typeof userEvent.setup>, factory: (d: AvatarAgentDeps) => ReturnType<typeof makeFakeAgent>["agent"]) {
  render(<AvatarShell onExit={() => {}} agentFactory={factory} startMic={mic} />);
  await user.click(screen.getByRole("button", { name: /sparring/i }));
    await user.click(screen.getByRole("button", { name: /pick a motion/i }));
  await user.click(screen.getAllByRole("button", { name: /This House/ })[0]);
  await user.click(screen.getByRole("button", { name: /argue for/i }));
  await screen.findByRole("status");
}

describe("Avatar live session", () => {
  it("connects a live call on entering a sparring session and invites the student to open", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    await startSparring(user, fake.factory);
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalledTimes(1));
    const [prompt, greeting] = fake.agent.start.mock.calls[0] as unknown as [string, string];
    expect(prompt).toContain("You are arguing AGAINST");
    expect(greeting).toMatch(/you're up first/i);
    expect(mic).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/listening/i);
  });

  it("records spoken turns, shows the avatar's last line, and scores the round after three exchanges", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    await startSparring(user, fake.factory);
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalled());

    for (let i = 1; i <= 3; i++) {
      fake.say("student", `Student point ${i}.`);
      fake.say("avatar", `Avatar rebuttal ${i}.`);
    }
    expect(await screen.findByText(/round 1 score/i)).toBeInTheDocument();
    expect(fake.agent.setMuted).toHaveBeenLastCalledWith(true);
    const scoreCall = fetchCalls.find((c) => c.url.includes("/api/avatar/score"));
    expect(scoreCall?.body).toMatchObject({ scoreType: "round", mode: "sparring" });
    expect((scoreCall?.body.transcript as unknown[]).length).toBe(6);

    await user.click(screen.getByRole("button", { name: /next round/i }));
    expect(fake.agent.updatePrompt).toHaveBeenCalledWith(expect.stringContaining("Round 2 of 3"));
    expect(fake.agent.inject).toHaveBeenCalledWith(expect.stringMatching(/round 2/i));
    expect(fake.agent.setMuted).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/round 2 of 3/i)).toBeInTheDocument();
  });

  it("lets the student type instead: the reply is generated and spoken through the live agent", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    await startSparring(user, fake.factory);
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /toggle text input/i }));
    await user.type(screen.getByPlaceholderText(/type your argument/i), "Homework steals sleep.");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(fake.agent.inject).toHaveBeenCalledWith("Generated avatar line."));
    expect(await screen.findByTestId("last-avatar-line")).toHaveTextContent("Generated avatar line.");
    const turnCall = fetchCalls.find((c) => c.url.includes("/api/avatar/turn"));
    expect((turnCall?.body.transcript as { text: string }[]).map((t) => t.text)).toContain("Homework steals sleep.");
  });

  it("falls back to text when the microphone is unavailable", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    const deniedMic = vi.fn(async () => { throw new Error("denied"); });
    render(<AvatarShell onExit={() => {}} agentFactory={fake.factory} startMic={deniedMic} />);
    await user.click(screen.getByRole("button", { name: /sparring/i }));
    await user.click(screen.getByRole("button", { name: /pick a motion/i }));
    await user.click(screen.getAllByRole("button", { name: /This House/ })[0]);
    await user.click(screen.getByRole("button", { name: /argue for/i }));
    expect(await screen.findByText(/microphone unavailable/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/type your argument/i)).toBeInTheDocument();
  });

  it("uses the generated opening as the greeting when the avatar wins the coin flip", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    await startSparring(user, fake.factory);
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalled());
    const [, greeting] = fake.agent.start.mock.calls[0] as unknown as [string, string];
    expect(greeting).toBe("Generated avatar line.");
    expect(screen.getByTestId("last-avatar-line")).toHaveTextContent("Generated avatar line.");
  });

  it("scores pushback exchanges inline and shows the badge in the transcript", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    render(<AvatarShell onExit={() => {}} agentFactory={fake.factory} startMic={mic} />);
    await user.click(screen.getByRole("button", { name: /pushback/i }));
    await user.click(screen.getByRole("button", { name: /pick a motion/i }));
    await user.click(screen.getAllByRole("button", { name: /This House/ })[0]);
    await user.click(screen.getByRole("button", { name: /argue against/i }));
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalled());
    const [, greeting] = fake.agent.start.mock.calls[0] as unknown as [string, string];
    expect(greeting).toMatch(/strongest claim/i);

    fake.say("student", "Homework teaches discipline.");
    fake.say("avatar", "What's the evidence for that?");
    await waitFor(() => expect(fetchCalls.some((c) => c.url.includes("/api/avatar/score"))).toBe(true));
    await user.click(screen.getByRole("button", { name: /^transcript/i }));
    expect(await screen.findByText(/link 2\/3/i)).toBeInTheDocument();
  });

  it("runs Build + Debate: offers the switch after two student turns, then flips sides with a generated opening", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    render(<AvatarShell onExit={() => {}} agentFactory={fake.factory} startMic={mic} />);
    await user.click(screen.getByRole("button", { name: /build.*debate/i }));
    await user.click(screen.getByRole("button", { name: /pick a motion/i }));
    await user.click(screen.getAllByRole("button", { name: /This House/ })[0]);
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalled());
    expect(screen.getByText(/building your case/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ready to debate/i })).toBeNull();

    fake.say("student", "Claim one.");
    fake.say("avatar", "Nice, why?");
    fake.say("student", "Because of reason one.");
    fake.say("avatar", "Good link.");
    await user.click(await screen.findByRole("button", { name: /ready to debate/i }));
    expect(screen.getByRole("heading", { name: /ready to debate/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /let's go/i }));
    await waitFor(() => expect(fake.agent.inject).toHaveBeenCalledWith("Generated avatar line."));
    expect(fake.agent.updatePrompt).toHaveBeenCalledWith(expect.stringContaining("SWITCHED SIDES"));
    expect(await screen.findByText(/^debating$/i)).toBeInTheDocument();
    expect(screen.getByText(/against/i)).toBeInTheDocument();
  });

  it("hangs up cleanly and shows the summary when anything was scored", async () => {
    const user = userEvent.setup();
    const fake = makeFakeAgent();
    render(<AvatarShell onExit={() => {}} agentFactory={fake.factory} startMic={mic} />);
    await user.click(screen.getByRole("button", { name: /pushback/i }));
    await user.click(screen.getByRole("button", { name: /pick a motion/i }));
    await user.click(screen.getAllByRole("button", { name: /This House/ })[0]);
    await user.click(screen.getByRole("button", { name: /argue for/i }));
    await waitFor(() => expect(fake.agent.start).toHaveBeenCalled());
    fake.say("student", "A claim.");
    fake.say("avatar", "A challenge.");
    await waitFor(() => expect(fetchCalls.some((c) => c.url.includes("/api/avatar/score"))).toBe(true));
    await user.click(screen.getByRole("button", { name: /end debate/i }));
    expect(fake.agent.stop).toHaveBeenCalled();
    expect(await screen.findByText(/pushback session summary/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.getByText(/choose your mode/i)).toBeInTheDocument();
  });
});
