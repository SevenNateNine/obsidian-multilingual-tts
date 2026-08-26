import {
	CancellationDetails,
	CancellationErrorCode,
	ResultReason,
	SpeechConfig,
	SpeechSynthesizer,
	type SpeechSynthesisResult,
} from "microsoft-cognitiveservices-speech-sdk";
import type {
	OutputFormatInfo,
	RenderedAudio,
	RenderingProvider,
	SynthesisRequest,
	VoiceInfo,
	VoiceListStatus,
} from "../../core/tts/types";
import { configValue, type VoiceProfile } from "../../core/settings/types";
import {
	fetchVoiceCatalog,
	isCatalogFresh,
	summarizeCatalog,
	type CatalogCacheInfo,
	type CatalogStore,
	type Fetcher,
} from "./voiceCatalog";
import { audioFormatOptions, getAudioFormat } from "./formats";
import { buildSsml } from "./ssml";
import { TtsError } from "../../core/errors";
import { formatAbsoluteTime, formatRelativeTime } from "../../core/time";

export interface AzureCredentials {
	key: string;
	region: string;
}

/**
 * Azure Speech.
 *
 * One instance per configured resource, so two subscriptions in two regions
 * each keep their own voice list. `id` is the provider instance the settings
 * hold, not the name of the engine.
 *
 * A `null` audio config makes the SDK render to an ArrayBuffer that we own.
 * The SDK then writes nothing to disk and plays nothing. As a result,
 * AudioPlayer controls playback with public DOM APIs, and the save path
 * writes through the Obsidian vault.
 */
export class AzureProvider implements RenderingProvider {
	readonly kind = "rendering" as const;
	readonly type = "azure" as const;
	readonly displayName = "Azure Speech";

	/** Comfortably under the service's ten-minute-per-request audio cap. */
	readonly maxChunkChars = 2000;

	private voices: VoiceInfo[] = [];
	private inflight: Promise<VoiceInfo[]> | null = null;
	private meta: CatalogCacheInfo | null = null;
	/** The region `voices` was loaded for. See `discardStaleVoices`. */
	private loadedRegion: string | null = null;

	constructor(
		readonly id: string,
		private readonly getConfig: () => Record<string, string>,
		private readonly store: CatalogStore,
		private readonly fetcher: Fetcher,
	) {}

	private credentials(): AzureCredentials {
		const config = this.getConfig();
		return {
			key: configValue(config, "key"),
			region: configValue(config, "region"),
		};
	}

	isConfigured(): boolean {
		const { key, region } = this.credentials();
		return Boolean(key.trim() && region.trim());
	}

	async listVoices(): Promise<VoiceInfo[]> {
		this.discardStaleVoices();
		if (this.voices.length > 0) return this.voices;
		if (this.inflight) return this.inflight;

		this.inflight = this.loadVoices().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	/** Ignore the cache and re-fetch. Backs the "Refresh voice list" button. */
	async refreshVoices(): Promise<VoiceInfo[]> {
		this.voices = [];
		const { key, region } = this.credentials();
		const voices = await fetchVoiceCatalog(region, key, this.fetcher);
		this.accept(voices, region);

		const catalog = { fetchedAt: Date.now(), region, voices };
		await this.store.write(catalog);
		this.meta = summarizeCatalog(catalog);

		return voices;
	}

	/**
	 * What is cached right now, for display in settings. Returns the in-memory
	 * summary when there is one, so the tab reflects a refresh immediately
	 * without re-reading and re-parsing the cache file.
	 */
	async cacheInfo(): Promise<CatalogCacheInfo | null> {
		if (this.meta) return this.meta;

		const cached = await this.store.read().catch(() => null);
		if (!cached) return null;

		this.meta = summarizeCatalog(cached);
		return this.meta;
	}

	/**
	 * The catalog is what makes per-voice style and role gating work, and it
	 * expires after a week, so its age is worth surfacing at all times rather
	 * than only after a refresh.
	 */
	async voiceListStatus(): Promise<VoiceListStatus> {
		this.discardStaleVoices();
		const { region } = this.credentials();
		const info = await this.cacheInfo().catch(() => null);

		if (!info || info.voiceCount === 0) {
			return {
				text: this.isConfigured()
					? "No voice list cached yet. Press Refresh to load voices."
					: "No voice list cached. Add a speech key and region.",
				warning: false,
			};
		}

		// isCatalogFresh rejects a catalog from another region, so a region change
		// silently invalidates the cache. Say so instead of showing stale counts.
		const current = region.trim();
		if (current && info.region && info.region !== current) {
			return {
				text: `Cached for ${info.region}. The current region is ${current}. Press Refresh.`,
				warning: true,
			};
		}

		return {
			text:
				`${info.voiceCount} voices across ${info.localeCount} languages` +
				` · updated ${formatRelativeTime(info.fetchedAt)}`,
			warning: false,
			tooltip: formatAbsoluteTime(info.fetchedAt),
		};
	}

	/** Catalog entry for a voice id, or null when the catalog is not loaded. */
	findVoice(voiceId: string): VoiceInfo | null {
		return this.voices.find((v) => v.id === voiceId) ?? null;
	}

	audioFormatOptions(): Record<string, string> {
		return audioFormatOptions();
	}

	outputFormat(profile: VoiceProfile): OutputFormatInfo {
		const { extension, mimeType, concat } = getAudioFormat(profile.audioFormat);
		return { extension, mimeType, concat };
	}

	async render(req: SynthesisRequest, signal: AbortSignal): Promise<RenderedAudio> {
		const { key, region } = this.credentials();
		if (!key.trim() || !region.trim()) {
			throw new TtsError(
				"not-configured",
				"Azure is not configured",
				"Add a speech key and region in settings",
			);
		}
		if (!req.profile.voiceId) {
			throw new TtsError("no-voice", "This profile has no voice selected");
		}
		if (signal.aborted) throw new TtsError("cancelled", "aborted");

		// Best effort: capability gating needs the catalog, but a failed lookup
		// must not block synthesis. buildSsml simply omits style/role when null.
		const voice =
			this.findVoice(req.profile.voiceId) ??
			(await this.tryLoadVoice(req.profile.voiceId));
		const format = getAudioFormat(req.profile.audioFormat);
		const ssml = buildSsml({ text: req.text, profile: req.profile, voice });

		const speechConfig = SpeechConfig.fromSubscription(key, region);
		speechConfig.speechSynthesisOutputFormat = format.sdk;
		const synthesizer = new SpeechSynthesizer(speechConfig, null);

		try {
			const result = await this.speak(synthesizer, ssml, signal);
			return {
				data: result.audioData,
				mimeType: format.mimeType,
				extension: format.extension,
				concat: format.concat,
			};
		} finally {
			synthesizer.close();
			speechConfig.close();
		}
	}

	/**
	 * Forget a voice list that belongs to a region the user has since changed.
	 *
	 * Without this the editor keeps offering the old region's voices until
	 * Obsidian restarts, because the in-memory list is only ever filled, never
	 * cleared.
	 */
	private discardStaleVoices(): void {
		const { region } = this.credentials();
		if (this.loadedRegion === null || this.loadedRegion === region) return;

		this.voices = [];
		this.meta = null;
		this.loadedRegion = null;
	}

	private accept(voices: VoiceInfo[], region: string): void {
		this.voices = voices;
		this.loadedRegion = region;
	}

	private speak(
		synthesizer: SpeechSynthesizer,
		ssml: string,
		signal: AbortSignal,
	): Promise<SpeechSynthesisResult> {
		return new Promise<SpeechSynthesisResult>((resolve, reject) => {
			let settled = false;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				fn();
			};

			const onAbort = () => finish(() => reject(new TtsError("cancelled", "aborted")));
			signal.addEventListener("abort", onAbort, { once: true });

			synthesizer.speakSsmlAsync(
				ssml,
				(result) => {
					if (result.reason === ResultReason.SynthesizingAudioCompleted) {
						finish(() => resolve(result));
					} else {
						finish(() => reject(describeFailure(result)));
					}
				},
				(error) => {
					finish(() =>
						reject(new TtsError("network", "Speech synthesis failed", String(error))),
					);
				},
			);
		});
	}

