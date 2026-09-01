import { describe, expect, it } from "vitest";
import { audioLink, isLinkStyle } from "./audioLink";

const target = { linktext: "Audio/note.mp3", path: "Audio/note.mp3" };

describe("audioLink", () => {
	it("makes the word the display text of a wikilink", () => {
		expect(audioLink("wikilink", "안녕", target)).toBe("[[Audio/note.mp3|안녕]]");
	});

	it("writes a markdown link with the path encoded", () => {
		expect(
			audioLink("markdown", "hello", {
				linktext: "my note.mp3",
				path: "Audio/my note.mp3",
			}),
		).toBe("[hello](Audio/my%20note.mp3)");
	});

	it("keeps the slashes of a path as slashes", () => {
		expect(audioLink("markdown", "hi", target)).toBe("[hi](Audio/note.mp3)");
	});

	it("puts a player after the word for the embed style", () => {
		expect(audioLink("embed", "word", target)).toBe("word ![[Audio/note.mp3]]");
	});

	// A pipe or a bracket ends the wikilink early, so the whole link breaks.
	it("falls back to markdown when the word cannot be wikilink text", () => {
		expect(audioLink("wikilink", "a|b", target)).toBe("[a|b](Audio/note.mp3)");
		expect(audioLink("wikilink", "[x]", target)).toBe("[[x]](Audio/note.mp3)");
	});
});

describe("isLinkStyle", () => {
	it("accepts the three styles and nothing else", () => {
		expect(isLinkStyle("wikilink")).toBe(true);
		expect(isLinkStyle("embed")).toBe(true);
		expect(isLinkStyle("hyperlink")).toBe(false);
		expect(isLinkStyle(undefined)).toBe(false);
	});
});
