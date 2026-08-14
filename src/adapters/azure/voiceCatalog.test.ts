import { describe, expect, it } from "vitest";
import {
	CATALOG_TTL_MS,
	fetchVoiceCatalog,
	isCatalogFresh,
	parseVoiceList,
	summarizeCatalog,
	toVoiceInfo,
	voiceListUrl,
	type CachedCatalog,
	type Fetcher,
} from "./voiceCatalog";
import { TtsError } from "../../core/errors";

// Shape taken from the documented voices/list response.
const jenny = {
	Name: "Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)",
	DisplayName: "Jenny",
	LocalName: "Jenny",
	ShortName: "en-US-JennyNeural",
	Gender: "Female",
	Locale: "en-US",
	LocaleName: "English (United States)",
	StyleList: ["assistant", "chat", "newscast"],
	VoiceType: "Neural",
	Status: "GA",
};

const yunxi = {
	ShortName: "zh-CN-YunxiNeural",
	DisplayName: "Yunxi",
	LocalName: "云希",
	Gender: "Male",
	Locale: "zh-CN",
	StyleList: ["narration-relaxed", "cheerful"],
	RolePlayList: ["Narrator", "Boy"],
	VoiceType: "Neural",
};

describe("voiceListUrl", () => {
	it("targets the regional endpoint", () => {
		expect(voiceListUrl("eastus")).toBe(
			"https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list",
		);
	});
});

describe("toVoiceInfo", () => {
	it("keeps the style list, which is what gates express-as", () => {
		const info = toVoiceInfo(jenny)!;
		expect(info.id).toBe("en-US-JennyNeural");
		expect(info.locale).toBe("en-US");
		expect(info.gender).toBe("Female");
		expect(info.styles).toEqual(["assistant", "chat", "newscast"]);
		expect(info.roles).toEqual([]);
	});

	it("prefers the local name for display", () => {
		expect(toVoiceInfo(yunxi)!.displayName).toBe("云希");
	});

	it("keeps role lists when present", () => {
		expect(toVoiceInfo(yunxi)!.roles).toEqual(["Narrator", "Boy"]);
	});

	it("defaults missing style and role lists to empty, never undefined", () => {
		const info = toVoiceInfo({ ShortName: "x-Y-Z", Locale: "x-Y" })!;
		expect(info.styles).toEqual([]);
		expect(info.roles).toEqual([]);
	});

	it("rejects entries with no usable identity", () => {
		expect(toVoiceInfo({ DisplayName: "Nameless" })).toBeNull();
		expect(toVoiceInfo({ ShortName: "a-B-C" })).toBeNull();
	});

	it("normalizes unknown genders to undefined", () => {
		expect(toVoiceInfo({ ...jenny, Gender: "Other" })!.gender).toBeUndefined();
	});
});

describe("parseVoiceList", () => {
	it("sorts by locale then display name", () => {
		const voices = parseVoiceList([yunxi, jenny]);
		expect(voices.map((v) => v.id)).toEqual(["en-US-JennyNeural", "zh-CN-YunxiNeural"]);
	});

	it("skips malformed entries instead of failing the whole list", () => {
		expect(parseVoiceList([jenny, {}, null]).map((v) => v.id)).toEqual([
			"en-US-JennyNeural",
		]);
	});

	it("rejects a non-array payload", () => {
		expect(() => parseVoiceList({ error: "nope" })).toThrow(TtsError);
	});
});

