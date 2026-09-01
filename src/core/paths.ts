import type { PluginSettings, VoiceProfile } from "./settings/types";
import { BUILTIN_NAME_TEMPLATE } from "./text/nameTemplate";

/**
 * Vault-relative path handling.
 *
 * Everything here is deliberately free of Obsidian imports so it stays unit
 * testable. The original plugin took an absolute OS path and wrote through Node
 * `fs`. That made saving desktop-only, and the vault index did not know about
 * the new files. These helpers keep every path inside the vault instead.
 */

/**
 * Characters no major filesystem accepts in a name.
 *
 * Spaces and hyphens are deliberately absent: "My Audio" and "audio-clips" are
 * perfectly valid names. Control characters are checked separately by
 * `hasControlChars` rather than as a regex range, which keeps this source free
 * of literal control bytes.
 */
const ILLEGAL_NAME_CHARS = /[<>:"|?*]/;

const CONTROL_CHAR_MAX = 0x1f;

function hasControlChars(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) <= CONTROL_CHAR_MAX) return true;
	}
	return false;
}

function stripControlChars(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) > CONTROL_CHAR_MAX) out += value[i];
	}
	return out;
}

/** Collapse separators, drop `.` segments, and strip leading/trailing slashes. */
export function normalizeVaultPath(input: string): string {
	return (input ?? "")
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment !== "" && segment !== ".")
		.join("/");
}

/**
 * Returns an error message for a folder the user typed, or null when it is usable.
 * An empty string is valid and means the vault root.
 */
export function validateFolderPath(input: string): string | null {
	const value = (input ?? "").trim();
	if (value === "") return null;

	if (/^[a-zA-Z]:[\\/]/.test(value)) {
		return "Use a folder inside the vault, not a drive path.";
	}
	if (value.startsWith("/") || value.startsWith("\\")) {
		return "Use a path relative to the vault root, without a leading slash.";
	}
	if (normalizeVaultPath(value).split("/").includes("..")) {
		return "The path cannot step outside the vault with '..'.";
	}
	if (ILLEGAL_NAME_CHARS.test(value) || hasControlChars(value)) {
		return 'A folder name cannot contain < > : " | ? or *.';
	}
	return null;
}

/**
 * Where a profile's audio is saved: its own override when set, otherwise the
 * global default. An empty result means the vault root.
 */
export function resolveOutputFolder(
	profile: Pick<VoiceProfile, "outputFolder">,
	settings: Pick<PluginSettings, "output">,
): string {
	const override = profile.outputFolder?.trim();
	const fallback = settings.output.defaultFolder?.trim() ?? "";
	return normalizeVaultPath(override || fallback);
}

/**
 * The templates that name a saved file, most specific first.
 *
 * `expandNameTemplate` resolves `{{default}}` against the next entry, so this
 * order is what lets a profile extend the global name rather than repeat it.
 * The built-in is always last, so the chain never runs out.
 */
export function resolveNameTemplates(
	profile: Pick<VoiceProfile, "nameTemplate">,
	settings: Pick<PluginSettings, "output">,
): string[] {
	const chain = [
		profile.nameTemplate?.trim(),
		settings.output.nameTemplate?.trim(),
		BUILTIN_NAME_TEMPLATE,
	];
	return chain.filter((template): template is string => !!template);
}

/** Join a folder and file name into a vault path, tolerating an empty folder. */
export function joinVaultPath(folder: string, filename: string): string {
	const dir = normalizeVaultPath(folder);
	return dir ? `${dir}/${filename}` : filename;
}

/** Strip characters that are not legal in a vault file name. */
export function sanitizeFilename(input: string): string {
	const cleaned = stripControlChars(input ?? "")
		.replace(/[\\/]/g, "")
		.replace(new RegExp(ILLEGAL_NAME_CHARS.source, "g"), "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "");
	return cleaned || "audio";
}

/**
 * First free path in the `name`, `name-1`, `name-2` sequence.
 * `exists` is injected so this stays testable without a vault.
 */
export function uniqueVaultPath(
	folder: string,
	basename: string,
	extension: string,
	exists: (path: string) => boolean,
): string {
	const safe = sanitizeFilename(basename);
	let candidate = joinVaultPath(folder, `${safe}.${extension}`);
	let counter = 1;
	while (exists(candidate)) {
		candidate = joinVaultPath(folder, `${safe}-${counter}.${extension}`);
		counter++;
	}
	return candidate;
}
