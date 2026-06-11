/**
 * Session ID extension for pi.
 *
 * Prepends the session ID to the system prompt and compaction summaries,
 * and optionally appends a user-defined custom prompt (set via `/prompt`).
 *
 * Final prompt format:
 *   {sessionId}
 *
 *   {systemPrompt}          ← pi's default system prompt
 *
 *   {customPrompt}          ← only when set via /prompt
 *
 * The custom prompt is persisted to ~/.pi/agent/custom-prompt.json.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const PROMPT_FILE = join(homedir(), ".pi", "agent", "custom-prompt.json");

// ── Helpers ─────────────────────────────────────────────────────

async function loadCustomPrompt(): Promise<string | null> {
  try {
    const raw = await readFile(PROMPT_FILE, "utf-8");
    const data = JSON.parse(raw);
    return typeof data.customPrompt === "string" && data.customPrompt.trim()
      ? data.customPrompt.trim()
      : null;
  } catch {
    return null;
  }
}

async function saveCustomPrompt(prompt: string | null): Promise<void> {
  await mkdir(dirname(PROMPT_FILE), { recursive: true });
  await writeFile(
    PROMPT_FILE,
    JSON.stringify({ customPrompt: prompt ?? "" }, null, 2),
    "utf-8",
  );
}

function buildPrompt(sessionId: string, systemPrompt: string, customPrompt: string | null): string {
  let result = `${sessionId}\n\n${systemPrompt}`;
  if (customPrompt) {
    result += `\n\n${customPrompt}`;
  }
  return result;
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sessionId = "";
  let baseSystemPrompt = "";

  // ── Track session ID across session switches ──────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId() ?? "";
    baseSystemPrompt = ctx.getSystemPrompt();
  });

  // ── Build the full prompt on every turn ───────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    if (!id) return;

    sessionId = id;
    baseSystemPrompt = event.systemPrompt;

    const custom = await loadCustomPrompt();
    return {
      systemPrompt: buildPrompt(sessionId, baseSystemPrompt, custom),
    };
  });

  // ── Prepend session ID + system prompt to compaction summaries ─
  pi.on("context", async (event, ctx) => {
    if (!sessionId) return;

    const idx = event.messages.findIndex(
      (m) => m.role === "compactionSummary",
    );
    if (idx === -1) return;

    const msg = event.messages[idx];
    if (msg.summary.startsWith(sessionId)) return;

    const messages = event.messages.slice();
    messages[idx] = {
      ...msg,
      summary: `${sessionId}\n\n${baseSystemPrompt}\n\n${msg.summary}`,
    };

    return { messages };
  });

  // ── /prompt command: view / set / clear custom prompt ─────────
  pi.registerCommand("prompt", {
    description:
      "View, set, or clear the custom system prompt. " +
      "Usage: /prompt <text>  |  /prompt  |  /prompt --clear",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      // ── Clear ───────────────────────────────────────────────
      if (trimmed === "--clear" || trimmed === "-d") {
        await saveCustomPrompt(null);
        ctx.ui.notify("Custom prompt cleared.", "info");
        return;
      }

      // ── Show ────────────────────────────────────────────────
      if (!trimmed) {
        const current = await loadCustomPrompt();
        if (current) {
          ctx.ui.notify(`Current custom prompt:\n\n${current}`, "info");
        } else {
          ctx.ui.notify("No custom prompt set. Use /prompt <text> to set one.", "info");
        }
        return;
      }

      // ── Set ─────────────────────────────────────────────────
      await saveCustomPrompt(trimmed);
      ctx.ui.notify("Custom prompt saved. It will be appended to the system prompt on the next turn.", "info");
    },
  });
}
