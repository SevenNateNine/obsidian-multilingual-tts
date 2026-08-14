import type { VoiceProfile } from "../../core/settings/types";
import type { VoiceInfo } from "../../core/tts/types";

/**
 * Escape text for inclusion in an XML document.
 *
 * The original plugin put note text directly into its SSML template. A note
 * that contained `Tom & Jerry` made malformed XML. The service refused it, and
 * the plugin told the user to check the speech key, which was correct.
 * Replace `&` first, or the other replacements get a second escape.
 */
export function escapeXml(value: string): string {
	return stripInvalidXmlChars(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Remove characters XML 1.0 forbids outright. Escaping cannot rescue these —
 * a raw 0x0C in the body makes the document invalid however it is written.
 * Tab, newline and carriage return are the only control characters allowed.
 */
function stripInvalidXmlChars(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		const allowed = code === 9 || code === 10 || code === 13 || code >= 32;
		if (allowed) out += value[i];
	}
	return out;
}

export interface SsmlOptions {
	text: string;
	profile: VoiceProfile;
	/**
	 * The catalog entry for the voice of the profile. It gives the styles and
	 * roles that the voice supports. When null, no style or role is emitted.
	 */
	voice: VoiceInfo | null;
}

/**
 * Build the SSML document for one chunk.
 *
 * Style and role are emitted only when the selected voice advertises them.
 * Azure supports `mstts:express-as` on a subset of neural voices. The original
 * plugin sent `style="advertisement_upbeat" role="Boy"` with every request,
 * for every voice. That request fails or has no effect for most languages.
 */
export function buildSsml({ text, profile, voice }: SsmlOptions): string {
	const locale = profile.locale || "en-US";
	const body = wrapProsody(escapeXml(text), profile);
	const expressive = wrapExpressAs(body, profile, voice);

	return [
		`<speak version="1.0"`,
		` xmlns="http://www.w3.org/2001/10/synthesis"`,
		` xmlns:mstts="https://www.w3.org/2001/mstts"`,
		` xml:lang="${escapeXml(locale)}">`,
		`<voice name="${escapeXml(profile.voiceId)}">`,
		expressive,
		`</voice>`,
		`</speak>`,
	].join("");
}

/** Only emit prosody attributes that differ from the voice's natural delivery. */
function wrapProsody(escapedText: string, profile: VoiceProfile): string {
	const attrs: string[] = [];

	if (isMeaningful(profile.rate) && profile.rate !== 1) {
		attrs.push(`rate="${round(profile.rate, 2)}"`);
	}
	if (isMeaningful(profile.pitch) && profile.pitch !== 0) {
		attrs.push(`pitch="${signed(round(profile.pitch, 0))}%"`);
	}
	if (isMeaningful(profile.volume) && profile.volume !== 100) {
		attrs.push(`volume="${clamp(round(profile.volume, 0), 0, 100)}"`);
	}

	if (attrs.length === 0) return escapedText;
	return `<prosody ${attrs.join(" ")}>${escapedText}</prosody>`;
}

function wrapExpressAs(
	inner: string,
	profile: VoiceProfile,
	voice: VoiceInfo | null,
): string {
	const style = supportedStyle(profile, voice);
	const role = supportedRole(profile, voice);
	if (!style && !role) return inner;

	const attrs: string[] = [];
	if (style) {
		attrs.push(`style="${escapeXml(style)}"`);
		const degree = profile.styleDegree;
		if (isMeaningful(degree) && degree !== 1) {
			attrs.push(`styledegree="${clamp(round(degree, 2), 0.01, 2)}"`);
		}
	}
	if (role) attrs.push(`role="${escapeXml(role)}"`);

	return `<mstts:express-as ${attrs.join(" ")}>${inner}</mstts:express-as>`;
}

/** A style the profile asked for AND the chosen voice advertises. */
export function supportedStyle(
	profile: VoiceProfile,
	voice: VoiceInfo | null,
): string | null {
	if (!profile.style || !voice) return null;
	return voice.styles.includes(profile.style) ? profile.style : null;
}

/** A role the profile asked for AND the chosen voice advertises. */
export function supportedRole(
	profile: VoiceProfile,
	voice: VoiceInfo | null,
): string | null {
	if (!profile.role || !voice) return null;
	return voice.roles.includes(profile.role) ? profile.role : null;
}

function isMeaningful(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function signed(value: number): string {
	return value > 0 ? `+${value}` : `${value}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
