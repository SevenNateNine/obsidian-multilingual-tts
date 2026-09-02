/**
 * What happens to a saved clip once it is on disk.
 *
 * Kept apart from `types.ts` the way `secret.ts` is: `migrations.ts` needs the
 * guards and `types.ts` needs the default, and neither wants the other.
 */

export const AFTER_SAVE_MODES = ["ask", "selection", "property", "none"] as const;

export type AfterSaveMode = (typeof AFTER_SAVE_MODES)[number];

export const EXISTING_VALUE_MODES = ["ask", "replace", "append"] as const;

export type ExistingValueMode = (typeof EXISTING_VALUE_MODES)[number];

/** What is done once the question is answered, or when it is not asked. */
export type ExistingValueAction = Exclude<ExistingValueMode, "ask">;

export interface AfterSaveSettings {
	mode: AfterSaveMode;
	/** Frontmatter key that receives the wikilink. Empty means not chosen yet. */
	property: string;
	/** What happens when that key already holds a value. */
	existingValue: ExistingValueMode;
}

export const DEFAULT_AFTER_SAVE: AfterSaveSettings = {
	mode: "ask",
	property: "",
	existingValue: "ask",
};

export function isAfterSaveMode(value: unknown): value is AfterSaveMode {
	return AFTER_SAVE_MODES.includes(value as AfterSaveMode);
}

export function isExistingValueMode(value: unknown): value is ExistingValueMode {
	return EXISTING_VALUE_MODES.includes(value as ExistingValueMode);
}
