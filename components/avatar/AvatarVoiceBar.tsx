"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentPhase } from "@/lib/avatar/avatarAgent";
import { cn } from "@/lib/utils";

/**
 * Bottom call bar for the live avatar. The call is always-on: the student
 * just talks and the avatar answers (and can be interrupted). Controls are
 * mute, a keyboard fallback, and hang up.
 */
export function AvatarVoiceBar({
  phase,
  muted,
  onToggleMute,
  textMode,
  onToggleText,
  onSubmitText,
  onEnd,
  micAvailable,
  hint,
  extra,
}: {
  phase: AgentPhase;
  muted: boolean;
  onToggleMute: () => void;
  textMode: boolean;
  onToggleText: () => void;
  onSubmitText: (text: string) => void;
  onEnd: () => void;
  micAvailable: boolean;
  hint?: string | null;
  extra?: ReactNode;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textMode) setTimeout(() => inputRef.current?.focus(), 50);
  }, [textMode]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    onSubmitText(trimmed);
  }

  const status =
    hint ??
    (phase === "connecting"
      ? "Connecting…"
      : phase === "thinking"
        ? "Thinking…"
        : phase === "speaking"
          ? "Avatar is speaking — you can interrupt"
          : phase === "listening"
            ? muted
              ? "Muted"
              : "Listening — just talk"
            : phase === "error"
              ? "Voice is unavailable — type below"
              : "");

  return (
    <div className="flex flex-col items-center gap-3 pb-4">
      {extra}

      {textMode && (
        <div className="flex w-full max-w-md items-center gap-2 px-4">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Type your argument…"
            className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
          />
          <button
            type="button"
            disabled={!text.trim()}
            onClick={submit}
            className="rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      )}

      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={onToggleText}
          aria-label="Toggle text input"
          aria-pressed={textMode}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
            textMode ? "bg-white/20 text-white" : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white",
          )}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          disabled={!micAvailable}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          className={cn(
            "relative flex h-16 w-16 items-center justify-center rounded-full transition-all duration-200",
            !micAvailable && "cursor-not-allowed opacity-40",
            muted
              ? "bg-white/15 text-white/60"
              : phase === "listening"
                ? "bg-green-500 text-white shadow-[0_0_24px_rgba(74,222,128,0.5)]"
                : "bg-white/20 text-white hover:bg-white/30",
          )}
        >
          {muted ? (
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="22" y2="22" />
              <path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          ) : (
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={onEnd}
          aria-label="End debate"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/80 text-white transition-colors hover:bg-red-500"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M16.5 2.25 7.5 11.25 16.5 20.25" transform="rotate(90 12 12)" />
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
        </button>
      </div>

      <div
        role="status"
        className={cn(
          "text-center text-xs",
          phase === "error" || hint ? "text-amber-400" : phase === "listening" && !muted ? "text-green-400" : "text-white/40",
        )}
      >
        {status}
      </div>
    </div>
  );
}
