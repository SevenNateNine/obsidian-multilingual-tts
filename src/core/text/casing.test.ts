import { describe, expect, it } from "vitest";
import { camelCase, kebabCase, pascalCase, snakeCase } from "./casing";

const PHRASE = "you can do this later";

describe("kebabCase", () => {
	it("joins the words with hyphens", () => {
		expect(kebabCase(PHRASE)).toBe("you-can-do-this-later");
	});

	it("lowercases mixed case", () => {
		expect(kebabCase("You Can DO This")).toBe("you-can-do-this");
	});

	it("treats a run of punctuation as one separator", () => {
		expect(kebabCase("you, can... do")).toBe("you-can-do");
	});

	it("drops punctuation at the ends", () => {
		expect(kebabCase("  !you can!  ")).toBe("you-can");
	});

	it("keeps letters of every script", () => {
		expect(kebabCase("이거 나중에 해도 돼요")).toBe("이거-나중에-해도-돼요");
	});

	it("keeps digits", () => {
		expect(kebabCase("lesson 4 part 2")).toBe("lesson-4-part-2");
	});

	it("leaves an already dashed value as it is", () => {
		expect(kebabCase("greeting-polite")).toBe("greeting-polite");
	});

	it("is empty when there is no word", () => {
		expect(kebabCase("")).toBe("");
		expect(kebabCase("!!!")).toBe("");
	});
});

describe("snakeCase", () => {
	it("joins the words with underscores", () => {
		expect(snakeCase(PHRASE)).toBe("you_can_do_this_later");
	});

	it("lowercases and drops punctuation", () => {
		expect(snakeCase("You Can, Do!")).toBe("you_can_do");
	});

	it("is empty when there is no word", () => {
		expect(snakeCase(" - ")).toBe("");
	});
});

describe("camelCase", () => {
	it("lowercases the first word and capitalizes the rest", () => {
		expect(camelCase(PHRASE)).toBe("youCanDoThisLater");
	});

	it("normalizes the case inside each word", () => {
		expect(camelCase("YOU can DO this")).toBe("youCanDoThis");
	});

	it("joins a dashed list value", () => {
		expect(camelCase("greeting-polite")).toBe("greetingPolite");
	});

	// Hangul has no case, so the words are joined as they are.
	it("joins words of a script with no case", () => {
		expect(camelCase("이거 나중에")).toBe("이거나중에");
	});

	it("does not split a word on its own capitals", () => {
		expect(camelCase("my iPhone")).toBe("myIphone");
	});

	it("is empty when there is no word", () => {
		expect(camelCase("")).toBe("");
	});
});

describe("pascalCase", () => {
	it("capitalizes every word", () => {
		expect(pascalCase(PHRASE)).toBe("YouCanDoThisLater");
	});

	it("normalizes the case inside each word", () => {
		expect(pascalCase("yOU can DO this")).toBe("YouCanDoThis");
	});

	it("keeps digits as words", () => {
		expect(pascalCase("lesson 4")).toBe("Lesson4");
	});

	it("is empty when there is no word", () => {
		expect(pascalCase("...")).toBe("");
	});
});
