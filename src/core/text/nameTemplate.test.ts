import { describe, expect, it } from "vitest";
import {
	BUILTIN_NAME_TEMPLATE,
	expandNameTemplate,
	missingProperties,
	nameTemplateError,
	unknownNameVariables,
	type NameVars,
} from "./nameTemplate";

/** Stands in for Moment: records the format instead of implementing it. */
const vars = (overrides: Partial<NameVars> = {}): NameVars => ({
	title: "Korean vocabulary",
	selection: "안녕하세요",
	profile: "Korean",
	locale: "ko-KR",
	properties: { word: "annyeong", lesson: 4, tags: ["greeting", "polite"] },
	now: new Date(2026, 7, 18, 14, 35, 9),
	formatDate: (format) => `<${format}>`,
	...overrides,
});

describe("expandNameTemplate", () => {
	it("fills the variables of the Templates plugin", () => {
		expect(expandNameTemplate(["{{title}}-{{selection}}"], vars())).toBe(
			"Korean vocabulary-안녕하세요",
		);
	});

	it("passes a format string through to the formatter", () => {
		expect(expandNameTemplate(["{{date:YYYYMMDD}}"], vars())).toBe("<YYYYMMDD>");
	});

	it("uses the Obsidian default format for a bare date", () => {
		expect(expandNameTemplate(["{{date}}"], vars())).toBe("<YYYY-MM-DD>");
	});

	// Obsidian defaults to HH:mm, which a file name cannot hold.
	it("defaults time to a format with no colon in it", () => {
		expect(expandNameTemplate(["{{time}}"], vars())).toBe("<HH-mm-ss>");
	});

	it("names the profile and its locale", () => {
		expect(expandNameTemplate(["{{profile}}_{{locale}}"], vars())).toBe("Korean_ko-KR");
	});

	it("tolerates spaces inside the braces", () => {
		expect(expandNameTemplate(["{{ title }}"], vars())).toBe("Korean vocabulary");
	});

	it("leaves an unknown variable as it was written", () => {
		expect(expandNameTemplate(["{{titel}}-x"], vars())).toBe("{{titel}}-x");
	});

	it("cuts a long selection at a word boundary", () => {
		const long = "the quick brown fox jumps over the lazy dog and keeps running";
		const name = expandNameTemplate(["{{selection}}"], vars({ selection: long }));

		expect(name).toBe("the quick brown fox jumps over the lazy");
		expect(name.length).toBeLessThanOrEqual(40);
	});

	it("collapses the whitespace of a selection", () => {
		expect(
			expandNameTemplate(["{{selection}}"], vars({ selection: " two \n words " })),
		).toBe("two words");
	});

	describe("{{property:name}}", () => {
		it("reads a property of the note", () => {
			expect(expandNameTemplate(["{{property:word}}"], vars())).toBe("annyeong");
		});

		it("joins the values of a list with dashes", () => {
			expect(expandNameTemplate(["{{property:tags}}"], vars())).toBe("greeting-polite");
		});

		it("writes a number as its text", () => {
			expect(expandNameTemplate(["{{property:lesson}}"], vars())).toBe("4");
		});

		it("falls back to the note title when the property is absent", () => {
			expect(expandNameTemplate(["{{property:missing}}"], vars())).toBe(
				"Korean vocabulary",
			);
		});

		it("falls back when the property is there but empty", () => {
			const empty = vars({ properties: { word: "   ", tags: [] } });

			expect(expandNameTemplate(["{{property:word}}"], empty)).toBe(
				"Korean vocabulary",
			);
			expect(expandNameTemplate(["{{property:tags}}"], empty)).toBe(
				"Korean vocabulary",
			);
		});

		it("falls back when no property is named at all", () => {
			expect(expandNameTemplate(["{{property}}"], vars())).toBe("Korean vocabulary");
		});

		it("builds the whole name, prefix and all", () => {
			expect(expandNameTemplate(["KR-{{property:word}}"], vars())).toBe("KR-annyeong");
			expect(expandNameTemplate(["KR-{{property:missing}}"], vars())).toBe(
				"KR-Korean vocabulary",
			);
		});
	});

	describe("{{default}}", () => {
		it("appends to the next template in the chain", () => {
			expect(expandNameTemplate(["{{default}}_drill", "{{title}}"], vars())).toBe(
				"Korean vocabulary_drill",
			);
		});

		it("prepends to it just as well", () => {
			expect(expandNameTemplate(["KR_{{default}}", "{{title}}"], vars())).toBe(
				"KR_Korean vocabulary",
			);
		});

		it("chains through more than one level", () => {
			expect(
				expandNameTemplate(["a-{{default}}", "b-{{default}}", "{{title}}"], vars()),
			).toBe("a-b-Korean vocabulary");
		});

		// Every entry is consumed, so the recursion cannot run on.
		it("becomes empty at the end of the chain", () => {
			expect(expandNameTemplate(["{{default}}"], vars())).toBe("");
		});

		it("does not disturb the variables around it", () => {
			expect(
				expandNameTemplate(["{{profile}}/{{default}}/{{locale}}", "{{title}}"], vars()),
			).toBe("Korean/Korean vocabulary/ko-KR");
		});
	});

	it("returns nothing for an empty chain", () => {
		expect(expandNameTemplate([], vars())).toBe("");
	});

	it("names a file after the words that were read", () => {
		expect(expandNameTemplate([BUILTIN_NAME_TEMPLATE], vars())).toBe("안녕하세요");
	});
});

describe("missingProperties", () => {
	it("is empty when the note supplies every property asked for", () => {
		expect(missingProperties(["{{property:word}}-{{property:tags}}"], vars())).toEqual(
			[],
		);
	});

	it("names each property the note lacks, once and in order", () => {
		expect(
			missingProperties(
				["{{property:unit}}-{{property:book}}-{{property:unit}}"],
				vars(),
			),
		).toEqual(["unit", "book"]);
	});

	it("counts a property that is present but empty", () => {
		const empty = vars({ properties: { word: "  ", tags: [] } });
		expect(missingProperties(["{{property:word}}{{property:tags}}"], empty)).toEqual([
			"word",
			"tags",
		]);
	});

	it("ignores a template with no property in it", () => {
		expect(missingProperties(["{{title}}_{{date}}"], vars())).toEqual([]);
	});

	it("has nothing to ask for an unnamed property", () => {
		expect(missingProperties(["{{property}}"], vars())).toEqual([]);
	});

	it("follows the chain only where {{default}} reaches", () => {
		const chain = ["{{default}}-x", "{{property:unit}}"];
		expect(missingProperties(chain, vars())).toEqual(["unit"]);
	});

	// The override never writes {{default}}, so the entry below is never expanded.
	it("stops at a template that does not extend the next one", () => {
		expect(missingProperties(["fixed", "{{property:unit}}"], vars())).toEqual([]);
	});
});

describe("unknownNameVariables", () => {
	it("is empty for a template this build understands", () => {
		expect(
			unknownNameVariables("{{title}}_{{date:YYYY}}_{{property:word}}_{{default}}"),
		).toEqual([]);
	});

	it("reports each unknown name once", () => {
		expect(unknownNameVariables("{{titel}}-{{foo}}-{{titel}}")).toEqual([
			"titel",
			"foo",
		]);
	});
});

describe("nameTemplateError", () => {
	it("is null for a usable template", () => {
		expect(nameTemplateError("{{title}}")).toBeNull();
	});

	it("names the variable it cannot expand", () => {
		expect(nameTemplateError("{{titel}}")).toContain("{{titel}}");
	});
});
