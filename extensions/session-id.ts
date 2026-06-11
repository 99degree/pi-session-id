/**
 * Session ID extension for pi.
 *
 * Prepends the session ID (followed by the system prompt) to:
 *   1. The system prompt itself — so `{sessionId}` is the very first
 *      thing the LLM sees in every turn.
 *   2. Any compaction summary — so the session ID + system prompt
 *      survive compaction as the first message in the compressed
 *      context.
 *
 * This ensures the session identity is always visible at the top of
 * the LLM's context window, even after many rounds of compaction.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Cached base system prompt (without the session-ID prefix we add).
  let baseSystemPrompt = "";
  let sessionId = "";

  // ── Track session ID across session switches ──────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId() ?? "";
    baseSystemPrompt = ctx.getSystemPrompt();
  });

  // ── Prepend session ID to the system prompt on every turn ─────
  pi.on("before_agent_start", async (event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    if (!id) return;

    sessionId = id;
    // Capture the current (un-prefixed) system prompt so the
    // `context` handler can reconstruct it later.
    baseSystemPrompt = event.systemPrompt;

    return {
      systemPrompt: `${id}\n\n${event.systemPrompt}`,
    };
  });

  // ── Also prepend session ID + system prompt to compaction ─────
  // The `context` event fires before every LLM call with a deep
  // copy of the messages.  We patch the first compactionSummary
  // so the session ID + full system prompt appear as the very
  // first content the LLM sees in the compacted context.
  pi.on("context", async (event, ctx) => {
    if (!sessionId) return;

    const idx = event.messages.findIndex(
      (m) => m.role === "compactionSummary",
    );
    if (idx === -1) return; // no compaction summary → nothing to do

    const msg = event.messages[idx];

    // Avoid double-prepending when this handler runs more than
    // once for the same compaction entry (shouldn't happen with
    // deep copies, but be safe).
    if (msg.summary.startsWith(sessionId)) return;

    const messages = event.messages.slice();
    messages[idx] = {
      ...msg,
      summary: `${sessionId}\n\n${baseSystemPrompt}\n\n${msg.summary}`,
    };

    return { messages };
  });
}
