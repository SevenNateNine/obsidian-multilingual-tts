/**
 * Reading a frontmatter property, whatever shape the note author gave it.
 *
 * Obsidian parses a property into a string, a number, a boolean, or a list of
 * those. Three callers need that same rule: the file name template, the batch
 * filter, and the field a batch synthesizes. The rule lives here so it is
 * written once and tested once.
 */

/** One value as text. Empty for a type that has no sensible reading. */
export function scalarText(raw: unknown): string {
	if (typeof raw === "string") return raw.trim();
	if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
	return "";
}

/**
 * Every value of a property, as text, with the empty ones dropped.
 *
 * A single value reads as a list of one, so no caller has to ask whether the
 * author wrote `type: card` or `type: [card]`.
 *
 * Only one level deep on purpose: a list inside a list contributes nothing,
 * which keeps this a fixed amount of work rather than following whatever
 * nesting a note happens to hold.
 */
export function propertyValues(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map(scalarText).filter((value) => value !== "");
}
