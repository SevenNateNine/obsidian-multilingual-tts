import {
	CURRENT_SCHEMA_VERSION,
	DEFAULT_SETTINGS,
	createAudioTarget,
	createBatchPreset,
	createProfile,
	createProviderInstance,
	systemProviderInstance,
	type PluginSettings,
	type ProviderInstance,
	type VoiceProfile,
} from "./types";
import {
	LEGACY_AZURE_PROVIDER_ID,
	SYSTEM_PROVIDER_ID,
	isProviderType,
	providerTypeInfo,
	type ProviderType,
} from "../tts/providerTypes";
import { KEY_STORAGE_MODES, type KeyStorage } from "./secret";
import {
	DEFAULT_AFTER_SAVE,
	isAfterSaveMode,
	isExistingValueMode,
	type AfterSaveSettings,
} from "./afterSave";
import { isLinkStyle } from "../text/audioLink";
import type { AudioTarget, BatchPreset } from "../batch/types";

const DEFAULT_KEY_STORAGE: KeyStorage = "obfuscated";

/**
 * Bring persisted data up to the current schema.
 *
 * Obsidian returns the shape that the last version of the plugin wrote. That
 * version can be older than this build, and a user can edit the file by hand.
 * Everything here treats the input as untrusted and merges onto known-good
 * defaults.
 */
export function migrateSettings(raw: unknown): PluginSettings {
	const stored = isRecord(raw) ? raw : {};
	const providers = normalizeProviders(stored);

	// `azure` is read above, then dropped rather than carried through: schema 3
	// moves that block into a provider instance, and leaving the old copy in
	// place would keep a stale speech key in data.json after that provider is
	// deleted.
	const { azure: _legacyAzure, ...data } = stored;

	const settings: PluginSettings = {
		...DEFAULT_SETTINGS,
		...data,
		autoDetect: { ...DEFAULT_SETTINGS.autoDetect, ...pick(data, "autoDetect") },
		output: normalizeOutput(pick(data, "output")),
		reading: { ...DEFAULT_SETTINGS.reading, ...pick(data, "reading") },
		menu: normalizeMenu(pick(data, "menu")),
		batch: normalizeBatch(pick(data, "batch")),
		providers,
		profiles: normalizeProfiles(data.profiles, providers),
		schemaVersion: CURRENT_SCHEMA_VERSION,
	};

	// A default that points at a deleted profile disables playback in silence.
	if (
		settings.defaultProfileId &&
		!settings.profiles.some((p) => p?.id === settings.defaultProfileId)
	) {
		settings.defaultProfileId = settings.profiles[0]?.id ?? null;
	}

	return settings;
}

/**
 * The output block, with the name template checked.
 *
 * A template that is not a string reaches `resolveNameTemplates`, where it
 * would throw on `.trim()`. Everything else in the block is merged as it was.
 */
function normalizeOutput(stored: Record<string, unknown>): PluginSettings["output"] {
	return {
		...DEFAULT_SETTINGS.output,
		...stored,
		nameTemplate:
			typeof stored.nameTemplate === "string"
				? stored.nameTemplate
				: DEFAULT_SETTINGS.output.nameTemplate,
		askForMissingProperty:
			typeof stored.askForMissingProperty === "boolean"
				? stored.askForMissingProperty
				: DEFAULT_SETTINGS.output.askForMissingProperty,
		afterSave: normalizeAfterSave(pick(stored, "afterSave")),
	};
}

/**
 * The after-save block, from schema 6. A mode this build does not know falls
 * back to asking, which is the one choice that is never wrong.
 */
function normalizeAfterSave(stored: Record<string, unknown>): AfterSaveSettings {
	return {
		mode: isAfterSaveMode(stored.mode) ? stored.mode : DEFAULT_AFTER_SAVE.mode,
		property: typeof stored.property === "string" ? stored.property.trim() : "",
		existingValue: isExistingValueMode(stored.existingValue)
			? stored.existingValue
			: DEFAULT_AFTER_SAVE.existingValue,
	};
}

/**
 * Which context menu items exist, and how the linking one writes its link.
 *
 * Absent means every item, which is what a vault written before this option
 * existed gets. A link style this build does not know falls back to the
 * default rather than leaving the dropdown on nothing.
 */
