import { SpeechSynthesisOutputFormat } from "microsoft-cognitiveservices-speech-sdk";
import type { ConcatStrategy } from "../../core/tts/types";

export interface AudioFormatSpec {
	/** Our own stable key. Stored in VoiceProfile.audioFormat. */
	id: string;
	label: string;
	sdk: SpeechSynthesisOutputFormat;
	/** Derived from the real container, not guessed from the label. */
	extension: string;
	mimeType: string;
	concat: ConcatStrategy;
}

/**
 * A curated set rather than all thirty the service offers. The originals
 * included 8 kHz mu-law telephony codecs that make no sense for reading notes,
 * and mislabelled every non-mp3 container as `.wav`.
 *
 * Each entry names its SDK enum member explicitly. The original plugin zipped a
 * display list against `Object.keys(SpeechSynthesisOutputFormat)` by array
 * index, so any format Microsoft added shifted every mapping silently.
 */
export const AUDIO_FORMATS: [AudioFormatSpec, ...AudioFormatSpec[]] = [
	{
		id: "mp3-24khz-160k",
		label: "MP3 — 24 kHz, 160 kbps (recommended)",
		sdk: SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3,
		extension: "mp3",
		mimeType: "audio/mpeg",
		concat: "mp3",
	},
	{
		id: "mp3-48khz-192k",
		label: "MP3 — 48 kHz, 192 kbps (highest quality)",
		sdk: SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3,
		extension: "mp3",
		mimeType: "audio/mpeg",
		concat: "mp3",
	},
	{
		id: "mp3-24khz-96k",
		label: "MP3 — 24 kHz, 96 kbps",
		sdk: SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
		extension: "mp3",
		mimeType: "audio/mpeg",
		concat: "mp3",
	},
	{
		id: "mp3-16khz-32k",
		label: "MP3 — 16 kHz, 32 kbps (smallest)",
		sdk: SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3,
		extension: "mp3",
		mimeType: "audio/mpeg",
		concat: "mp3",
	},
	{
		id: "wav-24khz-16bit",
		label: "WAV — 24 kHz, 16-bit PCM (uncompressed)",
		sdk: SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm,
		extension: "wav",
		mimeType: "audio/wav",
		concat: "riff",
	},
	{
		id: "wav-48khz-16bit",
		label: "WAV — 48 kHz, 16-bit PCM (uncompressed)",
		sdk: SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm,
		extension: "wav",
		mimeType: "audio/wav",
		concat: "riff",
	},
	{
		id: "ogg-48khz-opus",
		label: "Ogg Opus — 48 kHz (compact)",
		sdk: SpeechSynthesisOutputFormat.Ogg48Khz16BitMonoOpus,
		extension: "ogg",
		mimeType: "audio/ogg",
		concat: "none",
	},
];

export const DEFAULT_AUDIO_FORMAT_ID = AUDIO_FORMATS[0].id;

export function getAudioFormat(id: string | undefined): AudioFormatSpec {
	return AUDIO_FORMATS.find((f) => f.id === id) ?? AUDIO_FORMATS[0];
}

export function audioFormatOptions(): Record<string, string> {
	return Object.fromEntries(AUDIO_FORMATS.map((f) => [f.id, f.label]));
}
