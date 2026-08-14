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
} from "../../core/tts/types";
import type { VoiceProfile } from "../../core/settings/types";
import {
	fetchVoiceCatalog,
	isCatalogFresh,
	summarizeCatalog,
	type CatalogCacheInfo,
	type CatalogStore,
	type Fetcher,
} from "./voiceCatalog";
import { getAudioFormat } from "./formats";
import { buildSsml } from "./ssml";
import { TtsError } from "../../core/errors";

export interface AzureCredentials {
	key: string;
	region: string;
}

/**
 * Azure Speech.
 *
 * A `null` audio config makes the SDK render to an ArrayBuffer that we own.
 * The SDK then writes nothing to disk and plays nothing. As a result,
 * AudioPlayer controls playback with public DOM APIs, and the save path
 * writes through the Obsidian vault.
 */
export class AzureProvider implements RenderingProvider {
	readonly kind = "rendering" as const;
	readonly id = "azure" as const;
	readonly displayName = "Azure Speech";

	/** Comfortably under the service's ten-minute-per-request audio cap. */
	readonly maxChunkChars = 2000;

	private voices: VoiceInfo[] = [];
	private inflight: Promise<VoiceInfo[]> | null = null;
	private meta: CatalogCacheInfo | null = null;

	constructor(
		private readonly getCredentials: () => AzureCredentials,
		private readonly store: CatalogStore,
		private readonly fetcher: Fetcher,
	) {}

	isConfigured(): boolean {
		const { key, region } = this.getCredentials();
		return Boolean(key?.trim() && region?.trim());
	}

	async listVoices(): Promise<VoiceInfo[]> {
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
		const { key, region } = this.getCredentials();
		const voices = await fetchVoiceCatalog(region, key, this.fetcher);
		this.voices = voices;

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

	/** Catalog entry for a voice id, or null when the catalog is not loaded. */
	findVoice(voiceId: string): VoiceInfo | null {
		return this.voices.find((v) => v.id === voiceId) ?? null;
	}

	outputFormat(profile: VoiceProfile): OutputFormatInfo {
		const { extension, mimeType, concat } = getAudioFormat(profile.audioFormat);
		return { extension, mimeType, concat };
	}

	async render(req: SynthesisRequest, signal: AbortSignal): Promise<RenderedAudio> {
		const { key, region } = this.getCredentials();
		if (!key?.trim() || !region?.trim()) {
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
		const { region } = this.getCredentials();

		const cached = await this.store.read().catch(() => null);
		// Captured before the freshness check, whose type predicate narrows
		// `cached` away on the negative branch.
		const staleVoices = cached?.voices ?? [];
		const staleMeta = cached ? summarizeCatalog(cached) : null;

		if (isCatalogFresh(cached, region)) {
			this.voices = cached.voices;
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
			this.voices = staleVoices;
			this.meta = staleMeta;
			return this.voices;
		}

		try {
			return await this.refreshVoices();
		} catch (err) {
			// A short network failure must not empty a voice list that we have.
			if (staleVoices.length > 0) {
				this.voices = staleVoices;
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
		return new TtsError("unknown", "Speech synthesis did not complete");
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
