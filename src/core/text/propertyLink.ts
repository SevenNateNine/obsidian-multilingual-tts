import { linkTarget } from "./wikilink";
import { propertyValues } from "./property";
import type { ExistingValueAction } from "../settings/afterSave";

/**
 * Putting a link to a clip into a frontmatter property.
 *
 * The property can hold anything the note author wrote. Nothing here drops a
 * value: an append keeps what is there and adds the link beside it.
 */

/** True when the property holds something worth asking about. */
export function hasPropertyValue(existing: unknown): boolean {
	if (existing === undefined || existing === null) return false;
	if (typeof existing === "string") return existing.trim() !== "";
	return !Array.isArray(existing) || existing.length > 0;
}

/**
 * True when one entry already points at the same file as `link`.
 *
 * Compared by target, so `[[Audio/x.mp3]]`, `![[Audio/x.mp3]]` and
 * `[[Audio/x.mp3|alias]]` count as one link. A non-string entry never matches.
 */
export function containsLink(existing: unknown, link: string): boolean {
	const wanted = linkTarget(link);
	const list = Array.isArray(existing) ? existing : [existing];
	return list.some(
		(entry) => typeof entry === "string" && linkTarget(entry) === wanted,
	);
}

/**
 * The value the property holds after the link is written.
 *
 * An append to an empty property is a scalar, not a list of one, because that
 * is what a person writes by hand. An append to a scalar makes a list of two,
 * whatever the scalar is, so a number or a nested object is kept too.
 */
export function nextPropertyValue(
	existing: unknown,
	link: string,
	mode: ExistingValueAction,
): unknown {
	if (mode === "replace" || !hasPropertyValue(existing)) return link;
	if (containsLink(existing, link)) return existing;
	return Array.isArray(existing) ? [...existing, link] : [existing, link];
}

/** The current value on one line, for a dialog. Empty when it cannot be shown. */
export function propertyText(existing: unknown): string {
	return propertyValues(existing).join(", ");
}
