import { describe, expect, it } from "vitest";
import { starterProfile } from "./starterProfile";
import type { VoiceInfo } from "../tts/types";

const voice: VoiceInfo = {
	id: "urn:moz-tts:sapi:Microsoft David",
	displayName: "Microsoft David",
	locale: "en-GB",
	styles: [],
	roles: [],
};

describe("starterProfile", () => {
	it("names the profile after the voice of the platform", () => {
		const profile = starterProfile(voice);

		expect(profile.name).toBe("System — Microsoft David");
		expect(profile.providerId).toBe("system");
		expect(profile.voiceId).toBe(voice.id);
		expect(profile.locale).toBe("en-GB");
	});

	// A device can report no voices at all. The profile must still be usable
	// enough to open the editor and pick a voice by hand.
	it("still produces a usable profile when the device reports no voice", () => {
		const profile = starterProfile(null);

		expect(profile.name).toBe("System voice");
		expect(profile.providerId).toBe("system");
		expect(profile.voiceId).toBe("");
		expect(profile.locale).toBe("en-US");
	});

	it("says in the description that it can be replaced", () => {
		expect(starterProfile(voice).description).toMatch(/edit or replace/i);
	});
});
