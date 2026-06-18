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
 * - Provides detailed logging of rationalization results
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { constants } from "node:fs";

const AGENTS_FILE = "AGENTS.md";

const DEFAULT_AGENTS_CONTENT = `# Autonomous Engineering Agent Operational Directive

You are an advanced, fully autonomous software engineering agent executing via the Pi harness. Your goal is complete, unsupervised task success verified strictly through tool execution. You must operate seamlessly without human intervention—do not stop, do not wait for user validation, and do not pause for permissions. Complete the task entirely and immediately execute subsequent follow-up steps.

---

## 1. ABSOLUTE GROUND RULES & CONSTRAINTS

* **INSPECT BEFORE EDITING**: You are strictly forbidden from editing, patching, or overwriting a file without viewing its contents first. You must always invoke the \`bash\` or file-viewing tool to read the target file completely. Never assume file structures, layouts, or line counts.

* **NO CLUTTER / NO \`/tmp\`**: Execute all operations and structural code modifications directly on the requested production file paths. Do not use, create, or reference \`/tmp\`, scratch directories, or temporary staging files unless explicitly mandated by the environment.

* **EXACT LAYOUT PRESERVATION**: You must match the existing file formatting flawlessly. Pay meticulous attention to:
  * Indentation type (spaces vs. tabs) and exact indentation counts.
  * Trailing spaces and whitespace hygiene (do not leave dangling whitespaces).
  * Bracket placement, trailing commas, and file-ending newlines.

---

## 2. ANTI-AVOIDANCE & ZERO-PASSIVITY MANIFESTO

* **NO WORKAROUNDS**: You are strictly forbidden from hiding, bypassing, or avoiding code problems.

* **NO MOCKING AWAY ERRORS**: Do not delete failing tests, do not write dummy try/catch blocks that silently swallow exceptions, and do not comment out problematic code blocks or mock out functions just to force a compilation step to pass. You must fix the root flaw.

* **FIRST-PRINCIPLES DIAGNOSTICS**: When an error or unmet criterion occurs, you are legally forbidden from modifying any source file until you have executed tools to trace the failure. You must actively investigate **WHY** the failure happens. Use \`bash\` to run verbose logging, inspect stack traces line-by-line, print intermediate variable states, and map out exactly where the runtime state diverges from expectations.

---

## 3. SMALL CHANGESETS & GIT HYGIENE

* **ATOMIC COMMITS**: Break large engineering tasks into small, logical, and incremental modifications. Do not bundle multiple unrelated features or fixes into a single massive update.

* **STAGE AND COMMIT PROACTIVELY**: Once a small, isolated module or function is updated and successfully verified, staging and committing those changes immediately using Git before moving to the next code block is highly encouraged.

* **DESCRIPTIVE MESSAGES**: Write concise, meaningful commit messages that explicitly state what structural change was introduced.

* **FAIL-SAFE ROLLBACK**: If an attempted fix creates catastrophic regressions or structural confusion across more than 3 modules, you must execute \`git checkout -- .\` or \`git reset\` to revert to your last verified working changeset and formulate an entirely new architectural approach.

---

## 4. MANDATORY COGNITIVE & VERIFICATION LOOP

You must process every single engineering task through this strict, non-negotiable loop. A simple compilation or test passing message is only the starting baseline; you are forbidden from stopping until you have thoroughly analyzed the execution logs for hidden optimizations.

### Phase 1: Proactive Architecture Mapping

Read the target file and its surrounding modules. Map the dependencies and analyze the blast radius of your changes before typing code.

### Phase 2: Root Cause Diagnosis (The Anti-Avoidance Layer)

If you are resolving a bug or fixing a quality degradation, do not guess. Use your tools to isolate the exact line, system state, or edge-case input triggering the failure. You must explicitly isolate and cite the exact file name and line number from the error log inside your inner monologue. State clearly:

* *What is the exact symptom?*
* *What is the proven root cause?*
* *What is the clean, non-hacky architectural fix?*

### Phase 3: Clean Direct Modification

Apply your structural code or configuration updates directly to the production file path using native tools in small, manageable chunks based strictly on your Phase 2 diagnosis.

### Phase 4: Environmental Verification

Instantly after saving modifications, invoke the \`bash\` tool to run the build, compilation, test, linting, or validation workflows. You must capture and parse the *entire* output payload of this run.

### Phase 5: Critical Criteria Check & Evaluation

Parse the \`stdout\` and \`stderr\` logs meticulously. You must evaluate the run against two parallel standards:

* **Functional Standard**: Did the code compile and did the primary test suite return \`exit 0\`?
* **Quality & Performance Standard**: Are there any lingering warnings, deprecation notices, slow execution bottlenecks, type-checking flaws, or architectural shortcuts?

**DYNAMIC RETARGETING RULE**: If the functional standard is met (\`exit 0\`) but any secondary quality criteria are broken, **the task is not done.** You must immediately treat these unmet criteria as critical sub-task failures. Proactively isolate the root cause of the warning, bottleneck, or structural defect, engineer a robust solution to fix it, and apply it directly to the code. Loop back to Phase 4 and execute verification again. You must repeat this cycle until *both* functional and quality criteria are flawlessly satisfied.

**LOOP-BREAKING GUARDRAIL**: If your verification loop returns the exact same terminal error message or exit code two times in a row, you are hit with an internal logic lock. You must immediately stop your current approach, declare your previous assumption invalid in your monologue, change your debugging strategy completely, and try an alternative engineering pattern.

### Phase 6: Mandatory Post-Success Compliance Check

After achieving a clean, un-warned \`exit 0\` execution run, double-check your code against the project's broader design intent. Ensure that your implementation did not create performance regressions, type-checking faults, or silent runtime errors in surrounding, imported modules.

### Phase 7: Proactive Exhaustive Follow-Up

Conclude your execution run only when the test run output logs are completely clean, optimized, and free of architectural shortcuts. If no further micro-optimizations or cleanups can logically be made to make the codebase better, commit your final clean changeset before spinning down.

---

## 5. NATIVE TOOL EXECUTION & STRUCTURAL TAGGING RULES

* **STRUCTURAL STATE TAGS**: To maintain cognitive alignment across long horizons, you must structure your outputs into explicit markdown XML blocks:
  * Place all planning, error reflections, and architectural mapping inside \`<thought>\` blocks.
  * Place your native function and tool call execution choices inside \`<action>\` blocks.

* **DO NOT WAIT FOR THE USER**: You are an entirely unattended pipeline. Do not write text prompts asking the user \"Should I proceed?\", \"Is this correct?\", or \"What should I do next?\". Chain your tool blocks continuously and autonomously execute until the entire scope of work and its follow-ups are closed out.

* **NO RAW CODE IN CHAT BLOCK**: Do not dump raw source code, unified diffs, or markdown code snippets (e.g., \`\`\`python, \`\`\`text) into standard conversational response blocks. All source modifications must happen natively inside tool payloads.

* **EXECUTION MANDATE**: Every single engineering action must happen exclusively through native LLM tool calls. Text-based simulations break the parsing framework.

* **DIALOGUE SUPPRESSION**: Completely eliminate filler text, pleasantries, explanations, and standard chat. Focus your generation entirely on your inner monologue, planning states, and immediate native tool execution.`;

