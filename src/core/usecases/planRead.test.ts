import { describe, expect, it } from "vitest";
import { planRead } from "./planRead";
import { DEFAULT_SETTINGS, createProfile } from "../settings/types";
import type { PluginSettings } from "../settings/types";
import type { Detector } from "../text/detectLanguage";

const never: Detector = () => "und";

function settingsWith(overrides: Partial<PluginSettings> = {}): PluginSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

const french = createProfile({ name: "French", locale: "fr-FR", voiceId: "fr" });
const english = createProfile({ name: "English", locale: "en-US", voiceId: "en" });

describe("planRead", () => {
	it("refuses when nothing survives preparation", () => {
		const settings = settingsWith({ profiles: [english] });
		expect(planRead(settings, "   ", never)).toEqual({
			ok: false,
			reason: "empty-text",
		});
	});

	it("refuses when there is no profile to read with", () => {
		expect(planRead(settingsWith(), "Some readable text.", never)).toEqual({
			ok: false,
			reason: "no-profile",
		});
	});

	// Detection runs on the prepared text, because markdown syntax and URLs
	// skew the result. The caller then speaks that same text.
	it("returns the prepared text, not the raw text", () => {
		const settings = settingsWith({ profiles: [english] });
		const plan = planRead(settings, "# Heading\n\nSome **bold** text.", never);

		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.text).toBe("Heading\n\nSome bold text.");
	});

	it("falls back to the default profile when detection is off", () => {
		const settings = settingsWith({
			profiles: [french, english],
			defaultProfileId: english.id,
		});
		const plan = planRead(settings, "Un texte assez long en français.", never);

		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.selection.profile.id).toBe(english.id);
		expect(plan.selection.reason).toBe("disabled");
	});

	it("uses the injected detector when detection is on", () => {
		const settings = settingsWith({
			profiles: [french, english],
			defaultProfileId: english.id,
			autoDetect: { enabled: true, minChars: 5 },
		});
		const plan = planRead(settings, "A long enough piece of text.", () => "fra");

		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.selection.profile.id).toBe(french.id);
		expect(plan.selection.reason).toBe("detected");
	});
});
