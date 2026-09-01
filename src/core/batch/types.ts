/**
 * The shape of a batch run: what it selects, what it makes, and what it decides.
 *
 * Free of Obsidian imports like the rest of `core/`, so the whole planning step
 * is unit testable against plain objects. `NoteRecord` in `core/ports.ts` is
 * exactly the shape the metadata cache hands back.
 */

/**
 * One frontmatter field to speak, and the property that records its clip.
 *
 * A card can carry several, so one pass makes the Korean audio and the English
 * audio together. `audioField` and `prefix` must both be unique inside a preset:
 * two targets that share either one write over each other in silence.
 */
export interface AudioTarget {
	id: string;
	/** Property holding the words to speak. */
	textField: string;
	/** Property that receives the wikilink to the clip. */
	audioField: string;
	/** Prepended to the file name, so two targets of one note never collide. */
	prefix: string;
	/** Property to name the file after. Empty means the name template decides. */
	nameFrom?: string | undefined;
	/**
	 * A `VoiceProfile.id`. Empty means the default profile.
	 *
	 * Explicit rather than detected: `autoDetect.minChars` defaults to 30 and a
	 * flashcard field is shorter, so detection would return the default profile
	 * for a whole deck without saying so.
	 */
	profileId?: string | undefined;
	/** Property holding the change hash. Empty means `${audioField}_hash`. */
	hashField?: string | undefined;
}

/** The notes a preset acts on. One property, one value. */
export interface BatchFilter {
	property: string;
	/** Compared as a bare name, so `[[Flashcard]]` and `Flashcard` are one value. */
	value: string;
}

export interface BatchPreset {
	id: string;
	name: string;
	filter: BatchFilter;
	targets: AudioTarget[];
	/**
	 * Record a hash of the synthesis inputs beside each link, so an edited field
	 * is spoken again. Off means a clip is made once and never refreshed.
	 */
	trackChanges: boolean;
}

/**
 * What a batch decided about one note and one target.
 *
 * `pending` and `stale` are the two that cost money. `done` and `relink` cost
 * nothing. The rest are refusals, each naming what the note or the settings
 * lack, and the last three repeat words that `outcomes.ts` already uses.
 */
export type ItemStatus =
	| "pending"
	| "stale"
	| "done"
	| "relink"
	| "no-text"
	| "no-profile"
	| "unknown-provider"
	| "not-configured"
	| "cannot-render";

/** Every status, in the order a report reads best: the costly ones first. */
export const ITEM_STATUSES: readonly ItemStatus[] = [
	"pending",
	"stale",
	"relink",
	"done",
	"no-text",
	"no-profile",
	"unknown-provider",
	"not-configured",
	"cannot-render",
];

/** True when this item sends text to a provider, and is therefore billed. */
export function isBillable(status: ItemStatus): boolean {
	return status === "pending" || status === "stale";
}

export interface BatchItem {
	notePath: string;
	noteTitle: string;
	targetId: string;
	/** Carried so a report names the property rather than an opaque id. */
	audioField: string;
	status: ItemStatus;
	/** Prepared exactly as the speech path prepares it. Empty unless billable. */
	text: string;
	characters: number;
	/** Where the clip goes, or where it already is. Empty when nothing is made. */
	path: string;
	/** Name-template properties this note does not supply. */
	missingProperties: string[];
}

export interface BatchTotals {
	/** Notes the filter matched. */
	notes: number;
	targets: number;
	/** Items that will be synthesized: `pending` plus `stale`. */
	billable: number;
	characters: number;
	byStatus: Record<ItemStatus, number>;
}

export interface BatchPlan {
	presetId: string;
	presetName: string;
	items: BatchItem[];
	totals: BatchTotals;
}

/** Where a target keeps its change hash. */
export function hashFieldFor(target: AudioTarget): string {
	return target.hashField?.trim() || `${target.audioField.trim()}_hash`;
}
