import { describe, expect, it } from "vitest";
import { planBatch, type PlanDeps } from "./plan";
import {
	DEFAULT_SETTINGS,
	createAudioTarget,
	createBatchPreset,
	createProfile,
	type PluginSettings,
} from "../settings/types";
import type { NoteRecord } from "../ports";
import { synthesisHash, synthesisInputs } from "./hash";
import type { BatchItem, BatchPreset } from "./types";

const korean = createProfile({
	id: "kr",
	name: "Korean",
	locale: "ko-KR",
	voiceId: "ko-KR-SunHiNeural",
});

const english = createProfile({
	id: "en",
	name: "English",
	locale: "en-US",
	voiceId: "en-US-JennyNeural",
});

const settings = (partial: Partial<PluginSettings> = {}): PluginSettings => ({
	...DEFAULT_SETTINGS,
	profiles: [korean, english],
	defaultProfileId: "kr",
	output: { ...DEFAULT_SETTINGS.output, defaultFolder: "Audio" },
	...partial,
});

const deps = (partial: Partial<PlanDeps> = {}): PlanDeps => ({
	settings: settings(),
	output: () => ({ ok: true, extension: "mp3" }),
	resolveLink: () => null,
	exists: () => false,
	formatDate: (format) => format,
	now: new Date("2026-08-19T12:00:00Z"),
	...partial,
});

const koreanTarget = createAudioTarget({
	id: "t-kr",
	textField: "korean",
	audioField: "korean_audio",
	prefix: "KR-",
	profileId: "kr",
});

const englishTarget = createAudioTarget({
	id: "t-en",
	textField: "english",
	audioField: "english_audio",
	prefix: "EN-",
	profileId: "en",
});

const preset = (partial: Partial<BatchPreset> = {}): BatchPreset =>
	createBatchPreset({
		id: "p1",
		name: "Deck",
		filter: { property: "type", value: "Flashcard" },
		targets: [koreanTarget, englishTarget],
		...partial,
	});

const note = (
	frontmatter: Record<string, unknown>,
	basename = "annyeong",
): NoteRecord => ({
	path: `Cards/${basename}.md`,
	basename,
	frontmatter,
});

const card = (extra: Record<string, unknown> = {}) =>
	note({ type: "[[Flashcard]]", korean: "안녕하세요", english: "hello", ...extra });

/** The item for one target, so a test names the target rather than an index. */
function forTarget(items: readonly BatchItem[], targetId: string): BatchItem {
	const item = items.find((i) => i.targetId === targetId);
	if (!item) throw new Error(`expected an item for ${targetId}`);
	return item;
}

describe("planBatch", () => {
	it("takes only the notes the filter selects", () => {
		const notes = [card(), note({ type: "[[Vocabulary]]", korean: "hi" }, "other")];
		const plan = planBatch(notes, preset(), deps());

		expect(plan.totals.notes).toBe(1);
		expect(plan.items.every((i) => i.notePath === "Cards/annyeong.md")).toBe(true);
	});

	it("makes one item per note and target", () => {
		const plan = planBatch([card(), card()], preset(), deps());

		expect(plan.items).toHaveLength(4);
		expect(plan.totals).toMatchObject({ notes: 2, targets: 2 });
	});

	it("carries the preset identity for a report to name", () => {
		const plan = planBatch([card()], preset(), deps());
		expect(plan).toMatchObject({ presetId: "p1", presetName: "Deck" });
	});
});