describe("summarizeCatalog", () => {
	const catalog = (voices: unknown[]) =>
		({ fetchedAt: 1_000, region: "eastus", voices }) as unknown as CachedCatalog;

	it("counts voices and distinct locales", () => {
		const info = summarizeCatalog(catalog([toVoiceInfo(jenny)!, toVoiceInfo(yunxi)!]));
		expect(info.voiceCount).toBe(2);
		expect(info.localeCount).toBe(2);
	});

	it("counts a shared locale once", () => {
		const info = summarizeCatalog(
			catalog([
				toVoiceInfo(jenny)!,
				toVoiceInfo({ ...jenny, ShortName: "en-US-GuyNeural" })!,
			]),
		);
		expect(info.voiceCount).toBe(2);
		expect(info.localeCount).toBe(1);
	});

	it("carries the timestamp and region through", () => {
		const info = summarizeCatalog(catalog([toVoiceInfo(jenny)!]));
		expect(info.fetchedAt).toBe(1_000);
		expect(info.region).toBe("eastus");
	});

	it("reports zero for an empty catalog", () => {
		const info = summarizeCatalog(catalog([]));
		expect(info.voiceCount).toBe(0);
		expect(info.localeCount).toBe(0);
	});

	it("survives a catalog whose voices field is not an array", () => {
		const info = summarizeCatalog({
			fetchedAt: 1,
			region: "eastus",
			voices: null,
		} as unknown as CachedCatalog);
		expect(info.voiceCount).toBe(0);
	});
});

describe("isCatalogFresh", () => {
	const catalog = {
		fetchedAt: 1_000_000,
		region: "eastus",
		voices: [toVoiceInfo(jenny)!],
	};

	it("accepts a recent catalog for the same region", () => {
		expect(isCatalogFresh(catalog, "eastus", 1_000_000 + 1000)).toBe(true);
	});

	it("rejects a catalog past its TTL", () => {
		expect(isCatalogFresh(catalog, "eastus", 1_000_000 + CATALOG_TTL_MS + 1)).toBe(
			false,
		);
	});

	it("rejects a catalog from a different region", () => {
		expect(isCatalogFresh(catalog, "westus", 1_000_000)).toBe(false);
	});

	it("rejects null and empty catalogs", () => {
		expect(isCatalogFresh(null, "eastus")).toBe(false);
		expect(isCatalogFresh({ ...catalog, voices: [] }, "eastus", 1_000_000)).toBe(false);
	});
});

describe("fetchVoiceCatalog", () => {
	const ok: Fetcher = async () => ({ status: 200, json: [jenny], text: "" });

	it("sends the subscription key header", async () => {
		let seen: Record<string, string> = {};
		const spy: Fetcher = async (_url, headers) => {
			seen = headers;
			return { status: 200, json: [jenny], text: "" };
		};
		await fetchVoiceCatalog("eastus", "secret", spy);
		expect(seen["Ocp-Apim-Subscription-Key"]).toBe("secret");
	});

	it("returns parsed voices", async () => {
		const voices = await fetchVoiceCatalog("eastus", "k", ok);
		expect(voices).toHaveLength(1);
	});

	it("requires credentials", async () => {
		await expect(fetchVoiceCatalog("", "k", ok)).rejects.toMatchObject({
			kind: "not-configured",
		});
	});

	// The whole point: a 401 must not be reported the same way as a timeout.
	it("maps 401 to an auth error", async () => {
		const fetcher: Fetcher = async () => ({ status: 401, json: null, text: "" });
		await expect(fetchVoiceCatalog("eastus", "bad", fetcher)).rejects.toMatchObject({
			kind: "auth",
		});
	});

	it("maps 429 to a quota error", async () => {
		const fetcher: Fetcher = async () => ({ status: 429, json: null, text: "" });
		await expect(fetchVoiceCatalog("eastus", "k", fetcher)).rejects.toMatchObject({
			kind: "quota",
		});
	});

	it("maps 5xx to a network error", async () => {
		const fetcher: Fetcher = async () => ({ status: 503, json: null, text: "" });
		await expect(fetchVoiceCatalog("eastus", "k", fetcher)).rejects.toMatchObject({
			kind: "network",
		});
	});

	it("maps a transport failure to a network error", async () => {
		const fetcher: Fetcher = async () => {
			throw new Error("ENOTFOUND");
		};
		await expect(fetchVoiceCatalog("eastus", "k", fetcher)).rejects.toMatchObject({
			kind: "network",
		});
	});

	it("treats an empty voice list as a failure", async () => {
		const fetcher: Fetcher = async () => ({ status: 200, json: [], text: "" });
		await expect(fetchVoiceCatalog("eastus", "k", fetcher)).rejects.toMatchObject({
			kind: "no-voice",
		});
	});
});
