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

console.log("Extension loaded");

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
  let debugMode = true;  // Toggle verbose logging with /debug

  // ── Track session ID across session switches ──────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId() ?? "";
    baseSystemPrompt = ctx.getSystemPrompt();
  });

  // ── Message sequence fix ──────────────────────────────────────
  // Roles that are NOT tool-like; anything else (tool, toolResult,
  // bashExecution, etc.) will be treated as tool by the provider
  // and cannot be followed by a user message.
  const NON_TOOL_ROLES = new Set(["user", "assistant", "system", "compactionSummary"]);

  // Debug logging helper - only logs if debugMode is enabled
  const debug = (...args: any[]) => {
    if (debugMode) console.log("[session-id]", ...args);
  };

  // Create a dummy assistant message (in provider-compatible format)
  function createAssistantMsg(text?: string): any {
    return {
      role: "assistant",
      content: [{ type: "text", text: text ?? "System busy, please wait..." }],
    };
  }

  // Create an assistant message with tool_result for provider validation
  function createAssistantMsgWithToolResult(toolRole: string, toolUseId?: string): any {
    return {
      role: "assistant",
      content: [{
        type: "tool_result",
        tool_use_id: toolUseId ?? `dummy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        content: [{ type: "text", text: `[Auto-generated tool result for ${toolRole}]` }],
        is_error: true
      }],
    };
  }

  // Extract tool_use_id from a tool call message
  function extractToolUseId(msg: any): string | undefined {
    if (!msg.content || !Array.isArray(msg.content)) return undefined;
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        return block.id;
      }
    }
    return undefined;
  }

  /**
   * Fix tool-like→user violations and ensure the array starts/ends
   * with valid roles. Runs up to maxIter passes so that inserting
   * an assistant can itself create new violations (unlikely but safe).
   * When tool-like is followed by user, insert an assistant with a
   * tool_result to satisfy provider role sequence validation.
   */
  function fixMessageArray(messages: any[]): any[] {
    if (!messages || messages.length === 0) return messages;

    debug(`fixMessageArray input: ${messages.map((m, i) => `${i}:${m.role}`).join(" -> ")}`);

    let fixed = [...messages];
    let totalInsertions = 0;
    const maxIter = 10;

    for (let pass = 0; pass < maxIter; pass++) {
      let insertions = 0;
      const result: any[] = [];

      // Scan left-to-right: if tool-like is followed by user, insert assistant with tool_result
      for (let i = 0; i < fixed.length; i++) {
        const msg = fixed[i];
        if (result.length > 0 &&
            !NON_TOOL_ROLES.has(result[result.length - 1].role) &&
            msg.role === "user") {
          // Insert assistant with tool_result to satisfy: tool -> assistant(tool_result) -> user
          const prevMsg = result[result.length - 1];
          const toolUseId = extractToolUseId(prevMsg);
          result.push(createAssistantMsgWithToolResult(prevMsg.role, toolUseId));
          insertions++;
        }
        result.push(msg);
      }

      if (insertions === 0) break; // no more violations
      totalInsertions += insertions;
      fixed = result;
    }

    debug(`fixMessageArray output: ${fixed.map((m, i) => `${i}:${m.role}`).join(" -> ")}`);

    // Ensure array does not end with a tool-like role
    if (fixed.length > 0 && !NON_TOOL_ROLES.has(fixed[fixed.length - 1].role)) {
      fixed.push(createAssistantMsg(""));
      totalInsertions++;
    }

    // Ensure array starts with user or system
    if (fixed.length > 0 && fixed[0].role !== "user" && fixed[0].role !== "system") {
      fixed.unshift({ role: "user", content: "." });
    }

    // Final verification
    let remaining = 0;
    for (let i = 1; i < fixed.length; i++) {
      if (!NON_TOOL_ROLES.has(fixed[i - 1].role) && fixed[i].role === "user") {
        remaining++;
        console.error(`[session-id] UNFIXABLE: ${fixed[i-1].role}->user at index ${i-1}`);
      }
    }

    if (totalInsertions > 0) {
      debug(`Fix: ${totalInsertions} assistant(s) inserted`);
    }
    if (remaining > 0) {
      console.error(`[session-id] ${remaining} violations remain after fix!`);
      debug(fixed.map((m, i) => `${i}:${m.role}`).join(" → "));
    }

    return fixed;
  }

  // ── Inject the user+assistant pair before every LLM call ──────
  pi.on("context", async (event, ctx) => {
    if (!sessionId) return;

    const { messages } = event;

    debug(`context event received: ${messages.map((m, i) => `${i}:${m.role}`).join(" -> ")}`);

    // If the pair is already there (from a previous turn), skip.
    if (alreadyInjected(messages, sessionId)) return;

    // For compaction summaries, wrap the info into the summary text
    // instead of prepending extra messages.
    const compIdx = messages.findIndex(
      (m: any) => m.role === "compactionSummary",
    );
    if (compIdx !== -1) {
      const store = await loadStore();
      const effectiveClaudeContent = await getEffectiveClaudeContent(store, ctx?.cwd ?? process.cwd());
      const msgs = messages.slice();
      const comp = msgs[compIdx];
      if (!comp.summary.startsWith(sessionId)) {
        msgs[compIdx] = {
          ...comp,
          summary: `${buildAssistantContent(sessionId, baseSystemPrompt, store.customPrompt, effectiveClaudeContent)}\n\n${comp.summary}`,
        };
      }

      const fixedMsgs = fixMessageArray(msgs);
      debug(`Returning ${fixedMsgs.length} messages:`, fixedMsgs.map(m => m.role));
      return { messages: fixedMsgs };
    }

    // Normal turn: prepend empty user + session-info assistant.
    const store = await loadStore();
    const effectiveClaudeContent = await getEffectiveClaudeContent(store, ctx?.cwd ?? process.cwd());
    const info = buildAssistantContent(
      sessionId,
      baseSystemPrompt,
      store.customPrompt,
      effectiveClaudeContent,
    );
    const newMessages = [
      { role: "user", content: "." },
      { role: "assistant", content: [{ type: "text", text: info }] },
      ...messages,
    ];
    const safeMessages = fixMessageArray(newMessages);
    debug(`Returning ${safeMessages.length} messages:`, safeMessages.map(m => m.role));
    return { messages: safeMessages };
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

  // ── /debug command: toggle verbose logging ─────────────────────
  pi.registerCommand("debug", {
    description: "Toggle debug logging on/off",
    handler: async (_args, ctx) => {
      debugMode = !debugMode;
      ctx.ui.notify(
        debugMode ? "Debug logging ON" : "Debug logging OFF",
        "info"
      );
    },
  });
}
