# pi-session-id

Tiny [pi](https://github.com/earendil-works/pi-coding-agent) extension that injects a **user + assistant exchange** at the start of every LLM call to carry session identity and optional custom content, and ensures valid message sequences after compaction.

The system prompt itself is left untouched — pi's default is used.

## What the LLM sees

```
system: (pi's default system prompt)
user:
assistant: {sessionId}
           {systemPrompt}
           {customPrompt}   ← only if set via /prompt
           {claudeContent}  ← only if loaded via /claude
user: (actual user message)
...
```

After compaction, the same pair leads the compacted context. If compaction would leave the first kept message as a non-user message (e.g., assistant or tool call), the extension:
- Removes leading tool calls (they belong to summarized turns)
- Inserts an empty user message before the first remaining non-user message
This ensures the message sequence starts with a user message after the compaction summary, keeping it valid for strict models.

## Install

### From GitHub (recommended)

```bash
pi install git:github.com/99degree/pi-session-id
```

### From npm

```bash
pi install npm:pi-session-id
```

### From a local checkout

```bash
git clone https://github.com/99degree/pi-session-id.git
cd pi-session-id
pi install .
```

### Quick test (no install)

```bash
pi -e ./extensions/session-id.ts
```

## Usage

Once installed, the extension runs automatically. The user + assistant pair is injected on every turn.

### `/prompt` — Set custom content

```bash
/prompt You are an expert in Rust and systems programming.
/prompt              # view current
/prompt --clear      # clear
```

### `/claude` — Load from a file (manual override)

```bash
/claude              # loads ./CLAUDE.md
/claude path/to/file.md
/claude --clear      # clear
```

**Auto-loading**: If no manual claude content is set via `/claude`, the extension will automatically load `./CLAUDE.md` from the current working directory (if present) and use it as the claude content. Manual overrides take precedence and persist until cleared.

## How it works

| Hook | What it does |
|------|-------------|
| `session_start` | Captures session ID and base system prompt |
| `context` | Prepends `user: ""` + `assistant: {info}` before every LLM call (checks to avoid duplication). For compaction summaries, wraps the info into the summary text and fixes the message sequence after the summary (removes leading tool calls, ensures user message before first non-tool message). Also ensures the context ends with a user message so the LLM will generate an assistant response. |

Custom prompt data is persisted to `~/.pi/agent/custom-prompt.json`.

## Files

```
extensions/
└── session-id.ts      # The extension (single file, no deps)
```

## License

LGPL-3.0
