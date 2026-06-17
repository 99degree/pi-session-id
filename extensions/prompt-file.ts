// extensions/prompt-file.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

type InputEvent = {
	text: string;
};

const PROMPT_FILE_RE = /^\/prompt\s+@(.+?)\s*$/u;
const FRONT_MATTER_RE = /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u;

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parsePromptFileRef(text: string): string | undefined {
	const match = text.match(PROMPT_FILE_RE);
	if (!match) return undefined;
	const ref = stripQuotes(match[1]);
	return ref.length > 0 ? ref : undefined;
}

function candidatePaths(ref: string, cwd: string): string[] {
	const cleanRef = ref.startsWith("@") ? ref.slice(1) : ref;
	const absoluteRef = isAbsolute(cleanRef) ? resolve(cleanRef) : resolve(cwd, cleanRef);
	const candidates = [absoluteRef];

	if (!basename(cleanRef).includes(".")) {
		candidates.push(`${absoluteRef}.md`);
	}

	return candidates;
}

function promptDirs(cwd: string): string[] {
	return [
		resolve(cwd, "prompts"),
		resolve(cwd, ".pi", "prompts"),
		resolve(homedir(), ".pi", "agent", "prompts"),
	];
}

function findExisting(candidates: string[]): string | undefined {
	return candidates.find((path) => existsSync(path));
}

async function resolvePromptFile(ref: string, cwd: string, pi: ExtensionAPI): Promise<string> {
	const direct = findExisting(candidatePaths(ref, cwd));
	if (direct) return resolve(direct);

	const cleanRef = ref.startsWith("@") ? ref.slice(1) : ref;
	const nameWithoutExt = cleanRef.replace(/\.md$/u, "");

	for (const dir of promptDirs(cwd)) {
		const byPath = findExisting(candidatePaths(cleanRef, dir));
		if (byPath) return resolve(byPath);
		const byName = findExisting(candidatePaths(nameWithoutExt, dir));
		if (byName) return resolve(byName);
	}

	for (const command of pi.getCommands()) {
		if (command.source !== "prompt") continue;
		const commandName = command.name.split(":")[0];
		if (commandName === nameWithoutExt || commandName === cleanRef) {
			return resolve(command.sourceInfo.path);
		}
	}

	throw new Error(`Prompt file not found: ${ref}`);
}

function stripFrontMatter(markdown: string): string {
	return markdown.replace(FRONT_MATTER_RE, "").trimStart();
}

export default function promptFile(pi: ExtensionAPI) {
	pi.on("input", async (event: InputEvent, ctx) => {
		const ref = parsePromptFileRef(event.text);
		if (!ref) return { action: "continue" as const };

		const path = await resolvePromptFile(ref, ctx.cwd, pi);
		const raw = await readFile(path, "utf8");
		const text = stripFrontMatter(raw).trimEnd();

		if (ctx.hasUI) {
			const label = relative(ctx.cwd, path).startsWith("..") ? path : relative(ctx.cwd, path);
			ctx.ui.notify(`Loaded prompt ${label}`, "info");
		}

		return { action: "transform" as const, text };
	});
}
