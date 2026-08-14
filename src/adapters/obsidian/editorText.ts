import type { Editor } from "obsidian";

export type ReadDirection = "off" | "before" | "after";

/**
 * The text to read: the selection when there is one, otherwise everything
 * before or after the cursor depending on `direction`.
 *
 * Ported from the original plugin's getSelectedText, whose cursor-relative
 * reading is one of its better ideas.
 */
export function getReadableText(
	direction: ReadDirection,
	editor?: Editor | null,
): string {
	if (!editor) return "";

	const selection = editor.getSelection();
	if (selection.trim()) return selection.trim();
	if (direction === "off") return "";

	const cursor = editor.getCursor();

	if (direction === "before") {
		return editor.getRange({ line: 0, ch: 0 }, cursor).trim();
	}

	const lastLine = editor.lastLine();
	const end = { line: lastLine, ch: editor.getLine(lastLine).length };
	return editor.getRange(cursor, end).trim();
}