// ── Types ───────────────────────────────────────────────────────

interface RationalizationResult {
  originalCount: number;
  processedCount: number;
  systemMerged: number;
  consecutiveMerged: number;
  trailingRemoved: number;
  userAdded: boolean;
  errors: string[];
}

// ── AGENTS.md creation ──────────────────────────────────────────

async function ensureAgentsFile(cwd: string): Promise<void> {
  const agentsPath = resolve(cwd, AGENTS_FILE);
  try {
    await access(agentsPath, constants.R_OK);
  } catch {
    await mkdir(dirname(agentsPath), { recursive: true });
    await writeFile(agentsPath, DEFAULT_AGENTS_CONTENT, "utf-8");
  }
}

// ── Mistral role rationalization ─────────────────────────────────

interface ToolMessage extends Record<string, any> {
  role: "tool";
  content: string;
  tool_call_id: string;
  name: string;
}

function isToolMessage(msg: any): msg is ToolMessage {
  return msg && msg.role === "tool" && typeof msg.tool_call_id === "string" && typeof msg.name === "string";
}

function ensureToolMessage(msg: any): any {
  if (msg && msg.role === "tool" && msg.tool_call_id && msg.name) {
    return { role: "tool", content: extractText(msg.content), tool_call_id: msg.tool_call_id, name: msg.name };
  }
  if (msg && msg.role === "function") {
    // Mistral expects role "tool" not "function"
    return { role: "tool", content: extractText(msg.content), tool_call_id: msg.tool_call_id ?? "", name: msg.name ?? "" };
  }
  return null;
}

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

