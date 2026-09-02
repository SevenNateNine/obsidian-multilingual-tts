import { describe, expect, it } from "vitest";
import { migrateSettings } from "./migrations";
import {
	CURRENT_SCHEMA_VERSION,
	DEFAULT_SETTINGS,
	type PluginSettings,
	type ProviderInstance,
	type VoiceProfile,
} from "./types";

/** Migrate `raw` and return its first profile, so a test can index it directly. */
function firstProfile(raw: unknown): VoiceProfile {
	const [profile] = migrateSettings(raw).profiles;
	if (!profile) throw new Error("expected migrateSettings to keep one profile");
	return profile;
}

function provider(settings: PluginSettings, id: string): ProviderInstance {
	const instance = settings.providers.find((p) => p.id === id);
	if (!instance) throw new Error(`expected a provider with id ${id}`);
	return instance;
}

/** A schema 2 payload: one Azure block, and profiles naming an engine. */
const schema2 = {
	schemaVersion: 2,
	azure: { key: "obf:abc", region: "eastus", keyStorage: "obfuscated" },
	profiles: [
		{ id: "a", name: "French", provider: "azure", locale: "fr-FR", voiceId: "v" },
	],
};

describe("the context menu block", () => {
	it("offers every action to a vault written before the option existed", () => {
		expect(migrateSettings({ schemaVersion: 3 }).menu).toEqual({
			read: true,
			save: true,
			link: true,
			linkStyle: "wikilink",
		});
	});

	it("keeps the stored choices", () => {
		const result = migrateSettings({
			menu: { read: false, save: true, link: false, linkStyle: "markdown" },
		});

		expect(result.menu.read).toBe(false);
		expect(result.menu.linkStyle).toBe("markdown");
	});

	it("falls back on a link style this build does not know", () => {
		const result = migrateSettings({ menu: { linkStyle: "hyperlink" } });
		expect(result.menu.linkStyle).toBe("wikilink");
	});

	it("ignores a flag that is not a boolean", () => {
		const result = migrateSettings({ menu: { save: "yes" } });
		expect(result.menu.save).toBe(true);
	});
});

describe("name templates", () => {
	it("defaults the global template to the built-in name", () => {
		expect(migrateSettings({}).output.nameTemplate).toBe("");
	});

	// A number here would throw on `.trim()` when the name is resolved.
	it("drops a global template that is not text", () => {
		expect(migrateSettings({ output: { nameTemplate: 7 } }).output.nameTemplate).toBe(
			"",
		);
	});

	it("does not ask about a missing property until the option is turned on", () => {
		expect(migrateSettings({}).output.askForMissingProperty).toBe(false);
		expect(
			migrateSettings({ output: { askForMissingProperty: true } }).output
				.askForMissingProperty,
		).toBe(true);
		expect(
			migrateSettings({ output: { askForMissingProperty: "yes" } }).output
				.askForMissingProperty,
		).toBe(false);
	});

	it("keeps a profile template and drops one that is not text", () => {
		const result = migrateSettings({
			profiles: [
				{ id: "a", nameTemplate: "{{default}}_drill" },
				{ id: "b", nameTemplate: 7 },
			],
		});

		expect(result.profiles[0]?.nameTemplate).toBe("{{default}}_drill");
		expect(result.profiles[1]?.nameTemplate).toBeUndefined();
	});
});

