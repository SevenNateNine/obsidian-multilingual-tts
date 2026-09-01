import { describe, expect, it } from "vitest";
import { identifiesLanguageByScript } from "./scripts";

describe("identifiesLanguageByScript", () => {
	it("accepts a single character from a single-language script", () => {
		expect(identifiesLanguageByScript("한")).toBe(true);
		expect(identifiesLanguageByScript("中")).toBe(true);
		expect(identifiesLanguageByScript("の")).toBe(true);
		expect(identifiesLanguageByScript("ก")).toBe(true);
		expect(identifiesLanguageByScript("α")).toBe(true);
	});

	it("accepts longer text in those scripts", () => {
		expect(identifiesLanguageByScript("안녕하세요")).toBe(true);
		expect(identifiesLanguageByScript("これは日本語です")).toBe(true);
	});

	it("ignores punctuation, digits and spaces", () => {
		expect(identifiesLanguageByScript("안녕하세요.")).toBe(true);
		expect(identifiesLanguageByScript("中文 123!")).toBe(true);
	});

	it("rejects scripts that several languages share", () => {
		expect(identifiesLanguageByScript("a")).toBe(false);
		expect(identifiesLanguageByScript("Bonjour")).toBe(false);
		expect(identifiesLanguageByScript("Привет")).toBe(false);
		expect(identifiesLanguageByScript("مرحبا")).toBe(false);
		expect(identifiesLanguageByScript("नमस्ते")).toBe(false);
	});

	it("rejects mixed text, because the shared-script part is the ambiguous part", () => {
		expect(identifiesLanguageByScript("안녕 hi")).toBe(false);
		expect(identifiesLanguageByScript("中文 and English")).toBe(false);
	});

	it("rejects text with no script at all", () => {
		expect(identifiesLanguageByScript("")).toBe(false);
		expect(identifiesLanguageByScript("123")).toBe(false);
		expect(identifiesLanguageByScript("   ")).toBe(false);
		expect(identifiesLanguageByScript("!?.")).toBe(false);
	});
});