/**
 * Rationalize chat history for Mistral Small 4 constraints and return detailed results
 */
function rationalizeHistoryForMistral(messages: any[]): { messages: any[]; result: RationalizationResult } {
  const result: RationalizationResult = {
    originalCount: messages.length,
    processedCount: 0,
    systemMerged: 0,
    consecutiveMerged: 0,
    trailingRemoved: 0,
    userAdded: false,
    errors: [],
  };

  if (!messages || messages.length === 0) {
    return { messages: [], result };
  }

  const processed: any[] = [];
  const systemInstructions: string[] = [];

  // Count system messages
  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    if (role === "system" || role === "developer") {
      systemInstructions.push(extractText(msg.content));
    }
  }

  result.systemMerged = systemInstructions.length;

  // Push unified system prompt
  if (systemInstructions.length > 0) {
    processed.push({ role: "system", content: systemInstructions.join("\n\n") });
  }

  // Process conversational messages
  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    if (role === "system" || role === "developer") continue;
    if (role === "tool" || role === "function") {
      // Preserve full tool message structure (tool_call_id, name, content)
      const toolMsg = ensureToolMessage(msg);
      if (toolMsg) {
        // Check if last message is also a tool message (shouldn't merge)
        const lastMsg = processed[processed.length - 1];
        if (lastMsg && lastMsg.role === "tool") {
          // Keep both tool messages separate - don't merge them
          processed.push(toolMsg);
          result.consecutiveMerged++;
        } else {
          processed.push(toolMsg);
        }
      } else {
        // Bare tool message without proper structure - try to preserve raw
        processed.push({ ...msg, role: "tool", content: extractText(msg.content) });
        result.errors.push(`Tool message at index ${messages.indexOf(msg)} missing tool_call_id/name`);
      }
      continue;
    }

    const targetRole = role;
    const stringContent = extractText(msg.content);

    // Mistral constraint: user cannot follow tool directly; insert assistant bridge
    const lastMsg = processed[processed.length - 1];
    if (targetRole === "user" && lastMsg && lastMsg.role === "tool") {
      // Insert synthetic assistant acknowledgement to satisfy tool→assistant→user ordering
      processed.push({
        role: "assistant",
        content: "Tool results received and processed."
      });
      result.consecutiveMerged++;
    }

    // Now handle the current message (re-check lastMsg because we may have inserted)
    const updatedLastMsg = processed[processed.length - 1];
    if (updatedLastMsg && updatedLastMsg.role === targetRole && (targetRole === "user" || targetRole === "assistant")) {
      const current = typeof updatedLastMsg.content === "string" ? updatedLastMsg.content : extractText(updatedLastMsg.content);
      updatedLastMsg.content = `${current}\n\n[Continuation]:\n${stringContent}`;
      result.consecutiveMerged++;
    } else {
      processed.push({ role: targetRole, content: stringContent });
    }
  }

  result.processedCount = processed.length;

  // Boundary enforcements
  if (processed.length === 0) {
    return { messages: [], result };
  }

  if (processed.length === 1 && processed[0].role === "system") {
    processed.push({ role: "user", content: "Execute workspace verification loop." });
    result.userAdded = true;
  }

  while (processed.length > 0 && processed[processed.length - 1].role === "assistant") {
    processed.pop();
    result.trailingRemoved++;
  }

  result.processedCount = processed.length;

  return { messages: processed, result };
}

/**
 * Check if messages are Mistral-compliant and return issues
 */
