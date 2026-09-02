/** Where the variable syntax is documented. Both template fields link to it. */
const TEMPLATE_DOCS_URL =
	"https://obsidian.md/help/plugins/templates#Template+variables";

/**
 * The description under a file name template field.
 *
 * A fragment rather than a string, because the syntax is Obsidian's own and the
 * reader must be able to reach its documentation in one click. `lead` is the
 * sentence that differs between the global field and the per-profile one.
 */
export function nameTemplateHelp(lead: string): DocumentFragment {
	return createFragment((el) => {
		el.appendText(`${lead} It reads the same `);
		el.createEl("a", { text: "template variables", href: TEMPLATE_DOCS_URL });
		el.appendText(
			" as the Obsidian Templates plugin, and adds {{selection}} for the words " +
				"you read, {{property:name}} for a property of the note, {{profile}}, " +
				"{{locale}}, and {{default}} for the name this template extends. " +
				"Add |kebab, |snake, |camel, or |pascal inside the braces to change " +
				"the case, for example {{property:word|kebab}}. " +
				"{{time}} defaults to HH-mm-ss, because a colon cannot appear in a " +
				"file name.",
		);
	});
}
