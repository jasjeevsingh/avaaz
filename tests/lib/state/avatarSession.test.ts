import { describe, it, expect, beforeEach } from "vitest";
import {
  AVATAR_STORAGE_KEY,
  saveAvatarSession,
  loadAvatarSession,
  listAvatarSessions,
} from "@/lib/state/avatarSession";
import type { AvatarSession } from "@/lib/avatar/types";

const SAMPLE_SESSION: AvatarSession = {
  id: "test-1",
  mode: "sparring",
  motionId: "m-homework",
  motionText: "Ban homework",
  cohort: "darshan",
  studentSide: "for",
  avatarSide: "against",
  transcript: [],
  inlineScores: [],
  roundScores: [],
  phase: "debate",
  currentRound: 1,
  totalRounds: 3,
  roundStart: 0,
  avatarOpens: false,
  startedAt: 1000,
  endedAt: null,
};

beforeEach(() => localStorage.clear());

describe("saveAvatarSession / loadAvatarSession", () => {
  it("round-trips a session through localStorage", () => {
    saveAvatarSession(localStorage, SAMPLE_SESSION);
    const loaded = loadAvatarSession(localStorage, "test-1");
    expect(loaded).toEqual(SAMPLE_SESSION);
  });

  it("returns null for a missing session", () => {
    expect(loadAvatarSession(localStorage, "nonexistent")).toBeNull();
  });

  it("overwrites an existing session with the same id", () => {
    saveAvatarSession(localStorage, SAMPLE_SESSION);
    const updated = { ...SAMPLE_SESSION, currentRound: 2 };
    saveAvatarSession(localStorage, updated);
    const loaded = loadAvatarSession(localStorage, "test-1");
    expect(loaded?.currentRound).toBe(2);
  });
});

describe("listAvatarSessions", () => {
  it("returns summaries sorted by startedAt descending", () => {
    saveAvatarSession(localStorage, { ...SAMPLE_SESSION, id: "a", startedAt: 100 });
    saveAvatarSession(localStorage, { ...SAMPLE_SESSION, id: "b", startedAt: 200 });
    const list = listAvatarSessions(localStorage);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("b");
    expect(list[1].id).toBe("a");
  });

  it("returns empty array when nothing is saved", () => {
    expect(listAvatarSessions(localStorage)).toEqual([]);
  });
});
