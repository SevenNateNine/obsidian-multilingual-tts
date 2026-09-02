import { describe, expect, it } from "vitest";
import {
	containsLink,
	hasPropertyValue,
	nextPropertyValue,
	propertyText,
} from "./propertyLink";

const LINK = "[[Audio/hello.mp3]]";

describe("hasPropertyValue", () => {
	it("is false for nothing, an empty string, and an empty list", () => {
		expect(hasPropertyValue(undefined)).toBe(false);
		expect(hasPropertyValue(null)).toBe(false);
		expect(hasPropertyValue("  ")).toBe(false);
		expect(hasPropertyValue([])).toBe(false);
	});

	it("is true for a scalar, a list, and an object", () => {
		expect(hasPropertyValue("x")).toBe(true);
		expect(hasPropertyValue(0)).toBe(true);
		expect(hasPropertyValue(false)).toBe(true);
		expect(hasPropertyValue(["x"])).toBe(true);
		expect(hasPropertyValue({ a: 1 })).toBe(true);
	});
});

describe("containsLink", () => {
	it("matches the same file in each link form", () => {
		expect(containsLink("[[Audio/hello.mp3]]", LINK)).toBe(true);
		expect(containsLink("![[Audio/hello.mp3]]", LINK)).toBe(true);
		expect(containsLink("[[Audio/hello.mp3|hello]]", LINK)).toBe(true);
		expect(containsLink(["[[other.mp3]]", LINK], LINK)).toBe(true);
	});

	it("rejects a different file, a non-string entry, and nothing", () => {
		expect(containsLink("[[Audio/bye.mp3]]", LINK)).toBe(false);
		expect(containsLink([3, true, null], LINK)).toBe(false);
		expect(containsLink(undefined, LINK)).toBe(false);
	});
});

describe("nextPropertyValue", () => {
	it("replaces whatever is there", () => {
		expect(nextPropertyValue("old", LINK, "replace")).toBe(LINK);
		expect(nextPropertyValue(["a", "b"], LINK, "replace")).toBe(LINK);
		expect(nextPropertyValue(undefined, LINK, "replace")).toBe(LINK);
	});

	it("appends to an empty property as a scalar", () => {
		expect(nextPropertyValue(undefined, LINK, "append")).toBe(LINK);
		expect(nextPropertyValue("", LINK, "append")).toBe(LINK);
		expect(nextPropertyValue([], LINK, "append")).toBe(LINK);
	});

	it("appends to a list", () => {
		expect(nextPropertyValue(["[[a.mp3]]"], LINK, "append")).toEqual([
			"[[a.mp3]]",
			LINK,
		]);
	});

	it("turns a scalar into a list of two, whatever the scalar is", () => {
		expect(nextPropertyValue("[[a.mp3]]", LINK, "append")).toEqual(["[[a.mp3]]", LINK]);
		expect(nextPropertyValue(7, LINK, "append")).toEqual([7, LINK]);
		expect(nextPropertyValue({ a: 1 }, LINK, "append")).toEqual([{ a: 1 }, LINK]);
	});

	it("does not append a link that is already there", () => {
		expect(nextPropertyValue(LINK, LINK, "append")).toBe(LINK);
		const list = ["[[a.mp3]]", "![[Audio/hello.mp3]]"];
		expect(nextPropertyValue(list, LINK, "append")).toBe(list);
	});

	it("gives one entry when appended twice", () => {
		const once = nextPropertyValue("[[a.mp3]]", LINK, "append");
		expect(nextPropertyValue(once, LINK, "append")).toEqual(["[[a.mp3]]", LINK]);
	});
});

describe("propertyText", () => {
	it("joins the readable values and drops the rest", () => {
		expect(propertyText("x")).toBe("x");
		expect(propertyText(["a", 2, { nested: true }])).toBe("a, 2");
		expect(propertyText(undefined)).toBe("");
	});
});
