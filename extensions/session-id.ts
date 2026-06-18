/**
 * Session ID extension for pi.
 *
 * Injects the session identity as the first message in the message array
 * only when needed:
 * 1. For new chats (first message)
 * 2. After compaction (when history is rebuilt)
 *
 * For Mistral models (especially Mistral Small 4), also enforces strict role constraints
 * in two key scenarios (lazy, only when needed):
 * 1. After compaction: ensures compacted messages are role-compliant
 * 2. On 400 errors: retries with role-compliant messages
 *
 * Role constraints enforced when applied:
 * - Strict alternation between user and assistant
 * - Only allowed roles: system, user, assistant, tool
 * - System message must be first (index 0)
 * - No trailing assistant messages
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

  // ── Session start: capture session ID ─────────────────────────
  pi.on("session_start", async (_event: any, ctx) => {
    const newSessionId = ctx.sessionManager.getSessionId() ?? "";
    
    // Check if this is actually a new session or a resume
    // If session ID changed, it's a new session
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
    // Also mark that we need to prepend session ID after compaction
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
