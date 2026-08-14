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
}
