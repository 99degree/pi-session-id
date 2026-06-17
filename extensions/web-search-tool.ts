import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
}

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ");
}

function stripHtml(input: string): string {
	return decodeHtmlEntities(
		input
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);
		return url.searchParams.get("uddg") ?? rawUrl;
	} catch {
		return rawUrl;
	}
}

function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
	const results: WebSearchResult[] = [];
	const resultRegex = /<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
	let match: RegExpExecArray | null;
	while ((match = resultRegex.exec(html)) !== null) {
		const title = stripHtml(match[2]);
		const snippet = stripHtml(match[3]);
		if (!title) continue;
		results.push({
			title,
			url: normalizeDuckDuckGoUrl(match[1]),
			snippet,
		});
	}
	return results;
}

async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResult[]> {
	const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
		headers: {
			"User-Agent": "Mozilla/5.0 pi-session-id web search tool",
		},
	});
	if (!response.ok) {
		throw new Error(`Web search request failed with HTTP ${response.status}`);
	}
	const html = await response.text();
	return parseDuckDuckGoHtml(html).slice(0, Math.max(1, Math.min(10, maxResults)));
}

export default function webSearchTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web search",
		description: "Search the web for current information. Use this when the answer depends on recent facts, live status, or sources not already in the conversation.",
		promptSnippet: "Search the web for current information",
		promptGuidelines: [
			"Use web_search when current web information is needed before answering.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return", minimum: 1, maximum: 10, default: 5 })),
			region: Type.Optional(Type.String({ description: "Optional region/language hint, for example en-US" })),
		}),
		prepareArguments(args) {
			if (!args || typeof args !== "object") return args;
			const input = args as Record<string, unknown>;
			const query = typeof input.query === "string"
				? input.query
				: typeof input.q === "string"
					? input.q
					: undefined;
			if (!query) return args;
			const maxResults = typeof input.maxResults === "number"
				? input.maxResults
				: typeof input.max_results === "number"
					? input.max_results
					: typeof input.limit === "number"
						? input.limit
						: 5;
			const region = typeof input.region === "string"
				? input.region
				: typeof input.country === "string"
					? input.country
					: undefined;
			return { query, maxResults, ...(region ? { region } : {}) };
		},
		async execute(_toolCallId, params, signal, onUpdate) {
			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Web search cancelled." }], details: { query: params.query } };
			}
			onUpdate?.({
				content: [{ type: "text", text: `Searching web for "${params.query}"...` }],
				details: { query: params.query },
			});
			const results = await searchWeb(params.query, params.maxResults ?? 5);
			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No web search results found." }],
					details: { query: params.query, results: [] },
				};
			}
			const text = results.map((result, index) => (
				`${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`
			)).join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: { query: params.query, results },
			};
		},
	});
}