describe("the after-save block", () => {
	const afterSave = (raw: unknown) =>
		migrateSettings({ output: { afterSave: raw } }).output.afterSave;

	it("asks after every save in a vault written before schema 6", () => {
		expect(migrateSettings({ schemaVersion: 5 }).output.afterSave).toEqual({
			mode: "ask",
			property: "",
			existingValue: "ask",
		});
	});

	it("keeps the stored choices, with the property trimmed", () => {
		expect(
			afterSave({ mode: "property", property: " audio ", existingValue: "append" }),
		).toEqual({
			mode: "property",
			property: "audio",
			existingValue: "append",
		});
	});

	it("falls back on a mode or an answer this build does not know", () => {
		expect(afterSave({ mode: "always", existingValue: 7 })).toEqual({
			mode: "ask",
			property: "",
			existingValue: "ask",
		});
	});

	it("drops a property that is not text, and a block that is not an object", () => {
		expect(afterSave({ property: 3 }).property).toBe("");
		expect(afterSave("nonsense").mode).toBe("ask");
	});
});

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
		const result = migrateSettings({ autoDetect: { enabled: true } });
		expect(result.autoDetect.enabled).toBe(true);
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

	describe("providers", () => {
		it("gives a fresh install only the device voices", () => {
			const { providers } = migrateSettings(null);
			expect(providers).toHaveLength(1);
			expect(providers[0]?.id).toBe("system");
			expect(providers[0]?.type).toBe("system");
		});

		it("turns the schema 2 Azure block into an instance", () => {
			const result = migrateSettings(schema2);
			const azure = provider(result, "azure");

			expect(azure.type).toBe("azure");
			expect(azure.config).toEqual({ key: "obf:abc", region: "eastus" });
			expect(azure.keyStorage).toBe("obfuscated");
		});

		// The key stays at rest. Only the composition root ever decodes it.
		it("carries the stored key across untouched", () => {
			const raw = { azure: { key: "enc:envelope", keyStorage: "passphrase" } };
			const azure = provider(migrateSettings(raw), "azure");

			expect(azure.config.key).toBe("enc:envelope");
			expect(azure.keyStorage).toBe("passphrase");
		});

		// A stale block would leave a speech key in data.json after the provider
		// that owns it is deleted.
		it("drops the old azure block from the result", () => {
			expect(migrateSettings(schema2)).not.toHaveProperty("azure");
		});

		it("adds no Azure instance for a user who never configured one", () => {
			const { providers } = migrateSettings({ azure: { key: "", region: "" } });
			expect(providers.map((p) => p.type)).toEqual(["system"]);
		});

		// Without this the profile would point at an instance that never existed.
		it("adds an Azure instance when only a profile names it", () => {
			const raw = { profiles: [{ id: "a", name: "A", provider: "azure" }] };
			expect(provider(migrateSettings(raw), "azure").type).toBe("azure");
		});

		it("keeps a schema 3 provider list as it is", () => {
			const stored = {
				providers: [
					{ id: "system", type: "system", name: "Device", config: {} },
					{
						id: "uuid-1",
						type: "azure",
						name: "Azure work",
						config: { key: "k", region: "westus" },
						keyStorage: "plain",
					},
				],
			};
			const result = migrateSettings(stored);

			expect(result.providers).toHaveLength(2);
			expect(provider(result, "uuid-1").name).toBe("Azure work");
			expect(provider(result, "uuid-1").keyStorage).toBe("plain");
			expect(provider(result, "system").name).toBe("Device");
		});

		// A build that does not know the engine cannot run it, and offering it
		// would give the user a provider that fails on every read.
		it("drops an instance whose engine this build does not have", () => {
			const raw = {
				providers: [{ id: "x", type: "elevenlabs", name: "Eleven", config: {} }],
			};
			expect(migrateSettings(raw).providers.map((p) => p.id)).toEqual(["system"]);
		});

		it("drops a duplicate id, which would shadow the first entry", () => {
			const raw = {
				providers: [
					{ id: "dup", type: "azure", name: "First", config: { region: "a" } },
					{ id: "dup", type: "azure", name: "Second", config: { region: "b" } },
				],
			};
			const result = migrateSettings(raw);

			expect(result.providers.filter((p) => p.id === "dup")).toHaveLength(1);
			expect(provider(result, "dup").name).toBe("First");
		});

		it("adds the device voices back when the stored list lost them", () => {
			const raw = {
				providers: [{ id: "uuid-1", type: "azure", name: "Azure", config: {} }],
			};
			expect(migrateSettings(raw).providers.map((p) => p.id)).toEqual([
				"system",
				"uuid-1",
			]);
		});

		// There is one device, so a second system entry is a hand edit.
		it("refuses a second device provider at another id", () => {
			const raw = {
				providers: [
					{ id: "system", type: "system", name: "Device", config: {} },
					{ id: "other", type: "system", name: "Device again", config: {} },
				],
			};
			expect(migrateSettings(raw).providers.map((p) => p.id)).toEqual(["system"]);
		});

		it("keeps only the config keys the engine declares", () => {
			const raw = {
				providers: [
					{
						id: "uuid-1",
						type: "azure",
						name: "Azure",
						config: { key: "k", region: "westus", oldSecret: "leftover" },
					},
				],
			};
			expect(provider(migrateSettings(raw), "uuid-1").config).toEqual({
				key: "k",
				region: "westus",
			});
		});

		it("survives a config value of the wrong type", () => {
			const raw = { azure: { key: 42, region: null } };
			const { providers } = migrateSettings(raw);
			// Nothing usable was stored, so no instance is worth creating.
			expect(providers.map((p) => p.type)).toEqual(["system"]);
		});

		it("replaces a key storage mode it does not know", () => {
			const raw = { azure: { key: "abc", keyStorage: "rot13" } };
			expect(provider(migrateSettings(raw), "azure").keyStorage).toBe("obfuscated");
		});

		/**
		 * Schema 1 has no keyStorage and an unprefixed key. Taking the default is
		 * safe because `decodeKey` reads the prefix, not this field.
		 */
		it("leaves a schema 1 key untouched while defaulting the mode", () => {
			const azure = provider(
				migrateSettings({ schemaVersion: 1, azure: { key: "abc" } }),
				"azure",
			);
			expect(azure.config.key).toBe("abc");
			expect(azure.keyStorage).toBe("obfuscated");
		});
	});

	describe("profiles", () => {
		const stored = {
			id: "abc",
			name: "French",
			description: "Slow",
			providerId: "system",
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

		it("points a schema 2 engine name at the instance it became", () => {
			expect(firstProfile(schema2).providerId).toBe("azure");
		});

		it("falls back to the device voices for an engine that never existed", () => {
			const profile = firstProfile({
				profiles: [{ ...stored, providerId: undefined, provider: "elevenlabs" }],
			});
			expect(profile.providerId).toBe("system");
		});

		/**
		 * The user may have deleted a provider they intend to add back. Rewriting
		 * the field would silently replace their chosen voice with a device one.
		 */
		it("keeps a provider id that no instance has", () => {
			const profile = firstProfile({
				profiles: [{ ...stored, providerId: "deleted-uuid" }],
			});
			expect(profile.providerId).toBe("deleted-uuid");
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
});

describe("the batch block", () => {
	const preset = (partial: Record<string, unknown> = {}) => ({
		id: "p1",
		name: "Korean deck",
		filter: { property: "type", value: "[[Flashcard]]" },
		targets: [
			{ id: "t1", textField: "korean", audioField: "korean_audio", prefix: "KR" },
		],
		...partial,
	});

	const presets = (raw: unknown) =>
		migrateSettings({ batch: { presets: raw } }).batch.presets;

	it("defaults to no presets for a vault written before schema 5", () => {
		expect(migrateSettings({ schemaVersion: 4 }).batch).toEqual({ presets: [] });
	});

	it("keeps a well-formed preset whole", () => {
		const [kept] = presets([preset()]);
		expect(kept).toEqual({
			id: "p1",
			name: "Korean deck",
			filter: { property: "type", value: "[[Flashcard]]" },
			targets: [
				{
					id: "t1",
					textField: "korean",
					audioField: "korean_audio",
					prefix: "KR",
					nameFrom: undefined,
					profileId: undefined,
					hashField: undefined,
				},
			],
			trackChanges: true,
		});
	});

	it("drops a preset with no id, which nothing could ever run", () => {
		expect(presets([preset({ id: "" })])).toEqual([]);
		expect(presets([preset({ id: undefined })])).toEqual([]);
	});

	it("drops a duplicate id rather than shadowing the first preset", () => {
		const kept = presets([preset(), preset({ name: "Second" })]);
		expect(kept).toHaveLength(1);
		expect(kept[0]?.name).toBe("Korean deck");
	});

	it("drops a preset that is not an object, and a presets list that is not an array", () => {
		expect(presets(["nonsense", 3, null])).toEqual([]);
		expect(presets("nonsense")).toEqual([]);
		expect(migrateSettings({ batch: "nonsense" }).batch).toEqual({ presets: [] });
	});

	it("defaults a missing name and a missing filter", () => {
		const [kept] = presets([{ id: "p1" }]);
		expect(kept?.name).toBe("Batch");
		expect(kept?.filter).toEqual({ property: "", value: "" });
		expect(kept?.targets).toEqual([]);
	});

	it("reads change tracking as on unless it was turned off", () => {
		expect(presets([preset()])[0]?.trackChanges).toBe(true);
		expect(presets([preset({ trackChanges: false })])[0]?.trackChanges).toBe(false);
		expect(presets([preset({ trackChanges: "yes" })])[0]?.trackChanges).toBe(true);
	});

	it("drops a target that is not an object, and a targets list that is not an array", () => {
		expect(presets([preset({ targets: ["nonsense", 7] })])[0]?.targets).toEqual([]);
		expect(presets([preset({ targets: "nonsense" })])[0]?.targets).toEqual([]);
	});

	it("gives a target with no id one of its own, rather than dropping it", () => {
		const target = { textField: "korean", audioField: "korean_audio", prefix: "KR" };
		const [kept] = presets([preset({ targets: [target] })]);
		expect(kept?.targets).toHaveLength(1);
		expect(kept?.targets[0]?.id).toBeTruthy();
	});

	it("defaults a target field that is not a string", () => {
		const target = { id: "t1", textField: 7, audioField: null, prefix: {} };
		const [kept] = presets([preset({ targets: [target] })]);
		expect(kept?.targets[0]).toMatchObject({
			textField: "",
			audioField: "",
			prefix: "",
		});
	});

	it("leaves an empty optional field absent rather than empty", () => {
		const target = { id: "t1", nameFrom: "  ", profileId: "", hashField: 3 };
		const [kept] = presets([preset({ targets: [target] })]);
		expect(kept?.targets[0]?.nameFrom).toBeUndefined();
		expect(kept?.targets[0]?.profileId).toBeUndefined();
		expect(kept?.targets[0]?.hashField).toBeUndefined();
	});

	it("carries the optional fields through when they are set", () => {
		const target = {
			id: "t1",
			nameFrom: "hanja",
			profileId: "prof-1",
			hashField: "kh",
		};
		const [kept] = presets([preset({ targets: [target] })]);
		expect(kept?.targets[0]).toMatchObject({
			nameFrom: "hanja",
			profileId: "prof-1",
			hashField: "kh",
		});
	});
});
