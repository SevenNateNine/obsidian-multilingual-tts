import type { NoteRecord } from "../ports";
import {
	resolveDefaultProfile,
	type PluginSettings,
	type VoiceProfile,
} from "../settings/types";
import {
	joinVaultPath,
	resolveNameTemplates,
	resolveOutputFolder,
	sanitizeFilename,
} from "../paths";
import {
	expandNameTemplate,
	missingProperties,
	type DateFormatter,
	type NameVars,
} from "../text/nameTemplate";
import { propertyValues, scalarText } from "../text/property";
import { linkTarget } from "../text/wikilink";
import { prepareForSpeech } from "../usecases/prepare";
import { matchesFilter } from "./filter";
import { synthesisHash, synthesisInputs } from "./hash";
import {
	hashFieldFor,
	isBillable,
	ITEM_STATUSES,
	type AudioTarget,
	type BatchItem,
	type BatchPlan,
	type BatchPreset,
	type BatchTotals,
	type ItemStatus,
} from "./types";

/**
 * What a profile will write, or why it can write nothing.
 *
 * Injected, because the answer belongs to a provider and a provider is a
 * detail. The three refusals are settled before a single request goes out, for
 * the reason `saveAudioPrepared` settles them: an impossible combination must
 * cost nothing, rather than fail after the synthesis is paid for.
 */
export type OutputResolver = (
	profile: VoiceProfile,
) =>
	| { ok: true; extension: string }
	| { ok: false; reason: "unknown-provider" | "not-configured" | "cannot-render" };

/** Resolves a link a note holds to the vault path it reaches, or null. */
export type LinkResolver = (linktext: string, fromPath: string) => string | null;

export interface PlanDeps {
	settings: PluginSettings;
	output: OutputResolver;
	resolveLink: LinkResolver;
	/** True when a file already occupies this vault path. */
	exists: (path: string) => boolean;
	/** Injected: moment lives in the obsidian module, which core must not import. */
	formatDate: DateFormatter;
	now?: Date;
}

/**
 * Decide what a run of `preset` would do, without doing any of it.
 *
 * Pure, and over a snapshot rather than a live cache, so a preview and the run
 * that follows it work from the same queue. Every decision that costs money is
 * made here, which is what makes all of it testable with plain objects and no
 * Azure key.
 */
export function planBatch(
	notes: readonly NoteRecord[],
	preset: BatchPreset,
	deps: PlanDeps,
): BatchPlan {
	const matched = notes.filter((note) =>
		matchesFilter(note.frontmatter, preset.filter),
	);
	const items: BatchItem[] = [];

	for (const note of matched) {
		for (const target of preset.targets) {
			items.push(planItem(note, target, preset, deps));
		}
	}

	return {
		presetId: preset.id,
		presetName: preset.name,
		items,
		totals: totalsFor(items, matched.length, preset.targets.length),
	};
}

/** One note and one target. Pending is decided per target, never per note. */
function planItem(
	note: NoteRecord,
	target: AudioTarget,
	preset: BatchPreset,
	deps: PlanDeps,
): BatchItem {
	const item = (status: ItemStatus, rest: Partial<BatchItem> = {}): BatchItem => ({
		notePath: note.path,
		noteTitle: note.basename,
		targetId: target.id,
		audioField: target.audioField,
		status,
		text: "",
		characters: 0,
		path: "",
		missingProperties: [],
		...rest,
	});

	const profile = targetProfile(target, deps.settings);
	if (!profile) return item("no-profile");

	const output = deps.output(profile);
	if (!output.ok) return item(output.reason);

	const text = prepareForSpeech(deps.settings, readField(note, target.textField));
	if (!text) return item("no-text");

	const naming = nameFor(note, target, profile, text, deps);
	const expected = joinVaultPath(
		resolveOutputFolder(profile, deps.settings),
		`${sanitizeFilename(naming.basename)}.${output.extension}`,
	);
	const linked = linkedPath(note, target, deps);
	const status = decide(preset, {
		changed: recordedHashDiffers(note, target, profile, text),
		linked,
		expected,
		exists: deps.exists,
	});

	return item(status, {
		text,
		characters: text.length,
		path: linked ?? expected,
		missingProperties: naming.missing,
	});
}

