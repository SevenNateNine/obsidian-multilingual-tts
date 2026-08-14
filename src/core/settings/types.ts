import type { KeyStorage } from "./secret";

/**
 * Every speech engine the plugin knows. The union derives from this array, so a
 * new engine is one edit here and one in the composition root.
 */
export const PROVIDER_IDS = ["azure", "system"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

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
	provider: ProviderId;
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
	/** Whether language auto-detection is allowed to select this profile. */
	useForAutoDetect: boolean;
}

export interface PluginSettings {
	schemaVersion: number;
	/** Ordered. Order is the tie-break priority for auto-detection. */
	profiles: VoiceProfile[];
	defaultProfileId: string | null;
	azure: {
		/**
		 * Plain text while the plugin runs, whatever the storage mode is. It is
		 * empty when an encrypted key has not been unlocked yet. Only the
		 * composition root converts between this and the form on disk.
		 */
		key: string;
		region: string;
		/** How `key` is written to data.json. See `secret.ts`. */
		keyStorage: KeyStorage;
	};
	autoDetect: {
		enabled: boolean;
		/** Below this many characters, do not guess. Use the default profile. */
		minChars: number;
	};
	output: {
		/** Vault-relative. Empty means the vault root. */
		defaultFolder: string;
		insertPlayerAtCursor: boolean;
	};
	reading: {
		readBeforeOrAfter: "off" | "before" | "after";
	};
	stripMarkdown: boolean;
	/** Optional user regex. Each match becomes a space before synthesis. */
	textFilterRegex: string;
}

export const CURRENT_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: PluginSettings = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	profiles: [],
	defaultProfileId: null,
	azure: {
		key: "",
		region: "",
		keyStorage: "obfuscated",
	},
	autoDetect: {
		enabled: false,
		minChars: 30,
	},
	output: {
		defaultFolder: "Audio",
		insertPlayerAtCursor: false,
	},
	reading: {
		readBeforeOrAfter: "off",
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
		provider: "system",
		locale: "en-US",
		voiceId: "",
		rate: 1,
		pitch: 0,
		volume: 100,
		useForAutoDetect: true,
		...partial,
	};
}

function findProfile(settings: PluginSettings, id: string | null): VoiceProfile | null {
	if (!id) return null;
	return settings.profiles.find((p) => p.id === id) ?? null;
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
