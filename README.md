# pi-session-id

Tiny [pi](https://github.com/earendil-works/pi-coding-agent) extension that **prepends the session ID** (followed by the full system prompt) to:

1. **The system prompt** — the session ID is the very first thing the LLM sees on every turn.
2. **Every compaction summary** — after compaction, the session ID + system prompt appear as the first content in the compacted context, ensuring the session identity survives compression.

## Install

```bash
pi install npm:pi-session-id
```

Or from a local checkout:

```bash
pi -e ./extensions/session-id.ts
```

## What it does

Before the extension, the LLM sees:

```
You are an expert coding assistant operating inside pi...
...
Current date: 2026-06-11
Current working directory: /home/user/project
```

After the extension:

```
abc12345-...-xyz

You are an expert coding assistant operating inside pi...
...
Current date: 2026-06-11
Current working directory: /home/user/project
```

And after compaction, the first message in context becomes:

```
abc12345-...-xyz

You are an expert coding assistant...
...
Current date: 2026-06-11
Current working directory: /home/user/project

## Goal
[summarized conversation]
...
```

The session ID acts as a persistent marker that survives compaction — it's embedded in the system prompt at the start, and re-embedded into each compaction summary so it's always present at the top of the LLM's context window.

## How it works

| Hook | What it does |
|------|-------------|
| `session_start` | Captures the current session ID and base system prompt |
| `before_agent_start` | Prepends `{sessionId}\n\n` to the system prompt for this turn |
| `context` | If a `compactionSummary` message is present, prepends `{sessionId}\n\n{system prompt}\n\n` to its `summary` field (deep copy, no accumulation) |

## Files

```
extensions/
└── session-id.ts      # The extension (single file, no deps)
```

## License

MIT
