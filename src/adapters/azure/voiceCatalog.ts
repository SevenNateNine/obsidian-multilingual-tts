import type { VoiceInfo } from "../../core/tts/types";
import { TtsError, kindFromHttpStatus } from "../../core/errors";

/** One entry as returned by the `voices/list` endpoint. */
export interface AzureVoiceRaw {
	Name?: string;
	DisplayName?: string;
	LocalName?: string;
	ShortName?: string;
	Gender?: string;
	Locale?: string;
	LocaleName?: string;
	StyleList?: string[];
	RolePlayList?: string[];
	SecondaryLocaleList?: string[];
	VoiceType?: string;
	Status?: string;
	WordsPerMinute?: string;
}

export interface CachedCatalog {
	fetchedAt: number;
	region: string;
	voices: VoiceInfo[];
}

/** Somewhere to persist the catalog between sessions. */
export interface CatalogStore {
	read(): Promise<CachedCatalog | null>;
	write(catalog: CachedCatalog): Promise<void>;
}

/** What the settings tab shows about the cached catalog. */
export interface CatalogCacheInfo {
	fetchedAt: number;
	region: string;
	voiceCount: number;
	localeCount: number;
}

export function summarizeCatalog(catalog: CachedCatalog): CatalogCacheInfo {
	const voices = Array.isArray(catalog.voices) ? catalog.voices : [];
	return {
		fetchedAt: catalog.fetchedAt,
		region: catalog.region,
		voiceCount: voices.length,
		localeCount: new Set(voices.map((v) => v.locale)).size,
	};
}

/** Minimal HTTP surface, injected so the catalog logic stays testable. */
export interface HttpResponse {
	status: number;
	json: unknown;
	text: string;
}
export type Fetcher = (
	url: string,
	headers: Record<string, string>,
) => Promise<HttpResponse>;

export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function voiceListUrl(region: string): string {
	return `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
}

/**
 * Convert the service's shape into ours.
 *
 * `StyleList` and `RolePlayList` are the reason to fetch this list instead of
 * a hardcoded voice table. They let the profile editor offer only the styles
 * that a voice supports.
 */
export function toVoiceInfo(raw: AzureVoiceRaw): VoiceInfo | null {
	if (!raw || typeof raw !== "object") return null;

	const id = raw.ShortName?.trim();
	const locale = raw.Locale?.trim();
	if (!id || !locale) return null;

	return {
		id,
		displayName: raw.LocalName?.trim() || raw.DisplayName?.trim() || id,
		locale,
		gender: normalizeGender(raw.Gender),
		styles: dedupe(raw.StyleList),
		roles: dedupe(raw.RolePlayList),
	};
}

export function parseVoiceList(payload: unknown): VoiceInfo[] {
	if (!Array.isArray(payload)) {
		throw new TtsError("invalid-request", "Unexpected voice list response");
	}
	return payload
		.map((entry) => toVoiceInfo(entry as AzureVoiceRaw))
		.filter((v): v is VoiceInfo => v !== null)
		.sort(
			(a, b) =>
				a.locale.localeCompare(b.locale) || a.displayName.localeCompare(b.displayName),
		);
}

export function isCatalogFresh(
	catalog: CachedCatalog | null,
	region: string,
	now = Date.now(),
): catalog is CachedCatalog {
	if (!catalog || catalog.region !== region) return false;
	if (!Array.isArray(catalog.voices) || catalog.voices.length === 0) return false;
	return now - catalog.fetchedAt < CATALOG_TTL_MS;
}

export async function fetchVoiceCatalog(
	region: string,
	key: string,
	fetcher: Fetcher,
): Promise<VoiceInfo[]> {
	if (!region || !key) {
		throw new TtsError("not-configured", "Speech key and region are required");
	}

	let response: HttpResponse;
	try {
		response = await fetcher(voiceListUrl(region), {
			"Ocp-Apim-Subscription-Key": key,
		});
	} catch (err) {
		throw new TtsError(
			"network",
			"Could not reach the speech service",
			err instanceof Error ? err.message : String(err),
		);
	}

	if (response.status !== 200) {
		throw new TtsError(
			kindFromHttpStatus(response.status),
			"Could not load the voice list",
			`HTTP ${response.status}`,
		);
	}

	const voices = parseVoiceList(response.json);
	if (voices.length === 0) {
		throw new TtsError("no-voice", "The service returned no voices");
	}
	return voices;
}

function normalizeGender(value: string | undefined): VoiceInfo["gender"] {
	switch (value?.toLowerCase()) {
		case "female":
			return "Female";
		case "male":
			return "Male";
		case "neutral":
			return "Neutral";
		default:
			return undefined;
	}
}

function dedupe(values: string[] | undefined): string[] {
	if (!Array.isArray(values)) return [];
	return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v))];
}
