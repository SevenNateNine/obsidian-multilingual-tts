import { describe, expect, it } from "vitest";
import { migrateSettings } from "./migrations";
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, type VoiceProfile } from "./types";

/** Migrate `raw` and return its first profile, so a test can index it directly. */
function firstProfile(raw: unknown): VoiceProfile {
	const [profile] = migrateSettings(raw).profiles;
	if (!profile) throw new Error("expected migrateSettings to keep one profile");
	return profile;
}

describe("migrateSettings", () => {
	it("returns defaults for a fresh install", () => {
		expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("ignores a non-object payload", () => {
		expect(migrateSettings("garbage").profiles).toEqual([]);
		expect(migrateSettings([1, 2, 3]).profiles).toEqual([]);
	});

	it("stamps the current schema version", () => {
		expect(migrateSettings({ schemaVersion: 0 }).schemaVersion).toBe(
			CURRENT_SCHEMA_VERSION,
		);
	});

	it("fills in nested groups that a stored payload omits", () => {
		const result = migrateSettings({ azure: { key: "abc" } });
		expect(result.azure.key).toBe("abc");
		expect(result.azure.region).toBe("");
		expect(result.output.defaultFolder).toBe(DEFAULT_SETTINGS.output.defaultFolder);
		expect(result.autoDetect.minChars).toBe(DEFAULT_SETTINGS.autoDetect.minChars);
	});

	it("keeps user values over defaults", () => {
		const result = migrateSettings({
			stripMarkdown: false,
			output: { defaultFolder: "Sound" },
		});
		expect(result.stripMarkdown).toBe(false);
		expect(result.output.defaultFolder).toBe("Sound");
	});

	describe("profiles", () => {
		const stored = {
			id: "abc",
			name: "French",
			description: "Slow",
			provider: "azure",
			locale: "fr-FR",
			voiceId: "fr-FR-DeniseNeural",
			rate: 1.2,
			pitch: -5,
			volume: 80,
			useForAutoDetect: true,
		};

		it("preserves a complete profile, id included", () => {
			expect(firstProfile({ profiles: [stored] })).toMatchObject(stored);
		});

		// Older data has no `pitch`. An undefined value becomes NaN downstream.
		it("defaults numeric fields the stored profile lacks", () => {
			const { pitch, ...withoutPitch } = stored;
			const profile = firstProfile({ profiles: [withoutPitch] });
			expect(profile.pitch).toBe(0);
			expect(Number.isFinite(profile.pitch)).toBe(true);
		});

		it("replaces non-finite numbers rather than propagating them", () => {
			const profile = firstProfile({
				profiles: [{ ...stored, rate: NaN, volume: "loud" }],
			});
			expect(profile.rate).toBe(1);
			expect(profile.volume).toBe(100);
		});

		it("mints an id when one is missing or blank", () => {
			const { id, ...withoutId } = stored;
			expect(firstProfile({ profiles: [withoutId] }).id).toBeTruthy();
			expect(firstProfile({ profiles: [{ ...stored, id: "" }] }).id).toBeTruthy();
		});

		it("gives distinct ids to two profiles that both lack one", () => {
			const { id, ...withoutId } = stored;
			const { profiles } = migrateSettings({
				profiles: [withoutId, { ...withoutId, name: "Other" }],
			});
			const ids = profiles.map((p) => p.id);
			expect(ids).toHaveLength(2);
			expect(ids[0]).not.toBe(ids[1]);
		});

		it("falls back to the system provider for an unknown one", () => {
			const profile = firstProfile({
				profiles: [{ ...stored, provider: "elevenlabs" }],
			});
			expect(profile.provider).toBe("system");
		});

		it("drops entries that are not objects", () => {
			expect(
				migrateSettings({ profiles: [stored, null, "x", 5] }).profiles,
			).toHaveLength(1);
		});

		it("treats a missing auto-detect flag as opted in", () => {
			const { useForAutoDetect, ...without } = stored;
			expect(firstProfile({ profiles: [without] }).useForAutoDetect).toBe(true);
		});
	});

	describe("defaultProfileId", () => {
		const profiles = [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		];

		it("keeps a default that still exists", () => {
			expect(
				migrateSettings({ profiles, defaultProfileId: "b" }).defaultProfileId,
			).toBe("b");
		});

		// A dangling default leaves the plugin with nothing to play.
		it("repoints a default whose profile was deleted", () => {
			expect(
				migrateSettings({ profiles, defaultProfileId: "gone" }).defaultProfileId,
			).toBe("a");
		});

		it("clears the default when no profiles remain", () => {
			expect(
				migrateSettings({ profiles: [], defaultProfileId: "gone" }).defaultProfileId,
			).toBeNull();
		});
	});

	describe("key storage", () => {
		it("defaults a fresh install to obfuscated", () => {
			expect(migrateSettings(null).azure.keyStorage).toBe("obfuscated");
		});

		it("keeps a stored mode", () => {
			const raw = { azure: { key: "abc", keyStorage: "passphrase" } };
			expect(migrateSettings(raw).azure.keyStorage).toBe("passphrase");
		});

		it("replaces a mode it does not know", () => {
			const raw = { azure: { key: "abc", keyStorage: "rot13" } };
			expect(migrateSettings(raw).azure.keyStorage).toBe("obfuscated");
		});

		/**
		 * Schema 1 has no keyStorage and an unprefixed key. Taking the default is
		 * safe because `decodeKey` reads the prefix, not this field.
		 */
		it("leaves a schema 1 key untouched while defaulting the mode", () => {
			const result = migrateSettings({ schemaVersion: 1, azure: { key: "abc" } });
			expect(result.azure.key).toBe("abc");
			expect(result.azure.keyStorage).toBe("obfuscated");
		});

		it("survives a key or region of the wrong type", () => {
			const raw = { azure: { key: 42, region: null } };
			expect(migrateSettings(raw).azure.key).toBe("");
			expect(migrateSettings(raw).azure.region).toBe("");
		});
	});
});
