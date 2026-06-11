# pi-session-id

Tiny [pi](https://github.com/earendil-works/pi-coding-agent) extension that builds the LLM prompt from up to 4 elements:

```
{sessionId}          ← always present

{systemPrompt}       ← pi's default system prompt

{customPrompt}       ← optional, set via /prompt

{claudeContent}      ← optional, loaded via /claude
```

The same 4-element header is also prepended to compaction summaries, so the full identity survives context compression.

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

Once installed, the extension runs automatically. The session ID is always prepended to the system prompt.

### `/prompt` — Custom prompt (element 3)

```bash
/prompt You are an expert in Rust and systems programming.
/prompt              # view current custom prompt
/prompt --clear      # clear it
```

### `/claude` — Load CLAUDE.md (element 4)

```bash
/claude              # loads ./CLAUDE.md
/claude path/to/file.md
/claude --clear      # clear claude content
```

### What the LLM sees

Without custom prompt or claude content:

```
abc12345-...-xyz

You are an expert coding assistant operating inside pi...
...
Current date: 2026-06-11
Current working directory: /home/user/project
```

With a custom prompt set:

```
abc12345-...-xyz

You are an expert coding assistant operating inside pi...
...

You are an expert in Rust and systems programming.
```

After compaction, the same 4-element header appears as the first content in the compacted context, followed by the summarized conversation.

## How it works

| Hook | What it does |
|------|-------------|
| `session_start` | Captures the current session ID and base system prompt |
| `before_agent_start` | Builds the 4-element prompt: `{sessionId}\n\n{systemPrompt}\n\n{customPrompt}\n\n{claudeContent}` |
| `context` | Prepends the same 4-element header to any `compactionSummary` message |

Custom prompt data is persisted to `~/.pi/agent/custom-prompt.json`.

## Files

```
extensions/
└── session-id.ts      # The extension (single file, no deps)
```

## License

LGPL-3.0
