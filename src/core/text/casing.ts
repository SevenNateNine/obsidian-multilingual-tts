/**
 * The case filters of a file name template: `{{property:word|kebab}}`.
 *
 * A word is one run of letters or digits, in any script. Everything between
 * two words only separates them. So "You can do this later!" gives
 * `you-can-do-this-later`, and Korean or Chinese text keeps its characters.
 *
 * Limit: the input is not split on its own case changes. `iPhone` is one word.
 * A phrase from a note property is natural language, and a split at each
 * capital letter would cut names and acronyms apart.
 */

/** The words of `text`. Empty when it has no letter and no digit. */
function words(text: string): string[] {
	return text.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** "You can do this later" -> "You". Lowercases the rest of the word. */
function capitalize(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** "You can do this later" -> "you-can-do-this-later". */
export function kebabCase(text: string): string {
	return words(text)
		.map((word) => word.toLowerCase())
		.join("-");
}

/** "You can do this later" -> "you_can_do_this_later". */
export function snakeCase(text: string): string {
	return words(text)
		.map((word) => word.toLowerCase())
		.join("_");
}

/** "You can do this later" -> "youCanDoThisLater". */
export function camelCase(text: string): string {
	const [first = "", ...rest] = words(text);
	return first.toLowerCase() + rest.map(capitalize).join("");
}

/** "You can do this later" -> "YouCanDoThisLater". */
export function pascalCase(text: string): string {
	return words(text).map(capitalize).join("");
}
