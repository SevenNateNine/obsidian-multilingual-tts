import type { AudioStore } from "../ports";
import type { ProviderRegistry } from "../tts/registry";
import {
	resolveAudioFormat,
	type PluginSettings,
	type VoiceProfile,
} from "../settings/types";
import { renderToFile, type RenderProgress } from "../audio/renderToFile";
import { resolveOutputFolder } from "../paths";
import { isCancellation } from "../errors";
import { prepareForSpeech } from "./prepare";
import type { SaveOutcome } from "./outcomes";

export interface SaveDeps {
	providers: ProviderRegistry;
	store: AudioStore;
	settings: PluginSettings;
}

export interface SaveRequest {
	text: string;
	profile: VoiceProfile;
	basename: string;
	signal: AbortSignal;
}

/** Prepare the text, then save it. */
export async function saveAudio(
	deps: SaveDeps,
	req: SaveRequest,
	onProgress?: (progress: RenderProgress) => void,
): Promise<SaveOutcome> {
	const text = prepareForSpeech(deps.settings, req.text);
	if (!text) return { ok: false, reason: "empty-text" };
	return saveAudioPrepared(deps, { ...req, text }, onProgress);
}

/**
 * Render text that is already prepared to one audio file in the vault.
 *
 * Separate from `saveAudio` for the same reason `speakPrepared` is separate
 * from `speak`: the context menu prepares once, detects the language on that
 * text, and must not strip it a second time.
 *
 * Every refusal happens before the first request, so an impossible combination
 * costs nothing rather than failing after the synthesis has been paid for.
 */
export async function saveAudioPrepared(
	deps: SaveDeps,
	req: SaveRequest,
	onProgress?: (progress: RenderProgress) => void,
): Promise<SaveOutcome> {
	const provider = deps.providers.get(req.profile.providerId);
	if (!provider) {
		return { ok: false, reason: "unknown-provider", detail: req.profile.providerId };
	}
	if (provider.kind !== "rendering") {
		return { ok: false, reason: "cannot-render", detail: provider.displayName };
	}
	if (!provider.isConfigured()) {
		return { ok: false, reason: "not-configured", detail: provider.displayName };
	}

	if (!req.text) return { ok: false, reason: "empty-text" };

	// The profile carries a format only when it overrides the global one, so
	// the choice is resolved here rather than in each provider.
	const profile: VoiceProfile = {
		...req.profile,
		audioFormat: resolveAudioFormat(req.profile, deps.settings),
	};

	try {
		const rendered = await renderToFile(
			provider,
			profile,
			req.text,
			req.signal,
			onProgress,
		);
		const saved = await deps.store.save(
			resolveOutputFolder(req.profile, deps.settings),
			req.basename,
			rendered.extension,
			rendered.data,
		);
		return {
			ok: true,
			path: saved.path,
			clip: { data: rendered.data, mimeType: rendered.mimeType },
		};
	} catch (err) {
		if (isCancellation(err)) return { ok: false, reason: "cancelled" };
		return { ok: false, reason: "failed", error: err };
	}
}
