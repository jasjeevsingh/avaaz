import { describe, it, expect } from "vitest";
import { buildAvatarAgentPrompt, avatarGreeting } from "@/lib/avatar/agentPrompt";
import { initSession, startDebatePhase, appendTurn } from "@/lib/avatar/sessionReducer";

const motion = "This House would ban homework.";

describe("buildAvatarAgentPrompt", () => {
  it("states the motion and both sides and forbids written formatting", () => {
    const p = buildAvatarAgentPrompt(initSession("sparring", motion, "m", "darshan", "for"));
    expect(p).toContain(motion);
    expect(p).toContain("You are arguing AGAINST");
    expect(p).toContain("student is arguing FOR");
    expect(p).toMatch(/no markdown/i);
    expect(p).toMatch(/never mention that you are an ai/i);
  });

  it("tells the sparring opponent to argue to win and names the round", () => {
    const p = buildAvatarAgentPrompt({ ...initSession("sparring", motion, "m", "pyaas", "against"), currentRound: 2 });
    expect(p).toContain("Round 2 of 3");
    expect(p).toMatch(/argue to win/i);
    expect(p).toMatch(/rebut/i);
  });

  it("tells the pushback coach to ask one question at a time", () => {
    const p = buildAvatarAgentPrompt(initSession("pushback", motion, "m", "surat", "for"));
    expect(p).toMatch(/exactly one sharp question/i);
    expect(p).toMatch(/gentle/i);
  });

  it("keeps the collaborative avatar on the same side while building, then flips it with the built case listed", () => {
    let s = initSession("collaborative", motion, "m", "darshan", "for");
    const building = buildAvatarAgentPrompt(s);
    expect(building).toContain("You are arguing FOR. The student is arguing FOR.");
    expect(building).toMatch(/same side/i);
    s = appendTurn(s, "student", "Kids need rest to learn.").session;
    s = appendTurn(s, "avatar", "Good. What's the evidence?").session;
    const debating = buildAvatarAgentPrompt(startDebatePhase(s));
    expect(debating).toContain("You are arguing AGAINST");
    expect(debating).toMatch(/switched sides/i);
    expect(debating).toContain("Kids need rest to learn.");
  });

  it("applies the cohort word limit", () => {
    expect(buildAvatarAgentPrompt(initSession("sparring", motion, "m", "surat", "for"))).toContain("under 80 words");
    expect(buildAvatarAgentPrompt(initSession("sparring", motion, "m", "pyaas", "for"))).toContain("under 150 words");
  });
});

describe("avatarGreeting", () => {
  it("uses the generated opening when the avatar opens a sparring round", () => {
    const s = initSession("sparring", motion, "m", "darshan", "for", { avatarOpens: true });
    expect(avatarGreeting(s, "Homework builds discipline.")).toBe("Homework builds discipline.");
  });
  it("invites the student to open otherwise", () => {
    const s = initSession("sparring", motion, "m", "darshan", "against", { avatarOpens: false });
    expect(avatarGreeting(s, null)).toMatch(/you're up first/i);
    expect(avatarGreeting(s, null)).toContain("against");
  });
  it("has fixed cues for pushback and building", () => {
    expect(avatarGreeting(initSession("pushback", motion, "m", "darshan", "for"))).toMatch(/strongest claim/i);
    expect(avatarGreeting(initSession("collaborative", motion, "m", "darshan", "for"))).toMatch(/build your case together/i);
  });
});