describe("what a batch decides per target", () => {
	it("is pending for one target while the other is already done", () => {
		const notes = [card({ korean_audio: "[[KR-안녕하세요.mp3]]" })];
		const plan = planBatch(
			notes,
			preset(),
			deps({ resolveLink: () => "Audio/KR-안녕하세요.mp3" }),
		);

		expect(forTarget(plan.items, "t-kr").status).toBe("done");
		expect(forTarget(plan.items, "t-en").status).toBe("pending");
		expect(plan.totals.billable).toBe(1);
	});

	it("is pending when the link points at a file that is gone", () => {
		const notes = [card({ korean_audio: "[[KR-gone.mp3]]" })];
		const plan = planBatch(notes, preset(), deps());

		expect(forTarget(plan.items, "t-kr").status).toBe("pending");
	});

	it("relinks a clip whose file outlived its link", () => {
		const plan = planBatch(
			[card()],
			preset({ targets: [koreanTarget] }),
			deps({ exists: (path) => path === "Audio/KR-안녕하세요.mp3" }),
		);

		const item = forTarget(plan.items, "t-kr");
		expect(item.status).toBe("relink");
		expect(item.path).toBe("Audio/KR-안녕하세요.mp3");
		expect(plan.totals.billable).toBe(0);
	});

	it("skips a target whose property is empty or absent", () => {
		const plan = planBatch(
			[card({ korean: "  ", english: undefined })],
			preset(),
			deps(),
		);

		expect(forTarget(plan.items, "t-kr").status).toBe("no-text");
		expect(forTarget(plan.items, "t-en").status).toBe("no-text");
		expect(plan.totals.characters).toBe(0);
	});

	it("reports a target that names a profile which no longer exists", () => {
		const gone = createAudioTarget({ ...koreanTarget, profileId: "deleted" });
		const plan = planBatch([card()], preset({ targets: [gone] }), deps());

		expect(forTarget(plan.items, gone.id).status).toBe("no-profile");
	});

	it("uses the default profile when a target names none", () => {
		const bare = createAudioTarget({ ...koreanTarget, profileId: undefined });
		const plan = planBatch([card()], preset({ targets: [bare] }), deps());

		expect(forTarget(plan.items, bare.id).status).toBe("pending");
	});

	it("reports every refusal a provider can give, before anything is billed", () => {
		const refuse = (reason: "unknown-provider" | "not-configured" | "cannot-render") =>
			planBatch([card()], preset(), deps({ output: () => ({ ok: false, reason }) }));

		expect(refuse("unknown-provider").items[0]?.status).toBe("unknown-provider");
		expect(refuse("not-configured").items[0]?.status).toBe("not-configured");
		expect(refuse("cannot-render").items[0]?.status).toBe("cannot-render");
		expect(refuse("not-configured").totals.characters).toBe(0);
	});
});

describe("change tracking", () => {
	const hashOf = (text: string) => synthesisHash(synthesisInputs(korean, text));

	const linked = (extra: Record<string, unknown>) =>
		planBatch(
			[card({ korean_audio: "[[KR-안녕하세요.mp3]]", ...extra })],
			preset({ targets: [koreanTarget] }),
			deps({ resolveLink: () => "Audio/KR-안녕하세요.mp3" }),
		);

	it("leaves an unchanged card done", () => {
		const plan = linked({ korean_audio_hash: hashOf("안녕하세요") });
		expect(forTarget(plan.items, "t-kr").status).toBe("done");
	});

	it("marks a card stale when the recorded hash no longer matches", () => {
		const plan = linked({ korean_audio_hash: hashOf("안녕히 가세요") });
		const item = forTarget(plan.items, "t-kr");

		expect(item.status).toBe("stale");
		expect(plan.totals.billable).toBe(1);
	});

	it("does not mark a card stale when no hash was ever recorded", () => {
		expect(forTarget(linked({}).items, "t-kr").status).toBe("done");
	});

	it("ignores a recorded hash when the preset does not track changes", () => {
		const plan = planBatch(
			[card({ korean_audio: "[[KR-안녕하세요.mp3]]", korean_audio_hash: "stale" })],
			preset({ trackChanges: false }),
			deps({ resolveLink: () => "Audio/KR-안녕하세요.mp3" }),
		);

		expect(forTarget(plan.items, "t-kr").status).toBe("done");
	});

	it("reads the hash from the property a target names", () => {
		const named = createAudioTarget({ ...koreanTarget, hashField: "kr_fingerprint" });
		const plan = planBatch(
			[card({ korean_audio: "[[KR-안녕하세요.mp3]]", kr_fingerprint: "stale" })],
			preset({ targets: [named] }),
			deps({ resolveLink: () => "Audio/KR-안녕하세요.mp3" }),
		);

		expect(forTarget(plan.items, named.id).status).toBe("stale");
	});
});

