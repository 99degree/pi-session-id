/**
 * Session ID extension for pi.
 *
 * Injects a user + assistant exchange at the start of every LLM call
 * that carries the session identity and optional custom content:
 *
 *   user: (empty)
 *   assistant: {sessionId}
 *              {systemPrompt}
 *              {customPrompt}   ← optional, set via /prompt
 *              {claudeContent}  ← optional, loaded via /claude
 *
 * The system prompt itself is left untouched — pi's default is used.
 * The same pair leads the compacted context after compaction.
 *
 * Custom prompt data is persisted to ~/.pi/agent/custom-prompt.json.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, resolve, isAbsolute } from "node:path";

const STORE_FILE = join(homedir(), ".pi", "agent", "custom-prompt.json");

// ── Storage helpers ─────────────────────────────────────────────

interface PromptStore {
  customPrompt: string;
  claudeContent: string;
}

async function loadStore(): Promise<PromptStore> {
  try {
    const raw = await readFile(STORE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return {
      customPrompt:
        typeof data.customPrompt === "string" ? data.customPrompt : "",
      claudeContent:
        typeof data.claudeContent === "string" ? data.claudeContent : "",
    };
  } catch {
    return { customPrompt: "", claudeContent: "" };
  }
}

async function saveStore(store: PromptStore): Promise<void> {
  await mkdir(dirname(STORE_FILE), { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

const present = (s: string): s is string => s.trim().length > 0;

// ── Build the assistant message content ─────────────────────────

function buildAssistantContent(
  sessionId: string,
  systemPrompt: string,
  customPrompt: string,
  claudeContent: string,
): string {
  let result = `${sessionId}\n\n${systemPrompt}`;
  if (present(customPrompt)) {
    result += `\n\n${customPrompt}`;
  }
  if (present(claudeContent)) {
    result += `\n\n${claudeContent}`;
  }
  return result;
}

/**
 * Returns the effective claude content: the stored value if non-empty,
 * otherwise attempts to auto-load CLAUDE.md from the given cwd.
 */
async function getEffectiveClaudeContent(
  store: PromptStore,
  cwd: string
): Promise<string> {
  if (present(store.claudeContent)) {
    return store.claudeContent;
  }
  // Try to auto-load CLAUDE.md
  const claudePath = resolve(cwd, "CLAUDE.md");
  try {
    const content = await readFile(claudePath, "utf-8");
    return content.trim();
  } catch {
    // No CLAUDE.md or unreadable
    return "";
  }
}

/**
 * Check whether the first two messages in the array are already
 * our injected pair (empty user + assistant carrying sessionId).
 * This avoids stacking them on every turn.
 */
function alreadyInjected(messages: any[], sessionId: string): boolean {
  if (messages.length < 2) return false;
  const [first, second] = messages;
  if (first.role !== "user") return false;
  if (second.role !== "assistant") return false;
  // Check sessionId appears in the assistant content
  const text =
    typeof second.content === "string"
      ? second.content
      : Array.isArray(second.content)
        ? second.content.map((b: any) => b.text ?? "").join("")
        : "";
  return text.includes(sessionId);
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

  // ── Inject the user+assistant pair before every LLM call ──────
  pi.on("context", async (event) => {
    if (!sessionId) return;

    const { messages } = event;

    // If the pair is already there (from a previous turn), skip.
    if (alreadyInjected(messages, sessionId)) return;

    // For compaction summaries, wrap the info into the summary text
    // instead of prepending extra messages.
    const compIdx = messages.findIndex(
      (m: any) => m.role === "compactionSummary",
    );
    if (compIdx !== -1) {
      const store = await loadStore();
      const effectiveClaudeContent = await getEffectiveClaudeContent(store, ctx.cwd);
      const msgs = messages.slice();
      const comp = msgs[compIdx];
      if (!comp.summary.startsWith(sessionId)) {
        msgs[compIdx] = {
          ...comp,
          summary: `${buildAssistantContent(sessionId, baseSystemPrompt, store.customPrompt, effectiveClaudeContent)}\n\n${comp.summary}`,
        };
      }
      
      // Fix message sequence after compactionSummary:
      // Remove leading tool calls (they belong to summarized turns)
      // Ensure a user message precedes the first remaining message (if any)
      let start = compIdx + 1;
      while (start < msgs.length && msgs[start].role === "tool") {
        start++;
      }
      if (start < msgs.length) {
        msgs.splice(start, 0, { role: "user", content: "" });
        // Debug: show first few roles after fix
        const rolesAfter = msgs.slice(compIdx + 1, compIdx + 4).map(m => m.role);
        ctx.ui.notify(`After fix: roles after summary: ${rolesAfter.join(", ")}`, "info");
      }
      // If no messages remain after skipping tools, leave as is
      
      return { messages: msgs };
    }

    // Normal turn: prepend empty user + session-info assistant.
    const store = await loadStore();
    const effectiveClaudeContent = await getEffectiveClaudeContent(store, ctx.cwd);
    const info = buildAssistantContent(
      sessionId,
      baseSystemPrompt,
      store.customPrompt,
      effectiveClaudeContent,
    );

    ctx.ui.notify("Normal turn: injecting user+assistant pair", "info");
    return {
      messages: [
        { role: "user", content: "" },
        { role: "assistant", content: [{ type: "text", text: info }] },
        ...messages,
      ],
    };
  });

  // ── /prompt command: view / set / clear custom prompt ─────────
  pi.registerCommand("prompt", {
    description:
      "View, set, or clear the custom prompt. " +
      "Usage: /prompt <text>  |  /prompt  |  /prompt --clear",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "--clear" || trimmed === "-d") {
        const store = await loadStore();
        store.customPrompt = "";
        await saveStore(store);
        ctx.ui.notify("Custom prompt cleared.", "info");
        return;
      }

      if (!trimmed) {
        const store = await loadStore();
        if (present(store.customPrompt)) {
          ctx.ui.notify(`Custom prompt:\n\n${store.customPrompt}`, "info");
        } else {
          ctx.ui.notify("No custom prompt set. Use /prompt <text> to set one.", "info");
        }
        return;
      }

      const store = await loadStore();
      store.customPrompt = trimmed;
      await saveStore(store);
      ctx.ui.notify("Custom prompt saved.", "info");
    },
  });

  // ── /claude command: load CLAUDE.md as claude content ─────────
  pi.registerCommand("claude", {
    description:
      "Load a CLAUDE.md file as extra context. " +
      "Usage: /claude          (loads ./CLAUDE.md)  |  " +
      "/claude <path>  (load a specific file)  |  " +
      "/claude --clear (clear claude content)",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "--clear" || trimmed === "-d") {
        const store = await loadStore();
        store.claudeContent = "";
        await saveStore(store);
        ctx.ui.notify("Claude content cleared.", "info");
        return;
      }

      const filePath = trimmed
        ? isAbsolute(trimmed)
          ? trimmed
          : resolve(ctx.cwd, trimmed)
        : resolve(ctx.cwd, "CLAUDE.md");

      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        ctx.ui.notify(`Cannot read file: ${filePath}`, "error");
        return;
      }

      if (!content.trim()) {
        ctx.ui.notify(`File is empty: ${filePath}`, "warning");
        return;
      }

      const store = await loadStore();
      store.claudeContent = content.trim();
      await saveStore(store);
      ctx.ui.notify(
        `Loaded ${filePath} (${content.trim().split("\n").length} lines).`,
        "info",
      );
    },
  });
}
