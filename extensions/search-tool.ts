// extensions/search-tool.ts
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

/** Parameters for the local file keyword search tool. */
const SearchParams = Type.Object({
	pattern: Type.String({ description: "Regex pattern to search for" }),
	path: Type.Optional(Type.String({ description: "Directory to search (default: current cwd)" })),
	glob: Type.Optional(Type.String({ description: "File glob, e.g. '*.rs'" })),
	caseSensitive: Type.Optional(Type.Boolean({ description: "Make the search case-sensitive" })),
	fixedString: Type.Optional(Type.Boolean({ description: "Treat the pattern as a fixed string instead of a regex" })),
	wholeWord: Type.Optional(Type.Boolean({ description: "Match whole words only" })),
	contextLines: Type.Optional(Type.Integer({ description: "Number of context lines around each match", minimum: 0, maximum: 10, default: 0 })),
	maxMatches: Type.Optional(Type.Integer({ description: "Maximum matching lines to return", minimum: 1, maximum: 1000, default: 200 })),
});

type SearchArgs = {
	pattern: string;
	path?: string;
	glob?: string;
	caseSensitive?: boolean;
	fixedString?: boolean;
	wholeWord?: boolean;
	contextLines?: number;
	maxMatches?: number;
};

function normalizeArgs(args: unknown): SearchArgs {
	if (!args || typeof args !== "object") return { pattern: "" };
	const input = args as Record<string, unknown>;
	return {
		pattern: typeof input.pattern === "string" ? input.pattern : typeof input.regex === "string" ? input.regex : "",
		path: typeof input.path === "string" ? input.path : typeof input.dir === "string" ? input.dir : undefined,
		glob: typeof input.glob === "string" ? input.glob : typeof input.include === "string" ? input.include : undefined,
		caseSensitive: typeof input.caseSensitive === "boolean" ? input.caseSensitive : typeof input.case_sensitive === "boolean" ? input.case_sensitive : undefined,
		fixedString: typeof input.fixedString === "boolean" ? input.fixedString : typeof input.fixed === "boolean" ? input.fixed : undefined,
		wholeWord: typeof input.wholeWord === "boolean" ? input.wholeWord : typeof input.word === "boolean" ? input.word : undefined,
		contextLines: typeof input.contextLines === "number" ? input.contextLines : typeof input.context === "number" ? input.context : undefined,
		maxMatches: typeof input.maxMatches === "number" ? input.maxMatches : typeof input.max_matches === "number" ? input.max_matches : typeof input.limit === "number" ? input.limit : undefined,
	};
}

function buildGrepArgs(args: SearchArgs): string[] {
	const grepArgs = ["grep", "-R", "-n"];
	if (args.glob) grepArgs.push(`--include=${args.glob}`);
	if (args.contextLines && args.contextLines > 0) grepArgs.push("-C", String(args.contextLines));
	if (args.maxMatches && args.maxMatches > 0) grepArgs.push("-m", String(args.maxMatches));
	if (args.fixedString) grepArgs.push("-F");
	else grepArgs.push("-E");
	if (args.wholeWord) grepArgs.push("-w");
	if (args.caseSensitive === false) grepArgs.push("-i");
	grepArgs.push(args.pattern);
	grepArgs.push(args.path || ".");
	return grepArgs;
}