describe("naming", () => {
	it("puts the prefix in front of the expanded template", () => {
		const plan = planBatch([card()], preset(), deps());
		expect(forTarget(plan.items, "t-kr").path).toBe("Audio/KR-안녕하세요.mp3");
	});

	it("names the file after one property when nameFrom is set", () => {
		const named = createAudioTarget({ ...koreanTarget, nameFrom: "hanja" });
		const plan = planBatch(
			[card({ hanja: "安寧" })],
			preset({ targets: [named] }),
			deps(),
		);

		expect(forTarget(plan.items, named.id).path).toBe("Audio/KR-安寧.mp3");
	});

	it("falls back to the note title when the nameFrom property is empty", () => {
		const named = createAudioTarget({ ...koreanTarget, nameFrom: "hanja" });
		const plan = planBatch([card()], preset({ targets: [named] }), deps());

		expect(forTarget(plan.items, named.id).path).toBe("Audio/KR-annyeong.mp3");
	});

	it("honours the profile and global template chain", () => {
		const withTemplate = settings({
			output: {
				...DEFAULT_SETTINGS.output,
				defaultFolder: "Audio",
				nameTemplate: "{{title}}",
			},
		});
		const plan = planBatch([card()], preset(), deps({ settings: withTemplate }));

		expect(forTarget(plan.items, "t-kr").path).toBe("Audio/KR-annyeong.mp3");
	});

	it("saves into the folder the profile resolves to", () => {
		const elsewhere = settings({
			profiles: [{ ...korean, outputFolder: "Audio/Korean" }, english],
		});
		const plan = planBatch([card()], preset(), deps({ settings: elsewhere }));

		expect(forTarget(plan.items, "t-kr").path).toBe("Audio/Korean/KR-안녕하세요.mp3");
	});

	it("reports a template property the note does not supply", () => {
		const asking = settings({
			output: {
				...DEFAULT_SETTINGS.output,
				defaultFolder: "Audio",
				nameTemplate: "{{property:deck}}",
			},
		});
		const plan = planBatch([card()], preset(), deps({ settings: asking }));
		const item = forTarget(plan.items, "t-kr");

		// The name still resolves, to the note title, so this is a warning and
		// never a refusal: a batch cannot stop to ask.
		expect(item.missingProperties).toEqual(["deck"]);
		expect(item.path).toBe("Audio/KR-annyeong.mp3");
		expect(item.status).toBe("pending");
	});

	it("strips a character no filesystem accepts", () => {
		const plan = planBatch([card({ korean: "what?" })], preset(), deps());
		expect(forTarget(plan.items, "t-kr").path).toBe("Audio/KR-what.mp3");
	});
});

describe("totals", () => {
	it("counts characters of the prepared text, for billable items only", () => {
		const notes = [card(), card({ korean_audio: "[[KR-안녕하세요.mp3]]" })];
		const plan = planBatch(
			notes,
			preset({ targets: [koreanTarget] }),
			deps({ resolveLink: () => "Audio/KR-안녕하세요.mp3" }),
		);

		expect(plan.totals.billable).toBe(1);
		expect(plan.totals.characters).toBe("안녕하세요".length);
	});

	it("counts every status, including the ones with no items", () => {
		const plan = planBatch([card()], preset(), deps());

		expect(plan.totals.byStatus).toMatchObject({
			pending: 2,
			stale: 0,
			done: 0,
			relink: 0,
			"no-text": 0,
			"no-profile": 0,
			"unknown-provider": 0,
			"not-configured": 0,
			"cannot-render": 0,
		});
	});

	it("reports nothing to do for a filter that matches no note", () => {
		const plan = planBatch(
			[card()],
			preset({ filter: { property: "type", value: "" } }),
			deps(),
		);

		expect(plan.items).toEqual([]);
		expect(plan.totals).toMatchObject({ notes: 0, billable: 0, characters: 0 });
	});
});
