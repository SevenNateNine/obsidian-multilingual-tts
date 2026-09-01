/**
 * Reading a wikilink that a note already holds.
 *
 * The inverse of `audioLink.ts`, which writes them. A frontmatter property
 * points at a note or at a clip, and two things want to know what it points at:
 * the batch filter, which compares it to a value the user typed, and the batch
 * planner, which asks the vault whether that file is still there.
 */

/**
 * The path part of a link, with the case and the folders intact.
 *
 * Drops the brackets, the leading `!` of an embed, the alias after `|`, and the
 * heading or block reference after `#`. What is left is what Obsidian resolves
 * against the vault, so it must not be lower-cased or shortened here.
 */
export function linkTarget(raw: string): string {
	const trimmed = raw.trim();
	const inner = /^!?\[\[(.*)\]\]$/.exec(trimmed);
	const value = inner?.[1] ?? trimmed;

	const withoutAlias = value.split("|")[0] ?? "";
	return (withoutAlias.split("#")[0] ?? "").trim();
}

/**
 * The bare name a link refers to, for comparing two of them.
 *
 * Only the last path segment, lower-cased, because Obsidian resolves a link
 * without regard to case and a filter that did not would fail on
 * `[[flashcard]]`. Use `linkTarget` instead when the vault has to find the file.
 */
export function linkName(raw: string): string {
	const segments = linkTarget(raw).split("/");
	return (segments[segments.length - 1] ?? "").toLowerCase();
}
