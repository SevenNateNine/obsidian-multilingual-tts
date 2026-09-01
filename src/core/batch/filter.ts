import { propertyValues } from "../text/property";
import { linkName } from "../text/wikilink";
import type { BatchFilter } from "./types";

/**
 * Which notes a batch acts on.
 *
 * The value of a property is usually a wikilink, because a card points at the
 * note that defines its type. `[[Cards/Flashcard|card]]` and `Flashcard` name
 * the same thing, so both sides are reduced to a bare name before they are
 * compared.
 */
export function matchesFilter(
	frontmatter: Record<string, unknown>,
	filter: BatchFilter,
): boolean {
	const property = filter.property.trim();
	const wanted = linkName(filter.value);
	if (!property || !wanted) return false;

	return propertyValues(frontmatter[property]).some(
		(value) => linkName(value) === wanted,
	);
}
