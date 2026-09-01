/**
 * Interfaces the policy layer declares and the detail layer implements.
 *
 * A port belongs here only when core calls it. `CatalogStore`, `Fetcher` and
 * `Detector` stay beside their consumers, because core never calls the first
 * two and `Detector` is used only by `text/detectLanguage.ts`.
 */

/** The minimum an audio transport needs. Wider render results also satisfy it. */
export interface AudioClip {
	data: ArrayBuffer;
	mimeType: string;
}

/**
 * Plays audio that a provider handed back as data.
 *
 * Exists so the chunk sequencing in `AudioPlayer` can be tested without a DOM.
 * The implementation owns the element, so pause, resume and stop are public API
 * calls rather than reaching into the internals of a speech SDK.
 */
export interface AudioSink {
	/**
	 * Resolves when the clip finishes. Rejects with a cancelled `TtsError` on
	 * abort. `onStarted` runs when audio actually begins, which can be later
	 * than the call and does not happen at all when the clip fails first.
	 */
	play(clip: AudioClip, signal: AbortSignal, onStarted?: () => void): Promise<void>;
	pause(): void;
	resume(): void;
	/** Stop playback and release the current clip. Safe to call when idle. */
	stop(): void;
	/** Release every resource, including the transport itself. */
	dispose(): void;
}

/** Where an audio file ended up. */
export interface SavedAudio {
	/** Vault-relative path, including the extension. */
	path: string;
}

/**
 * Writes rendered audio somewhere durable.
 *
 * The use case names a folder and a base name. The implementation creates the
 * folder, avoids overwriting an existing file, and reports the final path.
 */
export interface AudioStore {
	save(
		folder: string,
		basename: string,
		extension: string,
		data: ArrayBuffer,
	): Promise<SavedAudio>;
	/**
	 * True when a file already occupies this vault path.
	 *
	 * A batch asks before it synthesizes. A clip left by a run that stopped
	 * before it wrote the link must be linked, not paid for a second time.
	 */
	exists(path: string): boolean;
}

/**
 * One note, in the form the metadata cache already holds it.
 *
 * A batch takes its queue from a single snapshot of these. Obsidian reindexes
 * for minutes after a large batch, so a run that read the cache again part way
 * through would see its own half-written state and make some clips twice.
 */
export interface NoteRecord {
	/** Vault-relative, including the extension. */
	path: string;
	/** The name without the extension, which is what `{{title}}` expands to. */
	basename: string;
	/** As Obsidian parsed it: a string, a number, a boolean, or a list of those. */
	frontmatter: Record<string, unknown>;
}

/** Every note a batch can consider, read once per run. */
export interface NoteIndex {
	snapshot(): NoteRecord[];
}
