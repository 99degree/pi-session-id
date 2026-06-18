/**
 * Session ID extension for pi.
 *
 * On startup:
 * - Creates AGENTS.md with default engineering prompt if it doesn't exist
 *
 * For every LLM call:
 * - Injects the session identity as the first message in the message array
 *   only when needed:
 *   1. For new chats (first message)
 *   2. After compaction (when history is rebuilt)
 *
 * For Mistral models (especially Mistral Small 4):
 * - Enforces strict role constraints in two key scenarios (lazy, only when needed):
 *   1. After compaction: ensures compacted messages are role-compliant
 *   2. On 400 errors: retries with role-compliant messages
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { constants } from "node:fs";

const AGENTS_FILE = "AGENTS.md";

const DEFAULT_AGENTS_CONTENT = `You are an autonomous engineering agent executing via the Pi harness. Your goal is complete task success verified through tool execution.

CRITICAL OPERATIONAL LOOP:
1. INSPECT FIRST: Always invoke the \`bash\` tool to view/read file contents or structure before editing. Never assume layouts.
2. PRESERVE LAYOUT: Match existing file indentation (spaces vs tabs), depth, trailing commas, and file-ending newlines exactly.
3. DIRECT MODIFICATION: Execute structural code modifications directly on the requested file paths via the provided file manipulation tools or \`bash\` workflows. Do not create /tmp or scratch directories.
4. MANDATORY VERIFICATION: Immediately after saving any changes to a file, invoke the \`bash\` tool to run the build, test, compilation, or validation commands for the environment.
5. SELF-CORRECT: If your verification commands return errors or a non-zero exit code, analyze stderr, resolve syntax/logic flaws, and re-run your testing commands. Loop until the verification succeeds with exit code 0.

NATIVE TOOL EXECUTION RULES:
- NO RAW CODE IN CHAT: You are strictly forbidden from dumping raw code, unified diffs, or markdown code snippets (like \`\`\`python or \`\`\`text) into standard chat blocks.
- EXECUTION MANDATE: Every single file update and terminal instruction must happen exclusively through native LLM tool calls. Text-based code simulations break the parsing framework.
- DIALOGUE SUPPRESSION: Suppress standard conversational chatter. Focus your generation entirely on planning and immediate tool execution.

Trigger your native function-calling interface immediately to execute the next logical step. Do not write filler text.`;

// ── AGENTS.md creation ──────────────────────────────────────────

async function ensureAgentsFile(cwd: string): Promise<void> {
  const agentsPath = resolve(cwd, AGENTS_FILE);
  try {
    await access(agentsPath, constants.R_OK);
  } catch {
    // File doesn't exist, create it with default content
    await mkdir(dirname(agentsPath), { recursive: true });
    await writeFile(agentsPath, DEFAULT_AGENTS_CONTENT, "utf-8");
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
  let isNewSession = true;

  const debug = (...args: any[]) => {
    if (debugMode) console.log("[session-id]", ...args);
  };

  // ── Session start: create AGENTS.md and capture session ID ────
  pi.on("session_start", async (_event: any, ctx) => {
    const newSessionId = ctx.sessionManager.getSessionId() ?? "";
    
    // Create AGENTS.md if it doesn't exist
    try {
      await ensureAgentsFile(ctx.cwd);
      debug(`AGENTS.md ensured in ${ctx.cwd}`);
    } catch (err) {
      debug(`Failed to create AGENTS.md: ${err}`);
    }
    
    // Track session
    if (newSessionId !== sessionId) {
      sessionId = newSessionId;
      isNewSession = true;
      debug(`New session started: ${sessionId}`);
    } else {
      isNewSession = false;
      debug(`Session resumed: ${sessionId}`);
    }
    
    lastRequestFailed = false;
    needsRoleFix = false;
  });

  // ── Inject session ID as first message when needed ──────────
  pi.on("context", async (event: any) => {
    if (!sessionId) return;
    
    const { messages } = event;
    
    // Check if session ID is already in the messages
    const hasSession = messages.some((msg: any) => {
      const text = typeof msg.content === "string" ? msg.content : 
                   Array.isArray(msg.content) ? msg.content.map((b: any) => b.text ?? "").join("") : "";
      return text.includes(sessionId);
    });
    
    // Only prepend if:
    // 1. It's a new session, OR
    // 2. It's after compaction (needsRoleFix is set)
    // 3. Session ID is not already present
    if ((isNewSession || needsRoleFix) && !hasSession) {
      debug(`Prepending session ID to ${messages.length} messages`);
      isNewSession = false;
      return {
        messages: [
          { role: "system", content: `Session: ${sessionId}` },
          ...messages,
        ]
      };
    }
  });

  // ── Mistral role fix: before_provider_request (lazy) ──────────
  pi.on("before_provider_request", (event: any) => {
    if (!needsRoleFix && !lastRequestFailed) return undefined;
    if (!isMistralModel(event.model)) return undefined;

    const payload = { ...event.payload };
    if (Array.isArray(payload.messages)) {
      debug(`Mistral role fix: processing ${payload.messages.length} messages`);
      payload.messages = rationalizeHistoryForMistral(payload.messages);
      needsRoleFix = false;
      lastRequestFailed = false;
    }
    return payload;
  });

  // ── Trigger role fix and session prepend after compaction ──────
  pi.on("session_compact", async (_event: any, ctx) => {
    if (ctx.model && isMistralModel(ctx.model)) {
      needsRoleFix = true;
      debug("Compaction completed - role fix + session prepend will apply on next request");
    }
    isNewSession = true;
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
