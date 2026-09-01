import type { RenderingProvider } from "../tts/types";
import type { VoiceProfile } from "../settings/types";
import { chunkText } from "./chunker";
import { concatenateAudio } from "./concat";
import { TtsError } from "../errors";

export interface RenderedFile {
	data: ArrayBuffer;
	extension: string;
	/** Carried so the finished buffer can also be played, without a second render. */
	mimeType: string;
}

export interface RenderProgress {
	done: number;
	total: number;
}

/**
 * Render an entire text to one audio buffer, in as many requests as it takes.
 *
 * Chunks are rendered in order and joined afterwards. Unlike playback there is
 * nothing to gain from starting early, so this trades latency for a single
 * clean file.
 */
export async function renderToFile(
	provider: RenderingProvider,
	profile: VoiceProfile,
	text: string,
	signal: AbortSignal,
	onProgress?: (progress: RenderProgress) => void,
): Promise<RenderedFile> {
	const chunks = chunkText(text, { maxChars: provider.maxChunkChars });
	if (chunks.length === 0) {
		throw new TtsError("invalid-request", "There is nothing to convert");
	}

	const format = provider.outputFormat(profile);

	// Checked before the first request so an impossible combination costs
	// nothing, rather than failing after every chunk has been paid for.
	if (chunks.length > 1 && format.concat === "none") {
		throw new TtsError(
			"invalid-request",
			"This audio format cannot be saved in multiple parts",
			`The text needs ${chunks.length} requests; choose an MP3 or WAV format`,
		);
	}

	const buffers: ArrayBuffer[] = [];
	for (const [i, chunk] of chunks.entries()) {
		if (signal.aborted) throw new TtsError("cancelled", "aborted");
		onProgress?.({ done: i, total: chunks.length });
		const rendered = await provider.render({ text: chunk, profile }, signal);
		buffers.push(rendered.data);
	}
	onProgress?.({ done: chunks.length, total: chunks.length });

	return {
		data: concatenateAudio(buffers, format.concat),
		extension: format.extension,
		mimeType: format.mimeType,
	};
}
