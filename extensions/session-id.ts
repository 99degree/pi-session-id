/**
 * Session ID extension for pi.
 *
 * 1. Creates/updates AGENTS.md with session identity at session start.
 *    Pi automatically loads AGENTS.md as a context file and includes it
 *    in the system prompt for every API request, so the session ID is always present.
 *
 * 2. For Mistral models (especially Mistral Small 4), enforces strict role constraints
 *    in two key scenarios (lazy, only when needed):
 *    - After compaction: ensures compacted messages are role-compliant
 *    - On 400 errors: retries with role-compliant messages
 *
 * Role constraints enforced when applied:
 * - Strict alternation between user and assistant
 * - Only allowed roles: system, user, assistant, tool
 * - System message must be first (index 0)
 * - No trailing assistant messages
 * - System messages contain only text (no images)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { constants } from "node:fs";

const AGENTS_FILE = "AGENTS.md";

// ── AGENTS.md management ────────────────────────────────────────

/**
 * Build AGENTS.md content with session identity
 */
function buildAgentsContent(sessionId: string, existingContent: string = ""): string {
  const header = `# Session: ${sessionId}\n\n`;
  if (existingContent && !existingContent.includes(`# Session: ${sessionId}`)) {
    return header + existingContent;
  }
  return header + (existingContent || "");
}

/**
 * Ensure AGENTS.md exists with session identity.
 * Pi will automatically load this as a context file.
 */
async function ensureAgentsFile(cwd: string, sessionId: string): Promise<void> {
  const agentsPath = resolve(cwd, AGENTS_FILE);
  try {
    await access(agentsPath, constants.R_OK);
    const existing = await readFile(agentsPath, "utf-8");
    const sessionMatch = existing.match(/^# Session: ([^\n]+)/m);
    const currentSessionId = sessionMatch ? sessionMatch[1] : null;
    if (!currentSessionId || currentSessionId !== sessionId) {
      await writeFile(agentsPath, buildAgentsContent(sessionId, existing), "utf-8");
    }
  } catch {
    await mkdir(dirname(agentsPath), { recursive: true });
    await writeFile(agentsPath, buildAgentsContent(sessionId), "utf-8");
  }
}

// ── Mistral role rationalization ─────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => b.text ?? "").filter(Boolean).join("\n\n");
  }
  return "";
}

function isMistralModel(model: { provider: string; id: string } | undefined): boolean {
  if (!model) return false;
  const idLower = model.id.toLowerCase();
  const providerLower = model.provider.toLowerCase();
  return providerLower === "mistral" || idLower.includes("mistral") || idLower.includes("small-4");
}

function rationalizeHistoryForMistral(messages: any[]): any[] {
  if (!messages || messages.length === 0) return [];

  const processed: any[] = [];
  const systemInstructions: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    if (role === "system" || role === "developer") {
      systemInstructions.push(extractText(msg.content));
    }
  }

  if (systemInstructions.length > 0) {
    processed.push({ role: "system", content: systemInstructions.join("\n\n") });
  }

  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    if (role === "system" || role === "developer") continue;

    let targetRole = role === "function" ? "tool" : role;
    const stringContent = extractText(msg.content);

    const lastMsg = processed[processed.length - 1];
    if (lastMsg && lastMsg.role === targetRole) {
      const current = typeof lastMsg.content === "string" ? lastMsg.content : extractText(lastMsg.content);
      lastMsg.content = `${current}\n\n[Continuation]:\n${stringContent}`;
    } else {
      processed.push({ role: targetRole, content: stringContent });
    }
  }

  if (processed.length === 0) return [];
  if (processed.length === 1 && processed[0].role === "system") {
    processed.push({ role: "user", content: "Execute workspace verification loop." });
  }
  while (processed.length > 0 && processed[processed.length - 1].role === "assistant") {
    processed.pop();
  }

  return processed;
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sessionId = "";
  let debugMode = false;
  let needsRoleFix = false;
  let lastRequestFailed = false;

  const debug = (...args: any[]) => {
    if (debugMode) console.log("[session-id]", ...args);
  };

  // ── Session start: ensure AGENTS.md has session ID ────────────
  pi.on("session_start", async (_event: any, ctx) => {
    sessionId = ctx.sessionManager.getSessionId() ?? "";
    lastRequestFailed = false;
    needsRoleFix = false;

    if (sessionId) {
      try {
        await ensureAgentsFile(ctx.cwd, sessionId);
        debug(`AGENTS.md updated with session: ${sessionId}`);
      } catch (err) {
        debug(`Failed to update AGENTS.md: ${err}`);
      }
    }
  });

  // ── Mistral role fix: before_provider_request (lazy) ──────────
  pi.on("before_provider_request", (event: any) => {
    if (!needsRoleFix && !lastRequestFailed) return undefined;
    if (!isMistralModel(event.model)) return undefined;

    const payload = { ...event.payload };
    if (Array.isArray(payload.messages)) {
      debug(`Mistral role fix: ${payload.messages.length} -> ${payload.messages.length} messages`);
      payload.messages = rationalizeHistoryForMistral(payload.messages);
      needsRoleFix = false;
      lastRequestFailed = false;
    }
    return payload;
  });

  // ── Trigger role fix after compaction ────────────────────────
  pi.on("session_compact", async (_event: any, ctx) => {
    if (ctx.model && isMistralModel(ctx.model)) {
      needsRoleFix = true;
      debug("Compaction completed - role fix will apply on next request");
    }
  });

  // ── Trigger role fix on 400 errors ────────────────────────────
  pi.on("after_provider_response", async (event: any, ctx) => {
    if (event.status === 400 && ctx.model && isMistralModel(ctx.model)) {
      lastRequestFailed = true;
      needsRoleFix = true;
      debug("400 error for Mistral - role fix will apply on retry");
    }
  });

  // ── /debug command ─────────────────────────────────────────────
  pi.registerCommand("debug", {
    description: "Toggle debug logging on/off",
    handler: async (_args, ctx) => {
      debugMode = !debugMode;
      ctx.ui.notify(debugMode ? "Debug logging ON" : "Debug logging OFF", "info");
    },
  });
}
