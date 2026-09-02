import type { KeyStorage } from "./secret";
import { DEFAULT_AFTER_SAVE, type AfterSaveSettings } from "./afterSave";
import type { LinkStyle } from "../text/audioLink";
import type { AudioTarget, BatchPreset } from "../batch/types";
import {
	SYSTEM_PROVIDER_ID,
	providerTypeInfo,
	type ProviderType,
} from "../tts/providerTypes";

/**
 * One configured speech engine.
 *
 * The type is which engine it is. The instance is one account of that engine,
 * so two Azure resources in different regions are two instances of one type.
 *
 * `id` is the only thing a profile stores. Names and credentials are free to
 * change without breaking that reference.
 */
export interface ProviderInstance {
	id: string;
	/** Fixed at creation. Changing it would invalidate every stored credential. */
	type: ProviderType;
	name: string;
	/**
	 * Keyed by `ProviderField.key`. Every credential is a string, so the field
	 * table in `tts/providerTypes.ts` stays the only description of the shape.
	 *
	 * A secret field holds plain text while the plugin runs, whatever the storage
	 * mode is. It is empty when an encrypted value has not been unlocked yet.
	 * Only the composition root converts between this and the form on disk.
	 */
	config: Record<string, string>;
	/** How this instance's secret fields are written to data.json. See `secret.ts`. */
	keyStorage: KeyStorage;
}

/**
 * A saved, named voice configuration.
 *
 * `id` is a generated UUID and is the only thing anything else stores a reference to.
 * Names, locales and voices are all free to change without breaking those references.
 */
export interface VoiceProfile {
	id: string;
	name: string;
	description: string;
	/** A `ProviderInstance.id`, not an engine name. */
	providerId: string;
	/** BCP-47, for example "fr-FR". */
	locale: string;
	/** Azure: the voice ShortName. System: the SpeechSynthesisVoice.voiceURI. */
	voiceId: string;
	/** Playback rate multiplier. 1 is the voice's natural speed. */
	rate: number;
	/** Pitch shift in percent, -50 to +50. 0 is the voice's natural pitch. */
	pitch: number;
	/** 0-100. */
	volume: number;

	// These stay assignable to `undefined` rather than merely absent: the editor
	// clears a field by writing undefined when the voice no longer supports it.
	/** Azure only, and only when the chosen voice advertises the style. */
	style?: string | undefined;
	/** Azure only. 0.01-2, how strongly `style` is applied. */
	styleDegree?: number | undefined;
	/** Azure only, and only when the chosen voice advertises the role. */
	role?: string | undefined;
	/** Azure only. Key into AUDIO_FORMATS. */
	audioFormat?: string | undefined;

	/** Vault-relative folder override. Empty/undefined means inherit the global default. */
	outputFolder?: string | undefined;
	/** File name template override. Empty/undefined means inherit the global one. */
	nameTemplate?: string | undefined;
	/** Whether language auto-detection is allowed to select this profile. */
	useForAutoDetect: boolean;
}

export interface PluginSettings {
	schemaVersion: number;
	/** Ordered. The system instance is always present and cannot be removed. */
	providers: ProviderInstance[];
	/** Ordered. Order is the tie-break priority for auto-detection. */
	profiles: VoiceProfile[];
	defaultProfileId: string | null;
	autoDetect: {
		enabled: boolean;
		/** Below this many characters, do not guess. Use the default profile. */
		minChars: number;
	};
	output: {
		/** Vault-relative. Empty means the vault root. */
		defaultFolder: string;
		/** A profile with no format of its own writes this one. Empty means the provider decides. */
		defaultFormat: string;
		insertPlayerAtCursor: boolean;
		/** Obsidian template syntax. Empty means the built-in name. */
		nameTemplate: string;
		/** Ask for a property the note lacks, instead of taking the note name. */
		askForMissingProperty: boolean;
		/** How a saved clip is linked to the note it was read from. */
		afterSave: AfterSaveSettings;
	};
	/** Which actions the editor context menu offers, and how the third one links. */
	menu: {
		read: boolean;
		save: boolean;
		link: boolean;
		linkStyle: LinkStyle;
	};
	reading: {
		readBeforeOrAfter: "off" | "before" | "after";
	};
	/** Named batch configurations. Ordered, and each one selects its own notes. */
	batch: {
		presets: BatchPreset[];
	};
	stripMarkdown: boolean;
	/** Optional user regex. Each match becomes a space before synthesis. */
	textFilterRegex: string;
}

export const CURRENT_SCHEMA_VERSION = 6;

/** The device voices, which need no credentials and are always available. */
export function systemProviderInstance(): ProviderInstance {
	return {
		id: SYSTEM_PROVIDER_ID,
		type: "system",
		name: providerTypeInfo("system").displayName,
		config: {},
		keyStorage: "obfuscated",
	};
}

