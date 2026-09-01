import { moment } from "obsidian";
import type { DateFormatter } from "../../core/text/nameTemplate";

/**
 * Format tokens read by the same library the Templates plugin uses.
 *
 * Obsidian bundles Moment.js and re-exports it, so a format string a user
 * copied from the Obsidian documentation produces the same text here.
 */
export const formatWithMoment: DateFormatter = (format, date) =>
	moment(date).format(format);
