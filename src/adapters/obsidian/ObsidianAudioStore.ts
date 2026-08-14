import { TFile, TFolder, normalizePath, type Vault } from "obsidian";
import type { AudioStore, SavedAudio } from "../../core/ports";
import { TtsError } from "../../core/errors";
import { uniqueVaultPath } from "../../core/paths";

/**
 * Writing audio through the Vault API rather than Node `fs`.
 *
 * The original plugin called `fromAudioFileOutput` of the SDK with an absolute
 * OS path. That approach had three faults. Saving worked only on desktop, the
 * Obsidian index never found the new files, and playback needed a
 * resource-path workaround. The vault API corrects all three.
 */
export class ObsidianAudioStore implements AudioStore {
	constructor(private readonly vault: Vault) {}

	/** Never overwrites: an existing name gains a numeric suffix. */
	async save(
		folder: string,
		basename: string,
		extension: string,
		data: ArrayBuffer,
	): Promise<SavedAudio> {
		await this.ensureFolder(folder);

		const path = uniqueVaultPath(
			folder,
			basename,
			extension,
			(candidate) =>
				this.vault.getAbstractFileByPath(normalizePath(candidate)) !== null,
		);

		try {
			const file = await this.vault.createBinary(normalizePath(path), data);
			return { path: file.path };
		} catch (err) {
			throw new TtsError(
				"invalid-request",
				"Could not write the audio file",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	/** Create `folder` and each absent parent. Does nothing for the vault root. */
	private async ensureFolder(folder: string): Promise<void> {
		const path = normalizePath(folder);
		if (!path || path === "/") return;

		const existing = this.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) {
			throw new TtsError(
				"invalid-request",
				"Cannot save there",
				`"${path}" is a file, not a folder`,
			);
		}

		try {
			await this.vault.createFolder(path);
		} catch (err) {
			// Another call can create the folder in between. Only a folder that is
			// still absent is an error.
			if (!(this.vault.getAbstractFileByPath(path) instanceof TFolder)) {
				throw new TtsError(
					"invalid-request",
					"Could not create the output folder",
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	}
}

/** Resolve a vault path this store returned back to its file. */
export function fileAtPath(vault: Vault, path: string): TFile | null {
	const file = vault.getAbstractFileByPath(normalizePath(path));
	return file instanceof TFile ? file : null;
}
