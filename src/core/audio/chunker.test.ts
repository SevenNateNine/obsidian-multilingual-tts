import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";

describe("chunkText", () => {
	it("returns nothing for empty input", () => {
		expect(chunkText("")).toEqual([]);
		expect(chunkText("   \n  ")).toEqual([]);
	});

	it("keeps short text in a single chunk", () => {
		expect(chunkText("Hello there.")).toEqual(["Hello there."]);
	});

	it("never exceeds the limit when sentences allow it", () => {
		const text = Array.from({ length: 200 }, (_, i) => `Sentence ${i}.`).join(" ");
		const chunks = chunkText(text, { maxChars: 100 });
		expect(chunks.every((c) => c.length <= 100)).toBe(true);
	});

	it("splits on sentence boundaries rather than mid-sentence", () => {
		const text = "First sentence here. Second sentence here. Third sentence here.";
		const chunks = chunkText(text, { maxChars: 40 });
		expect(chunks.every((c) => /[.!?]$/.test(c))).toBe(true);
	});

	it("handles CJK full-width terminators", () => {
		const text = "第一句话。第二句话。第三句话。".repeat(20);
		const chunks = chunkText(text, { maxChars: 30 });
		expect(chunks.every((c) => c.length <= 30)).toBe(true);
		expect(chunks.join("")).toBe(text);
	});

	it("falls back to word boundaries for an oversized sentence", () => {
		const text = `${"word ".repeat(100).trim()}.`;
		const chunks = chunkText(text, { maxChars: 50 });
		expect(chunks.every((c) => c.length <= 50)).toBe(true);
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("hard-splits a single token longer than the limit", () => {
		const chunks = chunkText("x".repeat(250), { maxChars: 100 });
		expect(chunks).toHaveLength(3);
		expect(chunks[0]).toHaveLength(100);
	});

	it("loses no words", () => {
		const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ") + ".";
		const chunks = chunkText(text, { maxChars: 120 });
		expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
	});

	it("prefers paragraph boundaries", () => {
		const chunks = chunkText("Para one text.\n\nPara two text.", { maxChars: 20 });
		expect(chunks).toEqual(["Para one text.", "Para two text."]);
	});
});
