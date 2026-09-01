/**
 * The markup that ties a saved clip to the word it was made from.
 *
 * Kept apart from the editor so each form can be tested as a string. The
 * caller supplies both a link text and a path, because the three forms need
 * different things: Obsidian resolves a wikilink from its shortest form, and a
 * markdown link needs a real, encoded path.
 */

export const LINK_STYLES = ["wikilink", "markdown", "embed"] as const;

export type LinkStyle = (typeof LINK_STYLES)[number];

export interface LinkTarget {
	/** Shortest form that resolves from the note receiving the link. */
	linktext: string;
	/** Vault-relative path, including the extension. */
	path: string;
}

/** Characters that end a wikilink early, whatever follows them. */
const WIKILINK_BREAKERS = /[[\]|]/;

/**
 * `word` marked up as a link to `target`.
 *
 * A wikilink is the default because Obsidian rewrites it when the audio is
 * moved or renamed. A word holding `[`, `]` or `|` cannot be the display text
 * of one, so those fall back to the markdown form rather than producing broken
 * markup.
 */
export function audioLink(style: LinkStyle, word: string, target: LinkTarget): string {
	if (style === "embed") return `${word} ![[${target.linktext}]]`;
	if (style === "wikilink" && !WIKILINK_BREAKERS.test(word)) {
		return `[[${target.linktext}|${word}]]`;
	}
	return `[${word}](${encodePath(target.path)})`;
}

export function isLinkStyle(value: unknown): value is LinkStyle {
	return LINK_STYLES.includes(value as LinkStyle);
}

/** Per segment, so the slashes stay slashes and a space becomes %20. */
function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}
