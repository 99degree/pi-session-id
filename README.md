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

After compaction, the same pair leads the compacted context. If compaction would leave the first kept message as an assistant message or tool call, the extension:
- Removes leading tool calls (they belong to summarized turns)
- Inserts an empty user message before the first kept assistant message
This ensures the message sequence remains valid for strict models.

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

### `/claude` — Load from a file

```bash
/claude              # loads ./CLAUDE.md
/claude path/to/file.md
/claude --clear      # clear
```

## How it works

| Hook | What it does |
|------|-------------|
| `session_start` | Captures session ID and base system prompt |
| `context` | Prepends `user: ""` + `assistant: {info}` before every LLM call (checks to avoid duplication). For compaction summaries, wraps the info into the summary text and fixes the message sequence after the summary (removes leading tool calls, inserts empty user before assistant if needed). |

Custom prompt data is persisted to `~/.pi/agent/custom-prompt.json`.

## Files

```
extensions/
└── session-id.ts      # The extension (single file, no deps)
```

## License

LGPL-3.0
