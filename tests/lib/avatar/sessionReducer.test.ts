import { describe, it, expect } from "vitest";
import {
  initSession,
  appendTurn,
  advanceRound,
  startDebatePhase,
  readyToDebate,
  exchangesInRound,
} from "@/lib/avatar/sessionReducer";
import type { AvatarSession } from "@/lib/avatar/types";

function play(s: AvatarSession, turns: ("student" | "avatar")[]) {
  const all: ReturnType<typeof appendTurn>["actions"][] = [];
  let cur = s;
  for (const t of turns) {
    const out = appendTurn(cur, t, `${t} says something`);
    cur = out.session;
    all.push(out.actions);
  }
  return { session: cur, actions: all };
}

describe("initSession", () => {
  it("puts the avatar on the opposite side for sparring and pushback", () => {
    expect(initSession("sparring", "M", "m", "darshan", "for").avatarSide).toBe("against");
    expect(initSession("pushback", "M", "m", "darshan", "against").avatarSide).toBe("for");
  });
  it("puts the avatar on the same side for collaborative building", () => {
    const s = initSession("collaborative", "M", "m", "darshan", "for");
    expect(s.avatarSide).toBe("for");
    expect(s.phase).toBe("collaborative");
  });
  it("honours a forced coin flip for the sparring opening", () => {
    expect(initSession("sparring", "M", "m", "darshan", "for", { avatarOpens: true }).avatarOpens).toBe(true);
    expect(initSession("pushback", "M", "m", "darshan", "for", { avatarOpens: true }).avatarOpens).toBe(false);
  });
});

describe("sparring rounds", () => {
  it("completes a round after three student/avatar exchanges and scores the whole round", () => {
    const s = initSession("sparring", "M", "m", "darshan", "for", { avatarOpens: false });
    const { actions } = play(s, ["student", "avatar", "student", "avatar", "student", "avatar"]);
    expect(actions.slice(0, 5).every((a) => a.length === 0)).toBe(true);
    const last = actions[5];
    expect(last.map((a) => a.type)).toEqual(["score", "roundComplete"]);
    expect(last[0]).toMatchObject({ scoreType: "round", criteria: ["argumentation", "engagement"], slice: [0, 6] });
  });

  it("does not count the avatar's opening statement as an exchange", () => {
    const s = initSession("sparring", "M", "m", "darshan", "for", { avatarOpens: true });
    const { session, actions } = play(s, ["avatar", "student", "avatar", "student", "avatar", "student", "avatar"]);
    expect(exchangesInRound(session)).toBe(3);
    expect(actions[5]).toEqual([]);
    expect(actions[6].map((a) => a.type)).toEqual(["score", "roundComplete"]);
  });

  it("ends the session after the final round", () => {
    let s = initSession("sparring", "M", "m", "darshan", "for", { avatarOpens: false });
    s = { ...s, currentRound: s.totalRounds };
    const { actions } = play(s, ["student", "avatar", "student", "avatar", "student", "avatar"]);
    expect(actions[5].map((a) => a.type)).toEqual(["score", "roundComplete", "sessionComplete"]);
  });

  it("advanceRound moves the round window to the end of the transcript", () => {
    const s = initSession("sparring", "M", "m", "darshan", "for", { avatarOpens: false });
    const { session } = play(s, ["student", "avatar", "student", "avatar", "student", "avatar"]);
    const next = advanceRound(session);
    expect(next.currentRound).toBe(2);
    expect(next.roundStart).toBe(6);
    expect(exchangesInRound(next)).toBe(0);
  });

  it("ignores empty text", () => {
    const s = initSession("sparring", "M", "m", "darshan", "for");
    expect(appendTurn(s, "student", "   ").session.transcript).toHaveLength(0);
  });
});

describe("pushback", () => {
  it("scores argumentation inline after every exchange and never ends on its own", () => {
    const s = initSession("pushback", "M", "m", "pyaas", "for");
    const { actions } = play(s, ["student", "avatar", "student", "avatar", "student", "avatar", "student", "avatar"]);
    for (let i = 1; i < actions.length; i += 2) {
      expect(actions[i].map((a) => a.type)).toEqual(["score"]);
      expect(actions[i][0]).toMatchObject({ scoreType: "inline", criteria: ["argumentation"], turnIndex: i - 1 });
    }
    expect(actions.flat().some((a) => a.type === "roundComplete")).toBe(false);
  });
});

describe("collaborative", () => {
  it("never scores while building and offers the debate after two student turns", () => {
    const s = initSession("collaborative", "M", "m", "surat", "for");
    expect(readyToDebate(s)).toBe(false);
    const { session, actions } = play(s, ["student", "avatar", "student", "avatar"]);
    expect(actions.flat()).toEqual([]);
    expect(readyToDebate(session)).toBe(true);
  });

  it("switches sides for the debate and scores engagement inline, then completes a round after two exchanges", () => {
    const built = play(initSession("collaborative", "M", "m", "surat", "for"), ["student", "avatar", "student", "avatar"]).session;
    const debating = startDebatePhase(built);
    expect(debating.avatarSide).toBe("against");
    expect(debating.phase).toBe("debate");
    expect(debating.roundStart).toBe(4);
    const { actions } = play(debating, ["student", "avatar", "student", "avatar"]);
    expect(actions[1].map((a) => a.type)).toEqual(["score"]);
    expect(actions[1][0]).toMatchObject({ scoreType: "inline", criteria: ["engagement"] });
    expect(actions[3].map((a) => a.type)).toEqual(["score", "roundComplete"]);
    expect(actions[3][0]).toMatchObject({ scoreType: "round", slice: [4, 8] });
  });
});
