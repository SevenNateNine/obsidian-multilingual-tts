/**
 * ISO 639-1 (what BCP-47 locales use) <-> ISO 639-3 (what franc returns).
 *
 * Where a macrolanguage has an individual code, this map uses the code that
 * franc emits:
 *
 *  - `cmn` for Mandarin, not `zho`
 *  - `arb` for Standard Arabic
 *  - `pes` for Persian
 *  - `swh` for Swahili
 *  - `zlm` for Malay
 *  - `als` for Albanian
 *
 * A wrong code here makes detection never match, and it gives no error.
 *
 * Coverage is deliberately partial. A language that is absent here cannot take
 * part in auto-detection. A profile that uses it still works when the user
 * selects the profile manually.
 */
const ISO_639_1_TO_3: Record<string, string> = {
	af: "afr",
	am: "amh",
	ar: "arb",
	az: "azj",
	be: "bel",
	bg: "bul",
	bn: "ben",
	bs: "bos",
	ca: "cat",
	cs: "ces",
	da: "dan",
	de: "deu",
	el: "ell",
	en: "eng",
	es: "spa",
	et: "est",
	eu: "eus",
	fa: "pes",
	fi: "fin",
	fr: "fra",
	ga: "gle",
	gu: "guj",
	ha: "hau",
	he: "heb",
	hi: "hin",
	hr: "hrv",
	hu: "hun",
	hy: "hye",
	id: "ind",
	ig: "ibo",
	is: "isl",
	it: "ita",
	ja: "jpn",
	jv: "jav",
	ka: "kat",
	kk: "kaz",
	km: "khm",
	kn: "kan",
	ko: "kor",
	lo: "lao",
	lt: "lit",
	lv: "lvs",
	mk: "mkd",
	ml: "mal",
	mn: "khk",
	mr: "mar",
	ms: "zlm",
	my: "mya",
	nb: "nob",
	ne: "npi",
	nl: "nld",
	no: "nob",
	pa: "pan",
	pl: "pol",
	ps: "pbu",
	pt: "por",
	ro: "ron",
	ru: "rus",
	si: "sin",
	sk: "slk",
	sl: "slv",
	so: "som",
	sq: "als",
	sr: "srp",
	su: "sun",
	sv: "swe",
	sw: "swh",
	ta: "tam",
	te: "tel",
	th: "tha",
	tl: "tgl",
	tr: "tur",
	uk: "ukr",
	ur: "urd",
	uz: "uzn",
	vi: "vie",
	yo: "yor",
	zh: "cmn",
	zu: "zul",
};

/**
 * Reverse direction. Built from the table above, keeping the first 639-1 code
 * for each 639-3 so `nob` resolves to `nb` rather than `no`.
 */
const ISO_639_3_TO_1: Record<string, string> = (() => {
	const out: Record<string, string> = {};
	for (const [one, three] of Object.entries(ISO_639_1_TO_3)) {
		if (!(three in out)) out[three] = one;
	}
	return out;
})();

/** `fr-FR` -> `fr`. Also tolerates a bare `fr` and odd casing. */
export function languageSubtag(locale: string): string {
	const [subtag = ""] = (locale ?? "").trim().split(/[-_]/);
	return subtag.toLowerCase();
}

/** BCP-47 locale or 639-1 code -> 639-3, or null when unmapped. */
export function toIso6393(locale: string): string | null {
	return ISO_639_1_TO_3[languageSubtag(locale)] ?? null;
}

/** 639-3 -> 639-1, or null when unmapped. */
export function toIso6391(code: string): string | null {
	return ISO_639_3_TO_1[(code ?? "").trim().toLowerCase()] ?? null;
}

/** True when this locale can take part in auto-detection at all. */
export function isDetectable(locale: string): boolean {
	return toIso6393(locale) !== null;
}
