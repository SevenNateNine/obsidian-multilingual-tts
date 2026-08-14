import type { PluginSettings } from "../settings/types";
import { prepareText } from "../text/markdown";

/** The text-preparation settings every speech path applies. */
export type PreparationSettings = Pick<
	PluginSettings,
	"stripMarkdown" | "textFilterRegex"
>;

/** Strip markdown and apply the user filter, using the current settings. */
export function prepareForSpeech(
	settings: PreparationSettings,
	rawText: string,
): string {
	return prepareText(rawText, {
		stripMarkdown: settings.stripMarkdown,
		filterRegex: settings.textFilterRegex,
	});
}
