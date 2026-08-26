import { describe, expect, it } from "vitest";
import { resolveAudioFormat, type PluginSettings } from "./types";

const settings = (defaultFormat: string): Pick<PluginSettings, "output"> => ({
	output: {
		defaultFolder: "Audio",
		defaultFormat,
		insertPlayerAtCursor: false,
	},
});

describe("resolveAudioFormat", () => {
	it("uses the profile format when set", () => {
		expect(
			resolveAudioFormat({ audioFormat: "wav-24khz-16bit" }, settings("mp3")),
		).toBe("wav-24khz-16bit");
	});

	it("inherits the global default when the profile has none", () => {
		expect(resolveAudioFormat({}, settings("mp3-24khz-160k"))).toBe("mp3-24khz-160k");
		expect(resolveAudioFormat({ audioFormat: undefined }, settings("mp3"))).toBe("mp3");
	});

	it("leaves the choice to the provider when neither is set", () => {
		expect(resolveAudioFormat({}, settings(""))).toBeUndefined();
		expect(resolveAudioFormat({ audioFormat: "" }, settings(""))).toBeUndefined();
	});
});
