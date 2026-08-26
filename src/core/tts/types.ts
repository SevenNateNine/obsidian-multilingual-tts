import type { VoiceProfile } from "../settings/types";
import type { ProviderType } from "./providerTypes";

export interface VoiceInfo {
	/** Stable identifier stored in VoiceProfile.voiceId. */
	id: string;
	displayName: string;
	/** BCP-47. */
	locale: string;
	gender?: "Female" | "Male" | "Neutral" | undefined;
	/**
	 * Speaking styles this specific voice supports. Empty for most voices —
	 * the profile editor and the SSML builder both key off this, so an
	 * unsupported style can never reach the service.
	 */
	styles: string[];
	/** Role-play personas this specific voice supports. Usually empty. */
	roles: string[];
}

export interface SynthesisRequest {
	/** Already stripped, filtered, and chunked. Providers escape it as needed. */
	text: string;
	profile: VoiceProfile;
}

/**
 * How several rendered chunks can be joined into one file. Declared here rather
 * than alongside the Azure formats so the save path stays provider-agnostic.
 */
export type ConcatStrategy = "mp3" | "riff" | "none";

export interface OutputFormatInfo {
	/** File extension without the dot, derived from the real container format. */
	extension: string;
	mimeType: string;
	concat: ConcatStrategy;
}

export interface RenderedAudio extends OutputFormatInfo {
	data: ArrayBuffer;
}

/**
 * What the settings tab says about a provider's voice list.
 *
 * The provider writes the sentence because only it knows what makes its list
 * stale: Azure caches per region and expires after a week, and the device list
 * changes when a voice is installed. `displayName` is a provider-authored string
 * for the same reason.
 */
export interface VoiceListStatus {
	text: string;
	/** True when the user must act, for example after a region change. */
	warning: boolean;
	/** Shown on hover, where `text` had to shorten something. */
	tooltip?: string | undefined;
}

interface ProviderBase {
	/** The `ProviderInstance.id` this provider was built for, not an engine name. */
	readonly id: string;
	readonly type: ProviderType;
	readonly displayName: string;
	/**
	 * Largest text slice this provider handles reliably in one request.
	 * Azure caps a request at ten minutes of audio. The Chromium speech engine
	 * stops after a much shorter utterance.
	 */
	readonly maxChunkChars: number;
	/** False when required credentials are missing. The UI explains what is necessary. */
	isConfigured(): boolean;
	listVoices(): Promise<VoiceInfo[]>;
	/** Ignore any cache and load the list again. Backs the Refresh buttons. */
	refreshVoices(): Promise<VoiceInfo[]>;
	/** Null when there is nothing worth saying about the list. */
	voiceListStatus(): Promise<VoiceListStatus | null>;
}

/**
 * A provider that returns audio data we own, so it can be saved to a file and
 * played through our own HTMLAudioElement.
 */
export interface RenderingProvider extends ProviderBase {
	readonly kind: "rendering";
	render(req: SynthesisRequest, signal: AbortSignal): Promise<RenderedAudio>;
	/**
	 * What a save with this profile will produce. Known before any request is
	 * made, so an impossible combination fails immediately rather than after
	 * the user has paid for the synthesis.
	 */
	outputFormat(profile: VoiceProfile): OutputFormatInfo;
	/**
	 * The formats this provider can write, by `VoiceProfile.audioFormat` key.
	 * Declared here so the profile editor offers them without naming an engine.
	 */
	audioFormatOptions(): Record<string, string>;
}

/**
 * A provider that speaks directly through the platform and never exposes audio
 * data. Cannot save to a file, so the UI hides Save for these.
 */
export interface SpeakingProvider extends ProviderBase {
	readonly kind: "speaking";
	speak(req: SynthesisRequest, signal: AbortSignal): Promise<void>;
	pause(): void;
	resume(): void;
	cancel(): void;
}

export type TtsProvider = RenderingProvider | SpeakingProvider;
