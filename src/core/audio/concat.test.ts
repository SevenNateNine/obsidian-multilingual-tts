import { describe, expect, it } from "vitest";
import { concatenateAudio, findRiffChunk } from "./concat";
import { TtsError } from "../errors";

/** Build a minimal but valid RIFF/WAVE buffer with the given PCM payload. */
function makeWav(payload: number[], extraChunk = false): ArrayBuffer {
	const fmtSize = 16;
	const extraSize = extraChunk ? 4 : 0;
	const extraTotal = extraChunk ? 8 + extraSize : 0;
	const total = 12 + 8 + fmtSize + extraTotal + 8 + payload.length;

	const buffer = new ArrayBuffer(total);
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	const tag = (offset: number, value: string) => {
		for (let i = 0; i < 4; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};

	tag(0, "RIFF");
	view.setUint32(4, total - 8, true);
	tag(8, "WAVE");

	tag(12, "fmt ");
	view.setUint32(16, fmtSize, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, 24000, true);
	view.setUint32(28, 48000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);

	let offset = 12 + 8 + fmtSize;
	if (extraChunk) {
		tag(offset, "fact");
		view.setUint32(offset + 4, extraSize, true);
		view.setUint32(offset + 8, 123, true);
		offset += 8 + extraSize;
	}

	tag(offset, "data");
	view.setUint32(offset + 4, payload.length, true);
	bytes.set(payload, offset + 8);

	return buffer;
}

const bytesOf = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

describe("findRiffChunk", () => {
	it("locates the data chunk", () => {
		const wav = makeWav([1, 2, 3, 4]);
		const chunk = findRiffChunk(wav, "data")!;
		expect(chunk.size).toBe(4);
		expect(bytesOf(wav).slice(chunk.dataOffset)).toEqual([1, 2, 3, 4]);
	});

	it("walks past intervening chunks", () => {
		const wav = makeWav([9, 9], true);
		const chunk = findRiffChunk(wav, "data")!;
		expect(chunk.size).toBe(2);
	});

	it("returns null for a non-RIFF buffer", () => {
		expect(findRiffChunk(new Uint8Array([1, 2, 3, 4]).buffer, "data")).toBeNull();
	});
});

describe("concatenateAudio", () => {
	it("rejects an empty list", () => {
		expect(() => concatenateAudio([], "mp3")).toThrow(TtsError);
	});

	it("returns a single buffer untouched", () => {
		const only = new Uint8Array([1, 2, 3]).buffer;
		expect(concatenateAudio([only], "mp3")).toBe(only);
	});

	it("joins mp3 buffers byte for byte", () => {
		const a = new Uint8Array([1, 2]).buffer;
		const b = new Uint8Array([3, 4, 5]).buffer;
		expect(bytesOf(concatenateAudio([a, b], "mp3"))).toEqual([1, 2, 3, 4, 5]);
	});

	it("refuses to join a container that cannot be chained", () => {
		const a = new Uint8Array([1]).buffer;
		expect(() => concatenateAudio([a, a], "none")).toThrow(/multiple parts/);
	});

	describe("riff", () => {
		it("concatenates the payloads", () => {
			const out = concatenateAudio([makeWav([1, 2, 3, 4]), makeWav([5, 6])], "riff");
			const chunk = findRiffChunk(out, "data")!;
			expect(bytesOf(out).slice(chunk.dataOffset)).toEqual([1, 2, 3, 4, 5, 6]);
		});

		// The bug a naive byte-concat produces: the header still claims the
		// first piece's length, so players stop early.
		it("rewrites the data chunk size to the combined length", () => {
			const out = concatenateAudio([makeWav([1, 2, 3, 4]), makeWav([5, 6])], "riff");
			expect(findRiffChunk(out, "data")!.size).toBe(6);
		});

		it("rewrites the RIFF size to match the real file length", () => {
			const out = concatenateAudio([makeWav([1, 2, 3, 4]), makeWav([5, 6])], "riff");
			expect(new DataView(out).getUint32(4, true)).toBe(out.byteLength - 8);
		});

		it("preserves the format chunk from the first file", () => {
			const out = concatenateAudio([makeWav([1]), makeWav([2])], "riff");
			const fmt = findRiffChunk(out, "fmt ")!;
			expect(fmt.size).toBe(16);
			expect(new DataView(out).getUint32(fmt.dataOffset + 4, true)).toBe(24000);
		});

		it("keeps chunks that sit between fmt and data", () => {
			const out = concatenateAudio([makeWav([1], true), makeWav([2], true)], "riff");
			expect(findRiffChunk(out, "fact")).not.toBeNull();
			expect(findRiffChunk(out, "data")!.size).toBe(2);
		});

		it("joins more than two pieces", () => {
			const out = concatenateAudio([makeWav([1]), makeWav([2]), makeWav([3])], "riff");
			const chunk = findRiffChunk(out, "data")!;
			expect(chunk.size).toBe(3);
			expect(bytesOf(out).slice(chunk.dataOffset)).toEqual([1, 2, 3]);
		});

		it("survives a header that overstates its payload", () => {
			const wav = makeWav([1, 2]);
			new DataView(wav).setUint32(
				findRiffChunk(wav, "data")!.headerOffset + 4,
				999,
				true,
			);
			const out = concatenateAudio([wav, makeWav([3])], "riff");
			expect(findRiffChunk(out, "data")!.size).toBe(3);
		});

		it("reports unreadable input clearly", () => {
			const junk = new Uint8Array([0, 1, 2, 3]).buffer;
			expect(() => concatenateAudio([junk, junk], "riff")).toThrow(TtsError);
		});
	});
});
