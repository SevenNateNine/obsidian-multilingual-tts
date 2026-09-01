import { describe, expect, it } from "vitest";
import { matchesFilter } from "./filter";
import { linkName } from "../text/wikilink";

const filter = { property: "type", value: "Flashcard" };

const matches = (raw: unknown) => matchesFilter({ type: raw }, filter);

describe("linkName", () => {
	it("strips the brackets of a wikilink", () => {
		expect(linkName("[[Flashcard]]")).toBe("flashcard");
	});

	it("drops an alias", () => {
		expect(linkName("[[Flashcard|card]]")).toBe("flashcard");
	});

	it("drops a heading and a block reference", () => {
		expect(linkName("[[Flashcard#Usage]]")).toBe("flashcard");
		expect(linkName("[[Flashcard#^a1b2c3]]")).toBe("flashcard");
	});

	it("keeps only the last path segment", () => {
		expect(linkName("[[Notes/Types/Flashcard]]")).toBe("flashcard");
	});

	it("handles an embed and a plain name", () => {
		expect(linkName("![[Flashcard]]")).toBe("flashcard");
		expect(linkName("  Flashcard  ")).toBe("flashcard");
	});

	it("combines every part at once", () => {
		expect(linkName("[[Notes/Flashcard#Usage|a card]]")).toBe("flashcard");
	});
});

describe("matchesFilter", () => {
	it("matches a wikilink, a bare string, and a list of one", () => {
		expect(matches("[[Flashcard]]")).toBe(true);
		expect(matches("Flashcard")).toBe(true);
		expect(matches(["[[Flashcard]]"])).toBe(true);
	});

	it("matches any entry of a longer list", () => {
		expect(matches(["[[Note]]", "[[Flashcard]]"])).toBe(true);
	});

	it("ignores case on both sides", () => {
		expect(matches("[[flashcard]]")).toBe(true);
		expect(
			matchesFilter({ type: "FLASHCARD" }, { ...filter, value: "flashcard" }),
		).toBe(true);
	});

	it("accepts a filter value written as a wikilink", () => {
		expect(
			matchesFilter({ type: "Flashcard" }, { ...filter, value: "[[Flashcard]]" }),
		).toBe(true);
	});

	it("rejects a different value", () => {
		expect(matches("[[Vocabulary]]")).toBe(false);
		expect(matches(["[[Note]]", "[[Vocabulary]]"])).toBe(false);
	});

	it("rejects a note without the property", () => {
		expect(matchesFilter({}, filter)).toBe(false);
		expect(matches(null)).toBe(false);
		expect(matches(undefined)).toBe(false);
		expect(matches([])).toBe(false);
	});

	it("reads a number or a boolean as its own text", () => {
		expect(matchesFilter({ level: 3 }, { property: "level", value: "3" })).toBe(true);
		expect(matchesFilter({ done: true }, { property: "done", value: "true" })).toBe(
			true,
		);
	});

	it("matches nothing when the filter itself is empty", () => {
		expect(
			matchesFilter({ type: "Flashcard" }, { property: "", value: "Flashcard" }),
		).toBe(false);
		expect(
			matchesFilter({ type: "Flashcard" }, { property: "type", value: "  " }),
		).toBe(false);
	});
});
