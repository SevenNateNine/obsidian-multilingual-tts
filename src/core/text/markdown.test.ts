import { describe, expect, it } from "vitest";
import { applyTextFilter, prepareText, stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
	it("removes leading frontmatter but keeps a mid-document rule", () => {
		expect(stripMarkdown("---\ntitle: Hi\n---\nBody text")).toBe("Body text");
		expect(stripMarkdown("Intro\n\n---\n\nOutro")).toBe("Intro\n\nOutro");
	});

	it("keeps heading text and drops the markers", () => {
		expect(stripMarkdown("## Chapter one")).toBe("Chapter one");
		expect(stripMarkdown("### Closed heading ###")).toBe("Closed heading");
	});

	it("resolves wikilinks to their spoken form", () => {
		expect(stripMarkdown("See [[Some Note]].")).toBe("See Some Note.");
		expect(stripMarkdown("See [[Some Note|the note]].")).toBe("See the note.");
		expect(stripMarkdown("See [[folder/deep/Note#Heading]].")).toBe("See Note.");
	});

	it("drops embeds entirely", () => {
		expect(stripMarkdown("Before ![[diagram.png]] after")).toBe("Before after");
	});

	it("keeps link and image text but not the target", () => {
		expect(stripMarkdown("Read [the docs](https://example.com) now")).toBe(
			"Read the docs now",
		);
		expect(stripMarkdown("![a cat](cat.png)")).toBe("a cat");
	});

	it("removes fenced code blocks including their contents", () => {
		const input = "Before\n\n```js\nconst x = 1;\n```\n\nAfter";
		expect(stripMarkdown(input)).toBe("Before\n\nAfter");
	});

	it("does not let an unterminated fence leak code into speech", () => {
		expect(stripMarkdown("Intro\n\n```\nrm -rf /\nmore code")).toBe("Intro");
	});

	it("keeps a callout title and drops its marker", () => {
		expect(stripMarkdown("> [!warning] Be careful\n> body")).toBe("Be careful\nbody");
	});

	it("unwraps emphasis, highlight, strikethrough and inline code", () => {
		expect(stripMarkdown("**bold** _italic_ ==mark== ~~gone~~ `code`")).toBe(
			"bold italic mark gone code",
		);
	});

	it("speaks a tag without the hash", () => {
		expect(stripMarkdown("Filed under #project/alpha today")).toBe(
			"Filed under project/alpha today",
		);
	});

	it("leaves a numeric hash alone", () => {
		expect(stripMarkdown("Issue #42 is open")).toBe("Issue #42 is open");
	});

	it("strips list and checkbox markers", () => {
		expect(stripMarkdown("- one\n- [ ] two\n1. three")).toBe("one\ntwo\nthree");
	});

	it("removes Obsidian comments", () => {
		expect(stripMarkdown("Visible %%hidden%% text")).toBe("Visible text");
	});

	it("collapses excess blank lines", () => {
		expect(stripMarkdown("a\n\n\n\n\nb")).toBe("a\n\nb");
	});

	it("preserves ampersands and angle brackets for the SSML layer to escape", () => {
		// Escaping belongs to the provider. Stripping must keep these characters.
		expect(stripMarkdown("Tom & Jerry")).toBe("Tom & Jerry");
	});
});

describe("applyTextFilter", () => {
	it("returns the text unchanged when no rule is set", () => {
		expect(applyTextFilter("hello", "")).toBe("hello");
	});

	it("accepts a bare pattern, matching case-insensitively by default", () => {
		expect(applyTextFilter("a1b2c3", "[0-9]")).toBe("a b c ");
		expect(applyTextFilter("aAbB", "a")).toBe("  bB");
	});

	it("honours explicit flags in /pattern/flags form", () => {
		// No `i`, so only the lowercase `a` matches.
		expect(applyTextFilter("aAbB", "/a/g")).toBe(" AbB");
	});

	it("forces a global flag so every match is replaced", () => {
		expect(applyTextFilter("aaa", "/a/")).toBe("   ");
	});

	it("survives a malformed pattern instead of throwing", () => {
		expect(applyTextFilter("keep me", "[unclosed")).toBe("keep me");
	});
});

describe("prepareText", () => {
	it("strips markdown then applies the filter", () => {
		expect(
			prepareText("# Title\n\nSome **bold** 123 text", {
				stripMarkdown: true,
				filterRegex: "[0-9]+",
			}),
		).toBe("Title\n\nSome bold text");
	});

	it("can leave markdown intact", () => {
		expect(prepareText("**bold**", { stripMarkdown: false, filterRegex: "" })).toBe(
			"**bold**",
		);
	});
});
