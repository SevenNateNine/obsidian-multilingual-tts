import { describe, expect, it } from "vitest";
import { validateTargets } from "./targets";
import type { AudioTarget } from "./types";

const target = (partial: Partial<AudioTarget> = {}): AudioTarget => ({
	id: partial.id ?? "t1",
	textField: "korean",
	audioField: "korean_audio",
	prefix: "KR",
	...partial,
});

const korean = target();
const english = target({
	id: "t2",
	textField: "english",
	audioField: "english_audio",
	prefix: "EN",
});

describe("validateTargets", () => {
	it("accepts a preset whose targets share nothing", () => {
		expect(validateTargets([korean, english])).toEqual([]);
	});

	it("accepts a single target with no prefix", () => {
		expect(validateTargets([target({ prefix: "" })])).toEqual([]);
	});

	it("asks for at least one target", () => {
		expect(validateTargets([])).toEqual(["Add at least one target."]);
	});

	it("reports an empty property on either side", () => {
		expect(validateTargets([target({ textField: " " })])).toEqual([
			"Target 1 needs a property to speak.",
		]);
		expect(validateTargets([target({ audioField: "" })])).toEqual([
			"Target 1 needs a property to write the link to.",
		]);
	});

	it("refuses a target that writes over the words it speaks", () => {
		const problems = validateTargets([target({ audioField: "korean" })]);
		expect(problems).toEqual([
			'Target 1 would write its link over "korean", the words it speaks.',
		]);
	});

	it("refuses two targets writing to one property", () => {
		const clash = target({ id: "t2", textField: "english", prefix: "EN" });
		expect(validateTargets([korean, clash])).toContain(
			'Two targets write to "korean_audio". Each one needs its own.',
		);
	});

	it("refuses two targets sharing a hash property", () => {
		const clash = target({
			id: "t2",
			textField: "english",
			audioField: "english_audio",
			prefix: "EN",
			hashField: "korean_audio_hash",
		});
		expect(validateTargets([korean, clash])).toContain(
			'Two targets write to "korean_audio_hash". Each one needs its own.',
		);
	});

	it("refuses a target writing to a property another target speaks", () => {
		const clash = target({ id: "t2", textField: "english", audioField: "korean" });
		expect(validateTargets([korean, clash])).toContain(
			'"korean" is spoken by one target and written by another.',
		);
	});

	it("refuses two targets sharing a prefix", () => {
		expect(validateTargets([korean, target({ ...english, prefix: "KR" })])).toEqual([
			'Two targets share the prefix "KR". Each one needs its own.',
		]);
	});

	it("refuses two targets that both have no prefix", () => {
		const bare = [target({ prefix: "" }), target({ ...english, prefix: "" })];
		expect(validateTargets(bare)).toEqual([
			"Two targets have no prefix, so their files collide. Give each one a prefix.",
		]);
	});

	it("reports every problem at once, not just the first", () => {
		const problems = validateTargets([target({ textField: "" }), target({ id: "t2" })]);
		expect(problems.length).toBeGreaterThan(1);
	});
});
