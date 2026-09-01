import type { MetadataCache, Vault } from "obsidian";
import type { NoteIndex, NoteRecord } from "../../core/ports";

/**
 * Every markdown note and its frontmatter, read from the metadata cache.
 *
 * The cache rather than the files themselves: Obsidian has already parsed the
 * frontmatter of the whole vault, so a filter over a few hundred cards is a map
 * over memory instead of a few hundred reads. A note Obsidian has not indexed
 * yet reads as having no properties, so it simply does not match a filter.
 */
export class ObsidianNoteIndex implements NoteIndex {
	constructor(
		private readonly vault: Vault,
		private readonly metadata: MetadataCache,
	) {}

	snapshot(): NoteRecord[] {
		return this.vault.getMarkdownFiles().map((file) => ({
			path: file.path,
			basename: file.basename,
			frontmatter: this.metadata.getFileCache(file)?.frontmatter ?? {},
		}));
	}
}
