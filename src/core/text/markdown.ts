/**
 * Markdown -> plain text for speech synthesis.
 *
 * Derived from the `cleanMarkup` helper in luhaifeng666/obsidian-text2audio (MIT),
 * extended to cover the Obsidian-specific syntax it missed: frontmatter, wikilinks,
 * embeds, callouts, highlights, comments and tags.
 *
 * Rule order matters. Block-level constructs are removed before inline ones so
 * that, for example, a heading's `#` is gone before tags are considered.
 */
export function stripMarkdown(input: string): string {
	let out = input ?? "";

	// YAML frontmatter, only when it opens the document.
	out = out.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");

	// Obsidian comments %% ... %%, including multi-line.
	out = out.replace(/%%[\s\S]*?%%/g, "");

	// Fenced code blocks, contents included — reading code aloud is rarely wanted.
	out = out.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, "");
	// An unterminated fence swallows the rest of the document.
	out = out.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, "");

	// Display math.
	out = out.replace(/\$\$[\s\S]*?\$\$/g, "");

	// Horizontal rules, before list markers so `---` is not read as a list.
	out = out.replace(/^[ \t]*([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, "");

	// Callouts: keep the optional title, drop `> [!type]` and any fold marker.
	out = out.replace(/^[ \t]*>[ \t]*\[!\w+\][-+]?[ \t]*(.*)$/gm, "$1");

	// Blockquote markers.
	out = out.replace(/^[ \t]*>[ \t]?/gm, "");

	// Embeds: drop entirely, they have no spoken content.
	out = out.replace(/!\[\[[^\]]*\]\]/g, "");

	// Wikilinks: prefer the display alias, else the target minus any path/anchor.
	out = out.replace(
		/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
		(_m, target: string, alias?: string) => {
			if (alias !== undefined && alias.trim() !== "") return alias;
			const withoutAnchor = target.split(/[#^]/)[0] ?? target;
			const leaf = withoutAnchor.split("/").pop() ?? withoutAnchor;
			return leaf.trim() || target;
		},
	);

	// Setext heading underlines.
	out = out.replace(/^[ \t]*[=-]{2,}[ \t]*$/gm, "");

	// Footnote definitions and references.
	out = out.replace(/^[ \t]*\[\^[^\]]+\]:.*$/gm, "");
	out = out.replace(/\[\^[^\]]+\]/g, "");

	// Reference-style link definitions.
	out = out.replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm, "");

	// Images become alt text. Inline links become link text.
	out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

	// ATX headings — strip the marker, keep the text.
	out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm, "$1");

	// List markers.
	out = out.replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]*/gm, "");
	out = out.replace(/^[ \t]*[-*+][ \t]+/gm, "");
	out = out.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");

	// Table pipes and separator rows.
	out = out.replace(
		/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm,
		"",
	);
	out = out.replace(/[ \t]*\|[ \t]*/g, " ");

	// Inline code.
	out = out.replace(/`([^`]+)`/g, "$1");

	// Highlights and strikethrough.
	out = out.replace(/==([^=]+)==/g, "$1");
	out = out.replace(/~~([^~]+)~~/g, "$1");

	// Emphasis. `_` only counts at a word boundary, unlike `*`.
	out = out.replace(/(\*+)(\S)(.*?\S)??\1/g, "$2$3");
	out = out.replace(/(^|\W)(_+)(\S)(.*?\S)??\2($|\W)/g, "$1$3$4$5");

	// Remaining HTML tags.
	out = out.replace(/<[^>]*>/g, "");

	// Tags: speak the word, not the hash. Requires a letter after `#` so that
	// `#1` and bare `#` are left alone.
	out = out.replace(/(^|\s)#([A-Za-z][\w/-]*)/g, "$1$2");

	// Better BibTeX citekeys and CriticMarkup comments.
	out = out.replace(/\[\s*@[\w,\s]+\s*\]/g, "");
	out = out.replace(/\{>>[\s\S]*?<<\}/g, "");

	return collapseWhitespace(out);
}

/** Trim each line, drop blank runs, and normalize to single blank-line separation. */
export function collapseWhitespace(input: string): string {
	return input
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Apply the user's optional filter regex.
 *
 * A malformed pattern returns the text unchanged rather than throwing — the
 * original plugin let the exception escape and break the whole conversion.
 */
export function applyTextFilter(text: string, rule: string): string {
	const pattern = rule?.trim();
	if (!text || !pattern) return text;

	// Accept both `/body/flags` and a bare pattern.
	const delimited = /^\/(.*)\/([gimsuy]*)$/s.exec(pattern);
	const body = delimited?.[1] ?? pattern;
	const flags = delimited?.[2] || "gi";

	try {
		return text.replace(new RegExp(body, ensureGlobal(flags)), " ");
	} catch {
		return text;
	}
}

function ensureGlobal(flags: string): string {
	return flags.includes("g") ? flags : `${flags}g`;
}

/** Full text preparation: strip markdown (optional), then apply the user filter. */
export function prepareText(
	raw: string,
	opts: { stripMarkdown: boolean; filterRegex: string },
): string {
	const stripped = opts.stripMarkdown ? stripMarkdown(raw) : collapseWhitespace(raw);
	return collapseWhitespace(applyTextFilter(stripped, opts.filterRegex));
}
