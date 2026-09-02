import { describe, expect, it } from "vitest";
import {
	decideAfterSave,
	propertyCandidates,
	rememberChoice,
	writePropertyLink,
} from "./afterSave";
import type { AfterSaveSettings } from "../settings/afterSave";
import type { NotePropertyStore, NoteRecord } from "../ports";

const LINK = "[[Audio/hello.mp3]]";

function settings(partial: Partial<AfterSaveSettings> = {}): AfterSaveSettings {
	return { mode: "ask", property: "audio", existingValue: "ask", ...partial };
}

const both = { hasSelection: true, hasNote: true, existing: undefined };

describe("decideAfterSave", () => {
	it("does nothing when turned off", () => {
		expect(decideAfterSave(settings({ mode: "none" }), both)).toEqual({ kind: "none" });
	});

	it("does nothing when neither target exists", () => {
		const ctx = { hasSelection: false, hasNote: false, existing: undefined };
		expect(decideAfterSave(settings(), ctx)).toEqual({ kind: "none" });
	});

	it("links the selection without asking when so configured", () => {
		expect(decideAfterSave(settings({ mode: "selection" }), both)).toEqual({
			kind: "selection",
		});
	});

	it("asks, without the selection option, when there is no selection to link", () => {
		const ctx = { ...both, hasSelection: false };
		expect(decideAfterSave(settings({ mode: "selection" }), ctx)).toEqual({
			kind: "ask",
			offerSelection: false,
			offerProperty: true,
		});
	});

	it("writes an empty property without asking", () => {
		expect(decideAfterSave(settings({ mode: "property" }), both)).toEqual({
			kind: "property",
			property: "audio",
			existingValue: "replace",
		});
	});

	it("applies the configured answer to a filled property", () => {
		const ctx = { ...both, existing: "[[old.mp3]]" };
		expect(
			decideAfterSave(settings({ mode: "property", existingValue: "append" }), ctx),
		).toEqual({ kind: "property", property: "audio", existingValue: "append" });
	});

	it("asks about a filled property when the answer is not configured", () => {
		const ctx = { ...both, existing: "[[old.mp3]]" };
		expect(decideAfterSave(settings({ mode: "property" }), ctx)).toEqual({
			kind: "ask",
			offerSelection: true,
			offerProperty: true,
		});
	});

	it("asks when the property has no name yet", () => {
		expect(
			decideAfterSave(settings({ mode: "property", property: " " }), both),
		).toEqual({ kind: "ask", offerSelection: true, offerProperty: true });
	});

	it("offers only the selection when no note is open", () => {
		const ctx = { ...both, hasNote: false };
		expect(decideAfterSave(settings({ mode: "property" }), ctx)).toEqual({
			kind: "ask",
			offerSelection: true,
			offerProperty: false,
		});
	});
});

describe("propertyCandidates", () => {
	const note = (path: string, frontmatter: Record<string, unknown>): NoteRecord => ({
		path,
		basename: path,
		frontmatter,
	});

	it("puts the configured key first, then the keys of the note in order", () => {
		const active = { type: "card", korean: "x", audio: "" };
		expect(propertyCandidates("audio", active, [])).toEqual([
			"audio",
			"type",
			"korean",
		]);
	});

	it("adds the keys of other notes by how many notes carry them", () => {
		const notes = [
			note("a", { rare: 1, common: 1 }),
			note("b", { common: 1 }),
			note("c", { common: 1, other: 1 }),
		];
		expect(propertyCandidates("", {}, notes)).toEqual(["common", "rare", "other"]);
	});

	it("drops blanks and duplicates, and stops at the limit", () => {
		const notes = [note("a", { " ": 1, b: 1, c: 1, d: 1 })];
		expect(propertyCandidates(" ", { b: 1 }, notes, 2)).toEqual(["b", "c"]);
	});
});

describe("rememberChoice", () => {
	it("turns the step off after a skip", () => {
		expect(rememberChoice(settings(), null, false).mode).toBe("none");
	});

	it("keeps the property when the selection is chosen", () => {
		expect(rememberChoice(settings(), { target: "selection" }, false)).toEqual(
			settings({ mode: "selection" }),
		);
	});

	it("stores the property, and the answer only when it was asked", () => {
		const choice = {
			target: "property",
			property: "clip",
			existingValue: "append",
		} as const;
		expect(rememberChoice(settings(), choice, false)).toEqual(
			settings({ mode: "property", property: "clip", existingValue: "ask" }),
		);
		expect(rememberChoice(settings(), choice, true)).toEqual(
			settings({ mode: "property", property: "clip", existingValue: "append" }),
		);
	});
});

describe("writePropertyLink", () => {
	function fakeStore(current: unknown): NotePropertyStore & { written: unknown[] } {
		return {
			written: [],
			current: () => current,
			update(_path, _property, next) {
				this.written.push(next(current));
				return Promise.resolve();
			},
		};
	}

	const request = (existingValue: "replace" | "append") => ({
		notePath: "note.md",
		property: "audio",
		link: LINK,
		existingValue,
	});

	it("writes the merged value through the store", async () => {
		const store = fakeStore("[[old.mp3]]");
		const result = await writePropertyLink({ properties: store }, request("append"));
		expect(result).toEqual({ changed: true });
		expect(store.written).toEqual([["[[old.mp3]]", LINK]]);
	});

	it("does not write when an append finds the link already there", async () => {
		const store = fakeStore(["[[old.mp3]]", LINK]);
		const result = await writePropertyLink({ properties: store }, request("append"));
		expect(result).toEqual({ changed: false });
		expect(store.written).toEqual([]);
	});

	it("does not write when a replace would write the same scalar", async () => {
		const store = fakeStore("![[Audio/hello.mp3]]");
		expect(await writePropertyLink({ properties: store }, request("replace"))).toEqual({
			changed: false,
		});
	});

	it("still replaces a list that holds the link among others", async () => {
		const store = fakeStore(["[[old.mp3]]", LINK]);
		await writePropertyLink({ properties: store }, request("replace"));
		expect(store.written).toEqual([LINK]);
	});
});