export default function searchTool(pi: ExtensionAPI) {
	const tool: ToolDefinition<typeof SearchParams, {
		pattern: string;
		path?: string;
		glob?: string;
		caseSensitive?: boolean;
		fixedString?: boolean;
		wholeWord?: boolean;
		contextLines?: number;
		maxMatches?: number;
		matchCount: number;
		exitCode?: number;
		stderr?: string;
	}> = {
		name: "search",
		label: "grep",
		description: "Search local files for a regex or keyword. Output is truncated to the pi default line/byte limits.",
		promptSnippet: "Search local files for a regex or keyword",
		promptGuidelines: [
			"Use search to find definitions, references, logs, config values, or snippets in local files before answering codebase questions.",
		],
		parameters: SearchParams,
		executionMode: "parallel",
		prepareArguments(args) {
			return normalizeArgs(args) as any;
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			onUpdate?.({
				content: [{ type: "text", text: `Searching ${params.path || "."} for ${params.pattern}` }],
				details: { pattern: params.pattern, path: params.path || "." },
			});

			const result = await pi.exec("grep", buildGrepArgs(params), {
				cwd: ctx.cwd,
				timeout: 30000,
				signal,
			});

			const stdout = result.stdout || "";
			const stderr = result.stderr || "";
			const output = [stdout, stderr].filter(Boolean).join("\n");

			if (signal?.aborted || result.killed) {
				return {
					content: [{ type: "text", text: "Search cancelled." }],
					details: { pattern: params.pattern, path: params.path || ".", cancelled: true },
				};
			}

			if (!stdout.trim()) {
				return {
					content: [{ type: "text", text: stderr.trim() ? `No matches found.\n\n${stderr.trim()}` : "No matches found" }],
					details: {
						pattern: params.pattern,
						path: params.path || ".",
						glob: params.glob,
						caseSensitive: params.caseSensitive,
						fixedString: params.fixedString,
						wholeWord: params.wholeWord,
						contextLines: params.contextLines ?? 0,
						maxMatches: params.maxMatches ?? 200,
						matchCount: 0,
						exitCode: result.code,
						stderr: stderr || undefined,
					},
				};
			}

			const trunc = truncateHead(output, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			const matchCount = stdout.split("\n").filter((line) => line.trim()).length;
			let text = trunc.content;
			if (trunc.truncated) {
				const omittedLines = trunc.totalLines - trunc.outputLines;
				const omittedBytes = trunc.totalBytes - trunc.outputBytes;
				text += `\n\n[Output truncated: ${trunc.outputLines}/${trunc.totalLines} lines (${formatSize(
					trunc.outputBytes,
				)}/${formatSize(trunc.totalBytes)}). ${omittedLines} lines (${formatSize(
					omittedBytes,
				)}) omitted.]`;
			}

			return {
				content: [{ type: "text", text }],
				details: {
					pattern: params.pattern,
					path: params.path || ".",
					glob: params.glob,
					caseSensitive: params.caseSensitive,
					fixedString: params.fixedString,
					wholeWord: params.wholeWord,
					contextLines: params.contextLines ?? 0,
					maxMatches: params.maxMatches ?? 200,
					matchCount,
					exitCode: result.code,
					stderr: stderr || undefined,
				},
			};
		},
		renderCall(args, theme, _context) {
			let txt = theme.fg("toolTitle", theme.bold("search "));
			txt += theme.fg("accent", `"${args.pattern}"`);
			if (args.path) txt += theme.fg("muted", ` in ${args.path}`);
			if (args.glob) txt += theme.fg("dim", ` --include=${args.glob}`);
			if (args.fixedString) txt += theme.fg("dim", " --fixed");
			if (args.wholeWord) txt += theme.fg("dim", " --word");
			return new Text(txt, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);
			const details = result.details as any;
			if (!details || details.matchCount === 0) {
				return new Text(theme.fg("dim", "No matches found"), 0, 0);
			}
			let txt = theme.fg("success", `${details.matchCount} matches`);
			if (details.truncation?.truncated) txt += theme.fg("warning", " (truncated)");
			if (expanded && result.content[0]?.type === "text") {
				const lines = result.content[0].text.split("\n").slice(0, 20);
				for (const line of lines) txt += `\n${theme.fg("dim", line)}`;
				if (result.content[0].text.split("\n").length > 20) {
					txt += `\n${theme.fg("muted", "... (use read tool for full output)")}`;
				}
			}
			return new Text(txt, 0, 0);
		},
	};

	pi.registerTool(tool);
}
