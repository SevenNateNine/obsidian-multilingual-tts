import type { AfterSaveSettings, ExistingValueAction } from "../settings/afterSave";
import type { NotePropertyStore, NoteRecord } from "../ports";
import {
	containsLink,
	hasPropertyValue,
	nextPropertyValue,
} from "../text/propertyLink";

/**
 * What to do with a clip once it is saved: link the words that were read, or
 * write a link into a property of the note.
 *
 * The decision is here and the dialog is in `ui/`, so every path through the
 * settings is a table test rather than a click.
 */

export interface AfterSaveContext {
	/** The save came from a selection whose range was captured. */
	hasSelection: boolean;
	/** A note was open when the save started. */
	hasNote: boolean;
	/** What the configured property holds in that note. Undefined when absent. */
	existing: unknown;
}

export type AfterSaveDecision =
	| { kind: "none" }
	| { kind: "ask"; offerSelection: boolean; offerProperty: boolean }
	| { kind: "selection" }
	| { kind: "property"; property: string; existingValue: ExistingValueAction };

/**
 * A configured target that is not possible falls back to the dialog rather
 * than to silence: a Skip costs one key, a link that never appears costs a
 * search for it.
 */
export function decideAfterSave(
	settings: AfterSaveSettings,
	ctx: AfterSaveContext,
): AfterSaveDecision {
	if (settings.mode === "none") return { kind: "none" };
	if (!ctx.hasNote && !ctx.hasSelection) return { kind: "none" };
	if (settings.mode === "selection" && ctx.hasSelection) return { kind: "selection" };

	const property = settings.property.trim();
	const action = resolvedAction(settings.existingValue, ctx.existing);
	if (settings.mode === "property" && ctx.hasNote && property && action) {
		return { kind: "property", property, existingValue: action };
	}

	return { kind: "ask", offerSelection: ctx.hasSelection, offerProperty: ctx.hasNote };
}

/** Null when the question must be asked before anything is written. */
function resolvedAction(
	mode: AfterSaveSettings["existingValue"],
	existing: unknown,
): ExistingValueAction | null {
	if (!hasPropertyValue(existing)) return "replace";
	return mode === "ask" ? null : mode;
}

export type AfterSaveChoice =
	| { target: "selection" }
	| { target: "property"; property: string; existingValue: ExistingValueAction };

/** Enough for a vault with many kinds of note, and short enough to scroll. */
export const MAX_PROPERTY_CANDIDATES = 50;

/**
 * The keys the dialog offers, most likely first.
 *
 * The configured key, then the keys of the note itself in document order, then
 * every other key in the vault by how many notes carry it. The key the user
 * wants is usually on a sibling note already, so the vault belongs in the list.
 */
export function propertyCandidates(
	preferred: string,
	active: Record<string, unknown>,
	notes: readonly NoteRecord[],
	limit = MAX_PROPERTY_CANDIDATES,
): string[] {
	const counts = new Map<string, number>();
	for (const note of notes) {
		for (const key of Object.keys(note.frontmatter)) {
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	// A stable sort keeps the first-seen order between keys of equal count.
	const byUse = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);

	const ordered = [preferred, ...Object.keys(active), ...byUse]
		.map((key) => key.trim())
		.filter((key) => key !== "");

	return [...new Set(ordered)].slice(0, limit);
}

/**
 * The settings after "Always do this".
 *
 * A null choice is a Skip, so the mode becomes none. The answer to the
 * Replace or Append question is kept only when that question was on screen.
 */
export function rememberChoice(
	current: AfterSaveSettings,
	choice: AfterSaveChoice | null,
	rememberExisting: boolean,
): AfterSaveSettings {
	if (!choice) return { ...current, mode: "none" };
	if (choice.target === "selection") return { ...current, mode: "selection" };
	return {
		mode: "property",
		property: choice.property,
		existingValue: rememberExisting ? choice.existingValue : current.existingValue,
	};
}

export interface AfterSaveDeps {
	properties: NotePropertyStore;
}

export interface PropertyLinkRequest {
	notePath: string;
	property: string;
	/** The full wikilink, brackets included. */
	link: string;
	existingValue: ExistingValueAction;
}

/**
 * Write the link, unless the property already points at that file.
 *
 * The new value is computed inside the store's callback, against the live
 * frontmatter, because the cache can be seconds behind an edit.
 */
export async function writePropertyLink(
	deps: AfterSaveDeps,
	req: PropertyLinkRequest,
): Promise<{ changed: boolean }> {
	const current = deps.properties.current(req.notePath, req.property);
	if (alreadyLinked(current, req)) return { changed: false };

	await deps.properties.update(req.notePath, req.property, (existing) =>
		nextPropertyValue(existing, req.link, req.existingValue),
	);
	return { changed: true };
}

/** A replace of a list still changes it, even when the link is one entry. */
function alreadyLinked(current: unknown, req: PropertyLinkRequest): boolean {
	if (!containsLink(current, req.link)) return false;
	return req.existingValue === "append" || !Array.isArray(current);
}