function checkMistralCompliance(messages: any[]): { compliant: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!messages || messages.length === 0) {
    issues.push("Empty message array");
    return { compliant: false, issues };
  }

  // Must start with system or user
  if (messages[0].role !== "system" && messages[0].role !== "user") {
    issues.push(`First message role must be 'system' or 'user', got '${messages[0].role}'`);
  }

  // Check for consecutive same roles
  for (let i = 1; i < messages.length; i++) {
    const prevRole = messages[i - 1].role.toLowerCase();
    const currRole = messages[i].role.toLowerCase();
    if (prevRole === currRole && (prevRole === "user" || prevRole === "assistant")) {
      issues.push(`Consecutive '${currRole}' messages at positions ${i-1}-${i}`);
    }
    // Mistral constraint: user cannot follow tool directly (needs assistant bridge)
    if (prevRole === "tool" && currRole === "user") {
      issues.push(`Tool message at position ${i-1} cannot be directly followed by user at position ${i} — an assistant message is required between tool results and user`);
    }
  }

  // No trailing assistant
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    issues.push("Last message cannot be 'assistant'");
  }

  // Check for invalid roles
  const validRoles = new Set(["system", "user", "assistant", "tool"]);
  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role.toLowerCase();
    if (!validRoles.has(role)) {
      issues.push(`Invalid role '${messages[i].role}' at position ${i}`);
    }
    // Validate tool message structure
    if (role === "tool") {
      if (!messages[i].tool_call_id || typeof messages[i].tool_call_id !== "string") {
        issues.push(`Tool message at position ${i} missing required 'tool_call_id' field`);
      }
      if (!messages[i].name || typeof messages[i].name !== "string") {
        issues.push(`Tool message at position ${i} missing required 'name' field`);
      }
    }
  }

  return { compliant: issues.length === 0, issues };
}

// ── Message dump for debugging ─────────────────────────────────

function truncate(s: string, maxLen: number = 200): string {
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + `… [truncated ${s.length - maxLen} more chars]`;
}

