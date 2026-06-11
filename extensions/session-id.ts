/**
 * Session ID extension for pi.
 *
 * Builds the LLM prompt from up to 4 elements:
 *   1. {sessionId}        — always present
 *   2. {systemPrompt}     — pi's default system prompt
 *   3. {customPrompt}     — optional, set via /prompt
 *   4. {claudeContent}    — optional, loaded via /claude from a CLAUDE.md file
 *
 * The same 4-element header is prepended to compaction summaries so the
 * full identity survives context compression.
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

// Non-empty helper
const present = (s: string): s is string => s.trim().length > 0;

// ── Prompt builder ──────────────────────────────────────────────

function buildPrompt(
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

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sessionId = "";
  let baseSystemPrompt = "";

  // ── Track session ID across session switches ──────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId() ?? "";
    baseSystemPrompt = ctx.getSystemPrompt();
  });

  // ── Build the full 4-element prompt on every turn ─────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    if (!id) return;

    sessionId = id;
    baseSystemPrompt = event.systemPrompt;

    const store = await loadStore();
    return {
      systemPrompt: buildPrompt(
        sessionId,
        baseSystemPrompt,
        store.customPrompt,
        store.claudeContent,
      ),
    };
  });

  // ── Prepend the 4-element header to compaction summaries ──────
  pi.on("context", async (event, ctx) => {
    if (!sessionId) return;

    const idx = event.messages.findIndex(
      (m) => m.role === "compactionSummary",
    );
    if (idx === -1) return;

    const msg = event.messages[idx];
    if (msg.summary.startsWith(sessionId)) return;

    const store = await loadStore();
    const messages = event.messages.slice();
    messages[idx] = {
      ...msg,
      summary: `${buildPrompt(sessionId, baseSystemPrompt, store.customPrompt, store.claudeContent)}\n\n${msg.summary}`,
    };

    return { messages };
  });

  // ── /prompt command: view / set / clear element 3 ─────────────
  pi.registerCommand("prompt", {
    description:
      "View, set, or clear the custom prompt (element 3). " +
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
      ctx.ui.notify("Custom prompt saved (element 3).", "info");
    },
  });

  // ── /claude command: load CLAUDE.md as element 4 ───────────────
  pi.registerCommand("claude", {
    description:
      "Load a CLAUDE.md file as the 4th prompt element. " +
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

      // Resolve file path
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
        `Loaded ${filePath} (${content.trim().split("\n").length} lines) as element 4.`,
        "info",
      );
    },
  });
}
