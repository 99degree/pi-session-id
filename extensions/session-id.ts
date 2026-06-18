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