export const DEFAULT_SETTINGS: PluginSettings = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	providers: [systemProviderInstance()],
	profiles: [],
	defaultProfileId: null,
	autoDetect: {
		enabled: false,
		minChars: 30,
	},
	output: {
		defaultFolder: "Audio",
		defaultFormat: "",
		insertPlayerAtCursor: false,
		nameTemplate: "",
		askForMissingProperty: false,
		afterSave: DEFAULT_AFTER_SAVE,
	},
	menu: {
		read: true,
		save: true,
		link: true,
		linkStyle: "wikilink",
	},
	reading: {
		readBeforeOrAfter: "off",
	},
	batch: {
		presets: [],
	},
	stripMarkdown: true,
	textFilterRegex: "",
};

/**
 * Field defaults shared by every newly created profile.
 *
 * `newId` is injected the same way the clock is in `paths.ts` and `time.ts`, so
 * a test can produce stable identifiers.
 */
export function createProfile(
	partial: Partial<VoiceProfile> = {},
	newId: () => string = () => crypto.randomUUID(),
): VoiceProfile {
	return {
		id: newId(),
		name: "New profile",
		description: "",
		providerId: SYSTEM_PROVIDER_ID,
		locale: "en-US",
		voiceId: "",
		rate: 1,
		pitch: 0,
		volume: 100,
		useForAutoDetect: true,
		...partial,
	};
}

/** A new, empty instance of one engine. Its type is fixed from here on. */
export function createProviderInstance(
	type: ProviderType,
	partial: Partial<Omit<ProviderInstance, "type">> = {},
	newId: () => string = () => crypto.randomUUID(),
): ProviderInstance {
	return {
		id: newId(),
		type,
		name: providerTypeInfo(type).displayName,
		config: {},
		keyStorage: "obfuscated",
		...partial,
	};
}

/**
 * A new, empty batch preset.
 *
 * `newId` is injected the same way it is for a profile, so a test produces a
 * stable identifier. `type` is the property most decks filter on, so it is the
 * starting value rather than an empty field the user must guess at.
 */
export function createBatchPreset(
	partial: Partial<BatchPreset> = {},
	newId: () => string = () => crypto.randomUUID(),
): BatchPreset {
	return {
		id: newId(),
		name: "New batch",
		filter: { property: "type", value: "" },
		targets: [],
		trackChanges: true,
		...partial,
	};
}

/** A new, empty target inside a preset. */
export function createAudioTarget(
	partial: Partial<AudioTarget> = {},
	newId: () => string = () => crypto.randomUUID(),
): AudioTarget {
	return {
		id: newId(),
		textField: "",
		audioField: "",
		prefix: "",
		...partial,
	};
}

/**
 * One config value, defaulted to empty.
 *
 * `noUncheckedIndexedAccess` types every lookup as possibly undefined, which is
 * the honest type for data that came off disk. Every caller wants the same
 * fallback, so it lives here rather than at each call site.
 */
export function configValue(config: Record<string, string>, key: string): string {
	return config[key] ?? "";
}

export function findProviderInstance(
	settings: PluginSettings,
	id: string,
): ProviderInstance | null {
	return settings.providers.find((p) => p.id === id) ?? null;
}

/** The instance name to show, falling back to the engine name for a missing one. */
export function providerLabel(settings: PluginSettings, id: string): string {
	return findProviderInstance(settings, id)?.name ?? id;
}

/**
 * A name not already taken, so two Azure resources are told apart in the list.
 *
 * Names are cosmetic and ids are what anything stores, so this is a courtesy at
 * creation rather than a rule. Nothing stops the user renaming both to the same
 * thing afterwards.
 */
export function uniqueProviderName(settings: PluginSettings, base: string): string {
	const taken = new Set(settings.providers.map((p) => p.name));
	if (!taken.has(base)) return base;

	for (let suffix = 2; suffix <= taken.size + 1; suffix++) {
		const candidate = `${base} ${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
	return base;
}

function findProfile(settings: PluginSettings, id: string | null): VoiceProfile | null {
	if (!id) return null;
	return settings.profiles.find((p) => p.id === id) ?? null;
}

/**
 * The audio format a profile writes: its own choice when set, otherwise the
 * global default. Undefined leaves the choice to the provider, which is what
 * an empty global default means.
 *
 * The sibling of `resolveOutputFolder` in `paths.ts`, and it applies at the
 * same point: saving to a file. Playback sounds the same in every format.
 */
export function resolveAudioFormat(
	profile: Pick<VoiceProfile, "audioFormat">,
	settings: Pick<PluginSettings, "output">,
): string | undefined {
	return profile.audioFormat || settings.output.defaultFormat || undefined;
}

/**
 * The profile to use when nothing more specific applies: the configured default,
 * or the first profile if that default has been deleted.
 */
export function resolveDefaultProfile(settings: PluginSettings): VoiceProfile | null {
	return (
		findProfile(settings, settings.defaultProfileId) ?? settings.profiles[0] ?? null
	);
}
