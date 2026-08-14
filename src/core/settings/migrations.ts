import {
	CURRENT_SCHEMA_VERSION,
	DEFAULT_SETTINGS,
	PROVIDER_IDS,
	createProfile,
	type PluginSettings,
	type ProviderId,
	type VoiceProfile,
} from "./types";
import { KEY_STORAGE_MODES, type KeyStorage } from "./secret";

/**
 * Bring persisted data up to the current schema.
 *
 * Obsidian returns the shape that the last version of the plugin wrote. That
 * version can be older than this build, and a user can edit the file by hand.
 * Everything here treats the input as untrusted and merges onto known-good
 * defaults.
 */
export function migrateSettings(raw: unknown): PluginSettings {
	const data = isRecord(raw) ? raw : {};

	const settings: PluginSettings = {
		...DEFAULT_SETTINGS,
		...data,
		azure: normalizeAzure(pick(data, "azure")),
		autoDetect: { ...DEFAULT_SETTINGS.autoDetect, ...pick(data, "autoDetect") },
		output: { ...DEFAULT_SETTINGS.output, ...pick(data, "output") },
		reading: { ...DEFAULT_SETTINGS.reading, ...pick(data, "reading") },
		profiles: normalizeProfiles(data.profiles),
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
 * Merge every stored profile onto current defaults.
 *
 * A profile written by an older version is missing any field added since, and
 * an absent numeric field propagates as NaN through the delivery maths. Merging
 * onto defaults means a new field is simply defaulted rather than undefined.
 */
function normalizeProfiles(raw: unknown): VoiceProfile[] {
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
			provider: toProviderId(stored.provider),
			locale: nonEmptyString(stored.locale) ?? defaults.locale,
			rate: finiteOr(stored.rate, defaults.rate),
			pitch: finiteOr(stored.pitch, defaults.pitch),
			volume: finiteOr(stored.volume, defaults.volume),
			styleDegree:
				stored.styleDegree === undefined ? undefined : finiteOr(stored.styleDegree, 1),
			useForAutoDetect: stored.useForAutoDetect !== false,
		};
	});
}

/**
 * Keep the Azure block, and make `keyStorage` a value the decoder knows.
 *
 * Schema 1 has no `keyStorage`, and its key is unprefixed plain text. Taking the
 * default here is safe, because `decodeKey` reads the prefix of the stored value
 * and never trusts this field. The field only decides the next write.
 */
function normalizeAzure(stored: Record<string, unknown>): PluginSettings["azure"] {
	const merged = { ...DEFAULT_SETTINGS.azure, ...stored };
	return {
		...merged,
		key: typeof merged.key === "string" ? merged.key : "",
		region: typeof merged.region === "string" ? merged.region : "",
		keyStorage: KEY_STORAGE_MODES.includes(merged.keyStorage as KeyStorage)
			? (merged.keyStorage as KeyStorage)
			: DEFAULT_SETTINGS.azure.keyStorage,
	};
}

/** An unknown engine falls back to the one that needs no configuration. */
function toProviderId(value: unknown): ProviderId {
	return PROVIDER_IDS.includes(value as ProviderId) ? (value as ProviderId) : "system";
}

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