interface Decision {
	/** True only when a hash was recorded and no longer matches. */
	changed: boolean;
	/** Where the note's link already points, or null when it points nowhere. */
	linked: string | null;
	expected: string;
	exists: (path: string) => boolean;
}

/**
 * The skip rule, in the order its reasons override each other.
 *
 * A recorded hash that no longer matches wins over everything else: the words
 * or the voice have changed, so whatever sits on disk is the wrong clip. With
 * no recorded hash the only question is whether a clip exists, which is what a
 * preset with change tracking off always asks, and what a card made before
 * tracking was turned on falls back to.
 */
function decide(preset: BatchPreset, d: Decision): ItemStatus {
	if (preset.trackChanges && d.changed) return "stale";
	if (d.linked) return "done";
	// The file outlived the link. A run that stopped before it wrote the
	// property leaves exactly this, and paying for that clip again is waste.
	if (d.exists(d.expected)) return "relink";
	return "pending";
}

/** False when no hash was ever recorded, because then there is nothing to compare. */
function recordedHashDiffers(
	note: NoteRecord,
	target: AudioTarget,
	profile: VoiceProfile,
	text: string,
): boolean {
	const stored = scalarText(note.frontmatter[hashFieldFor(target)]);
	if (!stored) return false;
	return stored !== synthesisHash(synthesisInputs(profile, text));
}

/** The profile a target speaks with: the one it names, or the global default. */
function targetProfile(
	target: AudioTarget,
	settings: PluginSettings,
): VoiceProfile | null {
	const id = target.profileId?.trim();
	if (!id) return resolveDefaultProfile(settings);
	return settings.profiles.find((p) => p.id === id) ?? null;
}

/**
 * The file name, and the name-template properties this note does not supply.
 *
 * `nameFrom` is the short way: name every clip after one property and leave the
 * template out of it. With `nameFrom` empty the existing chain decides, exactly
 * as it does for a save from the editor. The prefix goes in front of the result
 * as it was typed, so "KR-" and "KR_" each do what they look like.
 */
function nameFor(
	note: NoteRecord,
	target: AudioTarget,
	profile: VoiceProfile,
	text: string,
	deps: PlanDeps,
): { basename: string; missing: string[] } {
	const from = target.nameFrom?.trim();
	if (from) {
		const stem = readField(note, from) || note.basename;
		return { basename: `${target.prefix}${stem}`, missing: [] };
	}

	const vars: NameVars = {
		title: note.basename,
		selection: text,
		profile: profile.name,
		locale: profile.locale,
		properties: note.frontmatter,
		now: deps.now ?? new Date(),
		formatDate: deps.formatDate,
	};
	const chain = resolveNameTemplates(profile, deps.settings);

	return {
		basename: `${target.prefix}${expandNameTemplate(chain, vars)}`,
		// Reported rather than asked about. A batch must never stop on a dialog,
		// so the preview says which notes will fall back to their own title.
		missing: missingProperties(chain, vars),
	};
}

/** Where the audio property already points, or null when it resolves nowhere. */
function linkedPath(
	note: NoteRecord,
	target: AudioTarget,
	deps: PlanDeps,
): string | null {
	const [link] = propertyValues(note.frontmatter[target.audioField]);
	if (!link) return null;

	const path = linkTarget(link);
	return path ? deps.resolveLink(path, note.path) : null;
}

/** A property as one line of text. A list reads as its values, space separated. */
function readField(note: NoteRecord, property: string): string {
	const key = property.trim();
	if (!key) return "";
	return propertyValues(note.frontmatter[key]).join(" ");
}

function totalsFor(
	items: readonly BatchItem[],
	notes: number,
	targets: number,
): BatchTotals {
	const byStatus = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<
		ItemStatus,
		number
	>;

	let billable = 0;
	let characters = 0;

	for (const item of items) {
		byStatus[item.status]++;
		if (!isBillable(item.status)) continue;
		billable++;
		characters += item.characters;
	}

	return { notes, targets, billable, characters, byStatus };
}
