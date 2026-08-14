import type { ProviderId, VoiceProfile } from "../settings/types";

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

interface ProviderBase {
	readonly id: ProviderId;
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
