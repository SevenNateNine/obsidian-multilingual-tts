import { describe, expect, it } from "vitest";
import { synthesisHash, synthesisInputs, type SynthesisInputs } from "./hash";
import { createProfile } from "../settings/types";

const base: SynthesisInputs = {
	text: "안녕하세요",
	locale: "ko-KR",
	voiceId: "ko-KR-SunHiNeural",
	rate: 1,
	pitch: 0,
	volume: 100,
};

const changed = (partial: Partial<SynthesisInputs>) =>
	synthesisHash({ ...base, ...partial });

describe("synthesisHash", () => {
	it("is stable for the same inputs", () => {
		expect(synthesisHash(base)).toBe(synthesisHash({ ...base }));
	});

	it("is 16 hex characters", () => {
		expect(synthesisHash(base)).toMatch(/^[0-9a-f]{16}$/);
	});

	it("does not depend on the order the object was built in", () => {
		const reordered: SynthesisInputs = {
			volume: 100,
			pitch: 0,
			rate: 1,
			voiceId: "ko-KR-SunHiNeural",
			locale: "ko-KR",
			text: "안녕하세요",
		};
		expect(synthesisHash(reordered)).toBe(synthesisHash(base));
	});

	it("changes when any input that reaches the service changes", () => {
		const original = synthesisHash(base);
		expect(changed({ text: "안녕히 가세요" })).not.toBe(original);
		expect(changed({ locale: "ko-KP" })).not.toBe(original);
		expect(changed({ voiceId: "ko-KR-InJoonNeural" })).not.toBe(original);
		expect(changed({ rate: 0.9 })).not.toBe(original);
		expect(changed({ pitch: 5 })).not.toBe(original);
		expect(changed({ volume: 80 })).not.toBe(original);
		expect(changed({ style: "cheerful" })).not.toBe(original);
		expect(changed({ styleDegree: 1.5 })).not.toBe(original);
		expect(changed({ role: "YoungAdultFemale" })).not.toBe(original);
	});

	it("reads an absent optional field as its default", () => {
		expect(changed({ style: undefined })).toBe(synthesisHash(base));
		expect(changed({ style: "" })).toBe(synthesisHash(base));
		expect(changed({ styleDegree: undefined })).toBe(synthesisHash(base));
	});

	it("does not confuse two fields whose values are swapped", () => {
		expect(changed({ locale: "a", voiceId: "b" })).not.toBe(
			changed({ locale: "b", voiceId: "a" }),
		);
	});

	it("separates values rather than concatenating them", () => {
		expect(changed({ text: "ab", locale: "c" })).not.toBe(
			changed({ text: "a", locale: "bc" }),
		);
	});
});

describe("synthesisInputs", () => {
	it("takes every delivery field from the profile", () => {
		const profile = createProfile(
			{
				locale: "ko-KR",
				voiceId: "ko-KR-SunHiNeural",
				rate: 1,
				pitch: 0,
				volume: 100,
			},
			() => "id",
		);
		expect(synthesisInputs(profile, "안녕하세요")).toEqual(base);
	});

	it("moves with the profile, so a voice change is a new hash", () => {
		const profile = createProfile({ voiceId: "one" }, () => "id");
		const swapped = { ...profile, voiceId: "two" };

		expect(synthesisHash(synthesisInputs(profile, "hi"))).not.toBe(
			synthesisHash(synthesisInputs(swapped, "hi")),
		);
	});
});
