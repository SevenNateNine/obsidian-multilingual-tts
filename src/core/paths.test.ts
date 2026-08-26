import { describe, expect, it } from "vitest";
import {
	joinVaultPath,
	normalizeVaultPath,
	resolveOutputFolder,
	sanitizeFilename,
	timestampSuffix,
	uniqueVaultPath,
	validateFolderPath,
} from "./paths";
import type { PluginSettings } from "./settings/types";

const settings = (defaultFolder: string): Pick<PluginSettings, "output"> => ({
	output: { defaultFolder, defaultFormat: "", insertPlayerAtCursor: false },
});

const ctrl = (code: number) => String.fromCharCode(code);

describe("normalizeVaultPath", () => {
	it("collapses separators and trims edges", () => {
		expect(normalizeVaultPath("//Audio//French//")).toBe("Audio/French");
		expect(normalizeVaultPath("Audio\\French")).toBe("Audio/French");
		expect(normalizeVaultPath("./Audio/./French")).toBe("Audio/French");
		expect(normalizeVaultPath("")).toBe("");
	});
});

describe("validateFolderPath", () => {
	it("accepts an empty value as the vault root", () => {
		expect(validateFolderPath("")).toBeNull();
		expect(validateFolderPath("   ")).toBeNull();
	});

	it("accepts ordinary vault-relative folders", () => {
		expect(validateFolderPath("Audio")).toBeNull();
		expect(validateFolderPath("Audio/French")).toBeNull();
	});

	it("allows spaces and hyphens, which are legal in folder names", () => {
		expect(validateFolderPath("My Audio")).toBeNull();
		expect(validateFolderPath("audio-clips/read-aloud")).toBeNull();
	});

	it("accepts non-ASCII folder names", () => {
		expect(validateFolderPath("音声/フランス語")).toBeNull();
	});

	it("rejects absolute and drive paths", () => {
		expect(validateFolderPath("/Audio")).toMatch(/relative/);
		expect(validateFolderPath("C:/Audio")).toMatch(/drive/);
		expect(validateFolderPath("C:\\Audio")).toMatch(/drive/);
	});

	it("rejects escaping the vault", () => {
		expect(validateFolderPath("../outside")).toMatch(/outside the vault/);
		expect(validateFolderPath("Audio/../../etc")).toMatch(/outside the vault/);
	});

	it("rejects characters that are illegal in file names", () => {
		expect(validateFolderPath("Audio<bad>")).toMatch(/cannot contain/);
		expect(validateFolderPath(`Audio${ctrl(7)}bell`)).toMatch(/cannot contain/);
	});
});

describe("resolveOutputFolder", () => {
	it("uses the profile override when set", () => {
		expect(
			resolveOutputFolder({ outputFolder: "Audio/French" }, settings("Audio")),
		).toBe("Audio/French");
	});

	it("inherits the global default when the override is absent or blank", () => {
		expect(resolveOutputFolder({}, settings("Audio"))).toBe("Audio");
		expect(resolveOutputFolder({ outputFolder: "" }, settings("Audio"))).toBe("Audio");
		expect(resolveOutputFolder({ outputFolder: "   " }, settings("Audio"))).toBe(
			"Audio",
		);
	});

	it("falls back to the vault root when neither is set", () => {
		expect(resolveOutputFolder({}, settings(""))).toBe("");
	});
});

describe("joinVaultPath", () => {
	it("omits the separator at the vault root", () => {
		expect(joinVaultPath("", "a.mp3")).toBe("a.mp3");
		expect(joinVaultPath("Audio", "a.mp3")).toBe("Audio/a.mp3");
	});
});

describe("sanitizeFilename", () => {
	it("removes illegal characters", () => {
		expect(sanitizeFilename("my:file?name*")).toBe("myfilename");
		expect(sanitizeFilename("a/b\\c")).toBe("abc");
	});

	it("keeps spaces and hyphens", () => {
		expect(sanitizeFilename("My Note - part 2")).toBe("My Note - part 2");
	});

	it("removes control characters", () => {
		expect(sanitizeFilename(`a${ctrl(1)}b${ctrl(31)}c`)).toBe("abc");
	});

	it("falls back when nothing usable remains", () => {
		expect(sanitizeFilename("///")).toBe("audio");
		expect(sanitizeFilename("")).toBe("audio");
	});
});

describe("uniqueVaultPath", () => {
	it("returns the plain name when free", () => {
		expect(uniqueVaultPath("Audio", "note", "mp3", () => false)).toBe("Audio/note.mp3");
	});

	it("suffixes rather than overwriting", () => {
		const taken = new Set(["Audio/note.mp3", "Audio/note-1.mp3"]);
		expect(uniqueVaultPath("Audio", "note", "mp3", (p) => taken.has(p))).toBe(
			"Audio/note-2.mp3",
		);
	});
});

describe("timestampSuffix", () => {
	it("is zero-padded and sortable", () => {
		expect(timestampSuffix(new Date(2026, 7, 10, 9, 5, 3))).toBe("20260810090503");
	});
});