function normalizeMenu(stored: Record<string, unknown>): PluginSettings["menu"] {
	const defaults = DEFAULT_SETTINGS.menu;
	const flag = (value: unknown, fallback: boolean) =>
		typeof value === "boolean" ? value : fallback;

	return {
		read: flag(stored.read, defaults.read),
		save: flag(stored.save, defaults.save),
		link: flag(stored.link, defaults.link),
		linkStyle: isLinkStyle(stored.linkStyle) ? stored.linkStyle : defaults.linkStyle,
	};
}

/**
 * The configured engines, from schema 3 or rebuilt from the single Azure block
 * of schema 2. Both paths run through the same validation, so a hand edit and an
 * upgrade are checked identically.
 */
function normalizeProviders(data: Record<string, unknown>): ProviderInstance[] {
	const stored = Array.isArray(data.providers) ? data.providers : legacyProviders(data);

	const providers: ProviderInstance[] = [];
	const seen = new Set<string>();

	for (const entry of stored) {
		const instance = toProviderInstance(entry);
		// A duplicate id would shadow the earlier entry everywhere it is looked up.
		if (!instance || seen.has(instance.id)) continue;
		seen.add(instance.id);
		providers.push(instance);
	}

	// The device voices need no credentials, so there is always exactly one.
	if (!seen.has(SYSTEM_PROVIDER_ID)) providers.unshift(systemProviderInstance());

	return providers;
}

/** Null for an entry this build cannot use. The caller drops it. */
function toProviderInstance(entry: unknown): ProviderInstance | null {
	if (!isRecord(entry)) return null;

	const { type } = entry;
	// An engine a later version added. Keeping it would offer a provider that
	// nothing can run, so it is dropped and any profile using it reports why.
	if (!isProviderType(type)) return null;

	const id = nonEmptyString(entry.id);
	if (!id) return null;

	// A singleton exists once, at its well-known id. A second copy is a hand edit.
	const info = providerTypeInfo(type);
	if (!info.instantiable && id !== SYSTEM_PROVIDER_ID) return null;

	return createProviderInstance(type, {
		id,
		name: nonEmptyString(entry.name) ?? info.displayName,
		config: normalizeConfig(type, entry.config),
		keyStorage: toKeyStorage(entry.keyStorage),
	});
}

/**
 * Schema 2 and earlier hold one Azure block and no provider list.
 *
 * The migrated ids are the old engine names, so every stored `provider` becomes
 * a `providerId` with no lookup, and a hand-edited data.json stays readable.
 *
 * An Azure instance appears only when there is something to carry over, so a
 * user who never touched Azure does not gain an empty row.
 */
function legacyProviders(data: Record<string, unknown>): unknown[] {
	const azure = pick(data, "azure");
	const key = typeof azure.key === "string" ? azure.key : "";
	const region = typeof azure.region === "string" ? azure.region : "";

	const usedByProfile =
		Array.isArray(data.profiles) &&
		data.profiles.some((p) => isRecord(p) && p.provider === LEGACY_AZURE_PROVIDER_ID);

	const providers: unknown[] = [systemProviderInstance()];
	if (key || region || usedByProfile) {
		providers.push({
			id: LEGACY_AZURE_PROVIDER_ID,
			type: "azure",
			name: providerTypeInfo("azure").displayName,
			config: { key, region },
			keyStorage: azure.keyStorage,
		});
	}
	return providers;
}

/**
 * Only the fields the type declares, each one a string.
 *
 * Dropping anything else keeps a credential from an abandoned field name out of
 * data.json, and the field table stays the only description of the shape.
 */
function normalizeConfig(type: ProviderType, raw: unknown): Record<string, string> {
	const stored = isRecord(raw) ? raw : {};
	const config: Record<string, string> = {};

	for (const field of providerTypeInfo(type).fields) {
		const value = stored[field.key];
		config[field.key] = typeof value === "string" ? value : "";
	}
	return config;
}

/**
 * Merge every stored profile onto current defaults.
 *
 * A profile written by an older version is missing any field added since, and
 * an absent numeric field propagates as NaN through the delivery maths. Merging
 * onto defaults means a new field is simply defaulted rather than undefined.
 */
