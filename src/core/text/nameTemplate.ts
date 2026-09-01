/**
 * File names written in the variable syntax of the Obsidian Templates plugin.
 *
 * The syntax is deliberately the one users already know from
 * https://obsidian.md/help/plugins/templates: `{{title}}`, `{{date}}`,
 * `{{time}}`, and a Moment.js format after a colon. Three variables are added
 * for this plugin, because a file named after a note and a clock alone cannot
 * tell two clips of the same note apart.
 *
 * Free of Obsidian imports, so the whole expansion is unit testable. Moment
 * lives in the obsidian module, so the caller injects the formatter.
 */

import { propertyValues } from "./property";

/**
 * The name every save produces when neither the profile nor the settings say
 * otherwise.
 *
 * The words that were read, so a clip of "hey" is `hey.mp3` and is findable by
 * its own name. Two clips of the same words do not collide: `uniqueVaultPath`
 * adds a numeric suffix.
 */
export const BUILTIN_NAME_TEMPLATE = "{{selection}}";

/** Obsidian's own default for `{{date}}`. */
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

/**
 * Obsidian defaults `{{time}}` to `HH:mm`. A colon is illegal in a file name,
 * and `sanitizeFilename` would delete it without saying so, turning 14:35 into
 * 1435. Hyphens keep the same reading and survive the save.
 */
const DEFAULT_TIME_FORMAT = "HH-mm-ss";

/** Long enough to recognise the clip, short enough to leave room for the rest. */
const SELECTION_MAX_CHARS = 40;

export type DateFormatter = (format: string, date: Date) => string;

export interface NameVars {
	/** Basename of the active note. */
	title: string;
	/** The text being spoken. */
	selection: string;
	profile: string;
	locale: string;
	/**
	 * Frontmatter of the active note, as Obsidian parsed it. A value is a
	 * string, a number, a boolean, or a list of those.
	 */
	properties: Record<string, unknown>;
	now: Date;
	/** Injected: `moment` lives in the obsidian module, which core must not import. */
	formatDate: DateFormatter;
}

export const NAME_VARIABLES = [
	"title",
	"date",
	"time",
	"selection",
	"profile",
	"locale",
	"property",
	"default",
] as const;

/** Between the values of a list property, and short enough to read in a name. */
const LIST_SEPARATOR = "-";

/**
 * A new object per call rather than one shared constant.
 *
 * `{{default}}` expands by calling back into `expandNameTemplate` from inside a
 * `String.replace` callback. A shared global regex carries `lastIndex` state,
 * so the nested call would reset the position of the outer scan.
 */
function variables(): RegExp {
	return /\{\{\s*([a-zA-Z]+)\s*(?::([^}]*))?\}\}/g;
}

/**
 * Expand the first template of `chain`, resolving `{{default}}` against the rest.
 *
 * The chain is profile override, then global setting, then the built-in name.
 * That is what makes `{{default}}_drill` an append and `KR_{{default}}` a
 * prepend: neither has to repeat the template it is extending. Recursion is
 * bounded because each step consumes one entry of a list built by
 * `resolveNameTemplates`.
 *
 * An unknown variable is left as written, so a typo is visible in the name
 * rather than silently dropped. `unknownNameVariables` reports it before then.
 */
export function expandNameTemplate(chain: readonly string[], vars: NameVars): string {
	const [template, ...rest] = chain;
	if (template === undefined) return "";

	return template.replace(variables(), (match, name: string, format?: string) => {
		const value = substitute(name, format, rest, vars);
		return value ?? match;
	});
}

/** Null for a name this build does not know. The caller keeps the literal text. */
function substitute(
	name: string,
	format: string | undefined,
	rest: readonly string[],
	vars: NameVars,
): string | null {
	switch (name) {
		case "title":
			return vars.title;
		case "selection":
			return shorten(vars.selection);
		case "profile":
			return vars.profile;
		case "locale":
			return vars.locale;
		case "property":
			return propertyValue(vars, format);
		case "date":
			return vars.formatDate(format || DEFAULT_DATE_FORMAT, vars.now);
		case "time":
			return vars.formatDate(format || DEFAULT_TIME_FORMAT, vars.now);
		case "default":
			return expandNameTemplate(rest, vars);
		default:
			return null;
	}
}

/**
 * One frontmatter property of the note being read.
 *
 * A property that is absent, empty, or unnamed falls back to the note title,
 * because a name built from nothing is worse than a name built from the file
 * it came from.
 */
function propertyValue(vars: NameVars, name: string | undefined): string {
	const key = name?.trim();
	const value = key ? propertyValues(vars.properties[key]).join(LIST_SEPARATOR) : "";
	return value || vars.title;
}

/**
 * The properties a chain asks for that the note does not supply.
 *
 * Reported before expansion so a caller can ask for them, rather than letting
 * the gap surface in a file name that is already written. Only the templates
 * expansion actually reaches are scanned, so an override that never writes
 * `{{default}}` does not report the gaps of the template below it.
 */
export function missingProperties(chain: readonly string[], vars: NameVars): string[] {
	const missing: string[] = [];

	for (const template of chain) {
		if (!collectMissing(template, vars, missing)) break;
	}
	return missing;
}

/** Adds to `missing`, and reports whether this template extends the next one. */
function collectMissing(template: string, vars: NameVars, missing: string[]): boolean {
	let extendsNext = false;

	for (const match of template.matchAll(variables())) {
		if (match[1] === "default") extendsNext = true;
		if (match[1] === "property") addMissing(match[2], vars, missing);
	}
	return extendsNext;
}

function addMissing(name: string | undefined, vars: NameVars, missing: string[]): void {
	const key = name?.trim();
	// An unnamed property has nothing to ask for: it always takes the title.
	if (!key || propertyValues(vars.properties[key]).length > 0) return;
	if (!missing.includes(key)) missing.push(key);
}

/**
 * The variable names in `template` that this build cannot expand.
 *
 * The settings field shows them while the user types, because an unexpanded
 * `{{titel}}` only becomes visible in the file name after a save.
 */
export function unknownNameVariables(template: string): string[] {
	const known: readonly string[] = NAME_VARIABLES;
	const found: string[] = [];

	for (const match of template.matchAll(variables())) {
		const name = match[1];
		if (name === undefined) continue;
		if (!known.includes(name) && !found.includes(name)) found.push(name);
	}
	return found;
}

/** Collapse the whitespace and cut at a word boundary, so a paragraph stays a name. */
function shorten(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= SELECTION_MAX_CHARS) return collapsed;

	const cut = collapsed.slice(0, SELECTION_MAX_CHARS);
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * A message for a template the user is typing, or null when it is usable.
 *
 * The sibling of `validateFolderPath` in `paths.ts`, and it is shown the same
 * way, under the field.
 */
export function nameTemplateError(template: string): string | null {
	const unknown = unknownNameVariables(template);
	if (unknown.length === 0) return null;

	const names = unknown.map((name) => `{{${name}}}`).join(", ");
	return `Unknown variable: ${names}. It is written into the name as it stands.`;
}
