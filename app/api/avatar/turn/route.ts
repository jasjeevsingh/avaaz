import { getChatClient } from "@/lib/ai/claude";
import { buildAvatarPrompt } from "@/lib/avatar/avatarPrompt";
import { transcriptToHistory } from "@/lib/avatar/types";
import type { AvatarTurnRequest } from "@/lib/avatar/types";

export async function POST(req: Request): Promise<Response> {
  let body: AvatarTurnRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.mode || !body.motion || !body.cohort) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  try {
    const { system, user } = buildAvatarPrompt(body);
    const transcript = body.transcript ?? [];
    // The prompt builder quotes the latest student line as the user message,
    // so the history must stop before it or the model sees it twice.
    const last = transcript[transcript.length - 1];
    const history = transcriptToHistory(last?.speaker === "student" ? transcript.slice(0, -1) : transcript);
    const client = getChatClient({ json: false });
    const text = await client.complete({ system, user, history });
    return Response.json({ text }, { status: 200 });
  } catch {
    return Response.json({ error: "avatar turn failed" }, { status: 500 });
  }
}