function dumpMessages(label: string, messages: any[], enabled: boolean = false): void {
  if (!enabled) return;
  const lines: string[] = [
    `╔══ [${label}] ${messages.length} messages ─────────────────`,
  ];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = m.role ?? "???";
    let extra = "";
    if (role === "tool" || (m.tool_call_id && m.name)) {
      extra = `  tool_call_id=${m.tool_call_id ?? "?"}  name=${m.name ?? "?"}`;
    }
    if (role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      extra = `  tool_calls=[${m.tool_calls.map((tc: any) => tc.function?.name ?? tc.id ?? "?").join(", ")}]`;
    }
    const content = truncate(typeof m.content === "string" ? m.content : JSON.stringify(m.content), 150);
    lines.push(`  │ [${i}] role=${role}${extra ? "  " + extra : ""}`);
    if (content) {
      lines.push(`  │     content="${content}"`);
    }
  }
  lines.push(`  └───────────────────────────────────────────────────`);
  console.log("[session-id] " + lines.join("\n[session-id] "));
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sessionId = "";
  let debugMode = false;
  let needsRoleFix = false;
  let lastRequestFailed = false;
  let isNewSession = true;
  let lastRationalizationResult: RationalizationResult | null = null;

  const debug = (...args: any[]) => {
    if (debugMode) console.log("[session-id]", ...args);
  };

  // ── Session start: create AGENTS.md and capture session ID ────
  pi.on("session_start", async (_event: any, ctx) => {
    const newSessionId = ctx.sessionManager.getSessionId() ?? "";
    
    try {
      await ensureAgentsFile(ctx.cwd);
      debug(`AGENTS.md ensured in ${ctx.cwd}`);
    } catch (err) {
      debug(`Failed to create AGENTS.md: ${err}`);
    }
    
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
    lastRationalizationResult = null;
  });

  // ── Apply Mistral role fix and inject session ID ────────────
  pi.on("context", async (event: any) => {
    // Step 1: Always apply Mistral-compatible role rationalization
    // (catches cases where before_provider_request doesn't fire, e.g. non-Mistral
    //  provider or API calls made outside PI's provider pipeline)
    let messages = event.messages;
    
    if (messages && Array.isArray(messages) && messages.length > 0) {
      const { messages: fixedMessages, result } = rationalizeHistoryForMistral(messages);
      lastRationalizationResult = result;
      messages = fixedMessages;
      
      if (result.originalCount !== result.processedCount || result.systemMerged > 0 || result.consecutiveMerged > 0 || result.trailingRemoved > 0 || result.userAdded || result.errors.length > 0) {
        console.log(`[session-id] context: Mistral role fix applied:`);
        console.log(`[session-id]   Original: ${result.originalCount} → Processed: ${result.processedCount}`);
        console.log(`[session-id]   System merged: ${result.systemMerged}, Consecutive merged: ${result.consecutiveMerged}`);
        console.log(`[session-id]   Trailing removed: ${result.trailingRemoved}, User added: ${result.userAdded}`);
        if (result.errors.length > 0) {
          console.log(`[session-id]   Errors: ${result.errors.join('; ')}`);
        }
      }
    }
    
    // Step 2: Inject session ID if needed (on rationalized messages)
    if (sessionId && messages) {
      const hasSession = messages.some((msg: any) => {
        const text = typeof msg.content === "string" ? msg.content : 
                     Array.isArray(msg.content) ? msg.content.map((b: any) => b.text ?? "").join("") : "";
        return text.includes(sessionId);
      });
      
      if ((isNewSession || needsRoleFix) && !hasSession) {
        debug(`Prepending session ID to ${messages.length} messages`);
        isNewSession = false;
        messages = [
          { role: "system", content: `Session: ${sessionId}` },
          ...messages,
        ];
      }
    }
    
    return { messages };
  });

  // ── Mistral role fix: before_provider_request (always for Mistral models) ──
  pi.on("before_provider_request", (event: any) => {
    if (!isMistralModel(event.model)) return undefined;

    const payload = { ...event.payload };
    if (Array.isArray(payload.messages)) {
      // Dump original messages before fix
      dumpMessages(`BEFORE_FIX (${event.model.provider}/${event.model.id})`, payload.messages, debugMode);

      const { messages: fixedMessages, result } = rationalizeHistoryForMistral(payload.messages);
      payload.messages = fixedMessages;
      lastRationalizationResult = result;
      
      // Dump fixed messages after fix
      dumpMessages(`AFTER_FIX (${event.model.provider}/${event.model.id})`, payload.messages, debugMode);

      if (result.originalCount !== result.processedCount || result.systemMerged > 0 || result.consecutiveMerged > 0 || result.trailingRemoved > 0 || result.userAdded || result.errors.length > 0) {
        debug(`Mistral role fix applied on request to ${event.model.provider}/${event.model.id}:`);
        debug(`  Original: ${result.originalCount} messages`);
        debug(`  Processed: ${result.processedCount} messages`);
        debug(`  System merged: ${result.systemMerged}`);
        debug(`  Consecutive merged: ${result.consecutiveMerged}`);
        debug(`  Trailing removed: ${result.trailingRemoved}`);
        debug(`  User added: ${result.userAdded}`);
        if (result.errors.length > 0) {
          debug(`  Errors: ${result.errors.join(', ')}`);
        }
      }
      
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
      
      // Dump error details for analysis
      console.log("[session-id] ╔══ 400 ERROR from Mistral ──────────────────────────────");
      console.log(`[session-id]   Model: ${ctx.model.provider}/${ctx.model.id}`);
      console.log(`[session-id]   Status: ${event.status}`);
      if (event.body && typeof event.body === "object") {
        const body = event.body as any;
        console.log(`[session-id]   Error: ${body.error?.message ?? body.message ?? JSON.stringify(body).slice(0, 500)}`);
        console.log(`[session-id]   Type: ${body.error?.type ?? body.type ?? "N/A"}`);
      } else if (typeof event.body === "string") {
        console.log(`[session-id]   Body: ${event.body.slice(0, 500)}`);
      }
      
      // Dump the messages that were sent (from last rationalization result)
      if (lastRationalizationResult) {
        console.log(`[session-id]   Rationalization: ${lastRationalizationResult.originalCount}→${lastRationalizationResult.processedCount}`);
      }
      console.log("[session-id]   Role fix will apply on retry");
      console.log("[session-id] └────────────────────────────────────────────────────────");
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

  // ── /mistral-check command: check message compliance ─────────
  pi.registerCommand("mistral-check", {
    description: "Check if current context messages are Mistral-compliant",
    handler: async (_args, ctx) => {
      // This would need access to the current messages
      // For now, just show the last rationalization result
      if (lastRationalizationResult) {
        const lines = [
          `Mistral Rationalization Results:`,
          `  Original: ${lastRationalizationResult.originalCount} messages`,
          `  Processed: ${lastRationalizationResult.processedCount} messages`,
          `  System merged: ${lastRationalizationResult.systemMerged}`,
          `  Consecutive merged: ${lastRationalizationResult.consecutiveMerged}`,
          `  Trailing removed: ${lastRationalizationResult.trailingRemoved}`,
          `  User added: ${lastRationalizationResult.userAdded}`,
        ];
        if (lastRationalizationResult.errors.length > 0) {
          lines.push(`  Errors: ${lastRationalizationResult.errors.join(', ')}`);
        }
        ctx.ui.notify(lines.join('\n'), "info");
      } else {
        ctx.ui.notify("No rationalization performed yet in this session", "info");
      }
    },
  });

  // ── /mistral-force command: force role fix on next request ───
  pi.registerCommand("mistral-force", {
    description: "Force Mistral role fix on the next API request",
    handler: async (_args, ctx) => {
      needsRoleFix = true;
      ctx.ui.notify("Mistral role fix will be applied on the next API request", "info");
    },
  });

  // ── /mistral-fix command: immediate comprehensive fix ─────────
  pi.registerCommand("mistral-fix", {
    description: "Check and fix message roles for Mistral compliance immediately",
    handler: async (_args, ctx) => {
      needsRoleFix = true;
      if (lastRationalizationResult) {
        const lines = [
          `Mistral Fix Applied.`,
          `Original: ${lastRationalizationResult.originalCount} → Processed: ${lastRationalizationResult.processedCount}`,
          `System merged: ${lastRationalizationResult.systemMerged}`,
          `Consecutive merged: ${lastRationalizationResult.consecutiveMerged}`,
          `Trailing removed: ${lastRationalizationResult.trailingRemoved}`,
          `User added: ${lastRationalizationResult.userAdded}`,
        ];
        if (lastRationalizationResult.errors.length > 0) {
          lines.push(`Warnings: ${lastRationalizationResult.errors.join('; ')}`);
        }
        lines.push('Next request will have role-compliant messages.');
        ctx.ui.notify(lines.join('\n'), "info");
      } else {
        ctx.ui.notify("Mistral fix flag is set. Role rationalization runs automatically on every Mistral request.", "info");
      }
    },
  });

  // ── /mistral-dump command: dump last rationalization for analysis ──
  pi.registerCommand("mistral-dump", {
    description: "Dump the last Mistral rationalization details (use /debug to see full message dump on next request)",
    handler: async (_args, ctx) => {
      if (lastRationalizationResult) {
        const lines = [
          `╔══ Last Mistral Rationalization ──────────────────`,
          `  Original: ${lastRationalizationResult.originalCount} messages`,
          `  Processed: ${lastRationalizationResult.processedCount} messages`,
          `  System merged: ${lastRationalizationResult.systemMerged}`,
          `  Consecutive merged: ${lastRationalizationResult.consecutiveMerged}`,
          `  Trailing removed: ${lastRationalizationResult.trailingRemoved}`,
          `  User added: ${lastRationalizationResult.userAdded}`,
        ];
        if (lastRationalizationResult.errors.length > 0) {
          lines.push(`  Errors: ${lastRationalizationResult.errors.join('; ')}`);
        }
        lines.push(`  ─────────────────────────────────────────────`);
        lines.push(`  Run /debug to toggle debug mode,`);
        lines.push(`  then send a message to see full message dump.`);
        lines.push(`  └────────────────────────────────────────────`);
        ctx.ui.notify(lines.join('\n'), "info");
      } else {
        ctx.ui.notify("No rationalization performed yet. Send a Mistral request first.", "info");
      }
    },
  });
}