function normalizeProfiles(
	raw: unknown,
	providers: ProviderInstance[],
): VoiceProfile[] {
	if (!Array.isArray(raw)) return [];

	return raw.filter(isRecord).map((stored) => {
		// Fallbacks must come from a clean default, not from the merged profile:
		// merging has already copied a bad stored value into it.
		const defaults = createProfile();
		const merged = createProfile(stored as Partial<VoiceProfile>);

		return {
			...merged,
			id: nonEmptyString(stored.id) ?? defaults.id,
			name: nonEmptyString(stored.name) ?? defaults.name,
			description:
				typeof stored.description === "string"
					? stored.description
					: defaults.description,
			providerId: toProviderId(stored, providers),
			locale: nonEmptyString(stored.locale) ?? defaults.locale,
			rate: finiteOr(stored.rate, defaults.rate),
			pitch: finiteOr(stored.pitch, defaults.pitch),
			volume: finiteOr(stored.volume, defaults.volume),
			styleDegree:
				stored.styleDegree === undefined ? undefined : finiteOr(stored.styleDegree, 1),
			nameTemplate:
				typeof stored.nameTemplate === "string" ? stored.nameTemplate : undefined,
			useForAutoDetect: stored.useForAutoDetect !== false,
		};
	});
}

/**
 * Which provider instance a profile speaks through.
 *
 * A schema 3 id is kept even when no instance has it. The user may have deleted
 * a provider they intend to add back, and rewriting the field would silently
 * replace their chosen voice with a device one. `speakPrepared` reports the
 * dangling id instead, and the settings tab marks the row.
 *
 * The schema 2 field named an engine, not an instance, so an engine this build
 * does not have has nothing to preserve and falls back to the device voices.
 */
function toProviderId(
	stored: Record<string, unknown>,
	providers: ProviderInstance[],
): string {
	const current = nonEmptyString(stored.providerId);
	if (current) return current;

	const legacy = nonEmptyString(stored.provider);
	if (legacy && providers.some((p) => p.id === legacy)) return legacy;

	return SYSTEM_PROVIDER_ID;
}

/**
 * The batch presets, each one treated as a hand edit.
 *
 * A preset without an id is dropped, because the settings tab and the public
 * API both address a preset by id, so one without an id can never be run.
 * Everything else is defaulted rather than discarded, and `validateTargets`
 * reports what is still wrong where the user can correct it.
 */
function normalizeBatch(stored: Record<string, unknown>): PluginSettings["batch"] {
	if (!Array.isArray(stored.presets)) return { presets: [] };

	const presets: BatchPreset[] = [];
	const seen = new Set<string>();

	for (const entry of stored.presets) {
		const preset = toPreset(entry);
		// A duplicate id would shadow the earlier preset wherever it is looked up.
		if (!preset || seen.has(preset.id)) continue;
		seen.add(preset.id);
		presets.push(preset);
	}
	return { presets };
}

function toPreset(entry: unknown): BatchPreset | null {
	if (!isRecord(entry)) return null;

	const id = nonEmptyString(entry.id);
	if (!id) return null;

	const filter = pick(entry, "filter");
	return createBatchPreset({
		id,
		name: nonEmptyString(entry.name) ?? "Batch",
		filter: {
			property: stringOr(filter.property),
			value: stringOr(filter.value),
		},
		targets: toTargets(entry.targets),
		// Absent means on, which is what a preset written before this option
		// existed gets. Change detection costs nothing until a field is edited.
		trackChanges: entry.trackChanges !== false,
	});
}

function toTargets(raw: unknown): AudioTarget[] {
	if (!Array.isArray(raw)) return [];

	return raw.filter(isRecord).map((stored) => {
		const target = createAudioTarget({
			textField: stringOr(stored.textField),
			audioField: stringOr(stored.audioField),
			prefix: stringOr(stored.prefix),
			nameFrom: optionalString(stored.nameFrom),
			profileId: optionalString(stored.profileId),
			hashField: optionalString(stored.hashField),
		});
		// Generated rather than required: a target is addressed only inside its
		// own preset, so a hand-written entry without an id still works.
		return { ...target, id: nonEmptyString(stored.id) ?? target.id };
	});
}

function toKeyStorage(value: unknown): KeyStorage {
	return KEY_STORAGE_MODES.includes(value as KeyStorage)
		? (value as KeyStorage)
		: DEFAULT_KEY_STORAGE;
}

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/** Undefined rather than empty, so an absent field stays absent on disk. */
function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(data: Record<string, unknown>, key: string): Record<string, unknown> {
	const nested = data[key];
	return isRecord(nested) ? nested : {};
}