	private async loadVoices(): Promise<VoiceInfo[]> {
		const { region } = this.credentials();

		const cached = await this.store.read().catch(() => null);
		// Captured before the freshness check, whose type predicate narrows
		// `cached` away on the negative branch.
		const staleVoices = cached?.voices ?? [];
		const staleMeta = cached ? summarizeCatalog(cached) : null;

		if (isCatalogFresh(cached, region)) {
			this.accept(cached.voices, region);
			this.meta = summarizeCatalog(cached);
			return this.voices;
		}

		if (!this.isConfigured()) {
			// A stale cache still beats nothing when credentials are missing.
			if (staleVoices.length === 0) {
				throw new TtsError(
					"not-configured",
					"Add an Azure speech key and region to load voices",
				);
			}
			this.accept(staleVoices, region);
			this.meta = staleMeta;
			return this.voices;
		}

		try {
			return await this.refreshVoices();
		} catch (err) {
			// A short network failure must not empty a voice list that we have.
			if (staleVoices.length > 0) {
				this.accept(staleVoices, region);
				this.meta = staleMeta;
				return this.voices;
			}
			throw err;
		}
	}

	private async tryLoadVoice(voiceId: string): Promise<VoiceInfo | null> {
		try {
			await this.listVoices();
		} catch {
			return null;
		}
		return this.findVoice(voiceId);
	}
}

/** Turn a cancelled result into a specific, actionable error. */
function describeFailure(result: SpeechSynthesisResult): TtsError {
	if (result.reason !== ResultReason.Canceled) {
		return new TtsError(
			"unknown",
			"Speech synthesis did not complete",
			`result reason: ${ResultReason[result.reason] ?? String(result.reason)}`,
		);
	}

	const details = CancellationDetails.fromResult(result);
	const detail = details.errorDetails || undefined;

	// Note the capital E: the SDK spells this differently from its siblings.
	switch (details.ErrorCode) {
		case CancellationErrorCode.AuthenticationFailure:
			return new TtsError("auth", "Azure rejected the credentials", detail);
		case CancellationErrorCode.Forbidden:
			return new TtsError("auth", "Azure refused the request", detail);
		case CancellationErrorCode.TooManyRequests:
			return new TtsError("quota", "Azure rate limit exceeded", detail);
		case CancellationErrorCode.BadRequestParameters:
			return new TtsError("invalid-request", "Azure rejected the request", detail);
		case CancellationErrorCode.ConnectionFailure:
		case CancellationErrorCode.ServiceTimeout:
		case CancellationErrorCode.ServiceError:
			return new TtsError("network", "Could not reach the speech service", detail);
		default:
			return new TtsError("unknown", "Speech synthesis failed", detail);
	}
}
