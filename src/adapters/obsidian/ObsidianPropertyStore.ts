import type { FileManager, MetadataCache, Vault } from "obsidian";
import type { NotePropertyStore } from "../../core/ports";
import { TtsError } from "../../core/errors";
import { fileAtPath } from "./ObsidianAudioStore";

/**
 * Frontmatter through `processFrontMatter`, which parses and rewrites the
 * YAML block itself. Editing the note text here would break on a property
 * that spans lines, or on a note that has no block yet.
 */
export class ObsidianPropertyStore implements NotePropertyStore {
	constructor(
		private readonly vault: Vault,
		private readonly metadata: MetadataCache,
		private readonly files: FileManager,
	) {}

	current(notePath: string, property: string): unknown {
		const file = fileAtPath(this.vault, notePath);
		if (!file) return undefined;
		return this.metadata.getFileCache(file)?.frontmatter?.[property];
	}

	async update(
		notePath: string,
		property: string,
		next: (existing: unknown) => unknown,
	): Promise<void> {
		const file = fileAtPath(this.vault, notePath);
		if (!file || file.extension !== "md") {
			throw new TtsError("note-write", "The note was not found", notePath);
		}

		try {
			await this.files.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					frontmatter[property] = next(frontmatter[property]);
				},
			);
		} catch (err) {
			throw new TtsError(
				"note-write",
				"Could not write the note property",
				err instanceof Error ? err.message : String(err),
			);
		}
	}
}
