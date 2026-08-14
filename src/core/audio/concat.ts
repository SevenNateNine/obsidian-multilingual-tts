import type { ConcatStrategy } from "../tts/types";
import { TtsError } from "../errors";

/**
 * Join the audio for several chunks into one file.
 *
 * A long note must be synthesized in pieces, because the service caps a request
 * at ten minutes of audio. The user asked for one file. The container decides
 * how the pieces can be joined:
 *
 *  - MP3 is a bare sequence of frames, so buffers concatenate as bytes.
 *  - RIFF/WAVE has a header that declares the total length. A plain concat
 *    gives a header that reports only the duration of the first piece, and
 *    most players stop early. The header must be built again.
 *  - Ogg pages carry stream serial numbers and granule positions. A byte
 *    concat makes a chained stream that many players read incorrectly.
 *    Refused.
 */
/** At least one element, so `[0]` is known to exist without a run-time check. */
type NonEmpty<T> = [T, ...T[]];

function isNonEmpty<T>(items: T[]): items is NonEmpty<T> {
	return items.length > 0;
}

export function concatenateAudio(
	buffers: ArrayBuffer[],
	strategy: ConcatStrategy,
): ArrayBuffer {
	if (!isNonEmpty(buffers)) {
		throw new TtsError("unknown", "No audio was produced");
	}
	if (buffers.length === 1) return buffers[0];

	switch (strategy) {
		case "mp3":
			return concatBytes(buffers);
		case "riff":
			return concatRiff(buffers);
		case "none":
			throw new TtsError(
				"invalid-request",
				"This audio format cannot be saved in multiple parts",
				"Choose an MP3 or WAV format for long text",
			);
	}
}

function concatBytes(buffers: NonEmpty<ArrayBuffer>): ArrayBuffer {
	const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const buffer of buffers) {
		out.set(new Uint8Array(buffer), offset);
		offset += buffer.byteLength;
	}
	return out.buffer;
}

interface RiffChunk {
	/** Offset of the chunk's 8-byte header. */
	headerOffset: number;
	/** Offset of the payload. */
	dataOffset: number;
	size: number;
}

/**
 * Locate a top-level chunk inside a RIFF container.
 * Chunk payloads are padded to an even length, which the walk must account for.
 */
export function findRiffChunk(buffer: ArrayBuffer, id: string): RiffChunk | null {
	const view = new DataView(buffer);
	if (buffer.byteLength < 12) return null;
	if (readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") return null;

	let offset = 12;
	while (offset + 8 <= buffer.byteLength) {
		const tag = readTag(view, offset);
		const size = view.getUint32(offset + 4, true);
		if (tag === id) {
			return { headerOffset: offset, dataOffset: offset + 8, size };
		}
		offset += 8 + size + (size % 2);
	}
	return null;
}

function concatRiff(buffers: NonEmpty<ArrayBuffer>): ArrayBuffer {
	const parts = buffers.map((buffer) => {
		const chunk = findRiffChunk(buffer, "data");
		if (!chunk) {
			throw new TtsError("unknown", "Generated WAV audio was not readable");
		}
		// Trust the buffer over a header that overruns it.
		const end = Math.min(chunk.dataOffset + chunk.size, buffer.byteLength);
		return new Uint8Array(buffer, chunk.dataOffset, end - chunk.dataOffset);
	});

	const first = findRiffChunk(buffers[0], "data");
	if (!first) throw new TtsError("unknown", "Generated WAV audio was not readable");

	// Everything up to and including the first file's `data` header becomes the
	// template, so the fmt chunk and any preceding metadata are preserved.
	const headerLength = first.dataOffset;
	const payloadLength = parts.reduce((sum, p) => sum + p.byteLength, 0);

	const out = new Uint8Array(headerLength + payloadLength);
	out.set(new Uint8Array(buffers[0], 0, headerLength), 0);

	let offset = headerLength;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}

	const view = new DataView(out.buffer);
	view.setUint32(4, out.byteLength - 8, true); // RIFF size
	view.setUint32(first.headerOffset + 4, payloadLength, true); // data size

	return out.buffer;
}

function readTag(view: DataView, offset: number): string {
	return String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3),
	);
}
