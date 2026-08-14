import { requestUrl } from "obsidian";
import type { Fetcher } from "../azure/voiceCatalog";

/**
 * HTTP through Obsidian's own request layer, which is not subject to the
 * renderer's CORS rules the way fetch() is.
 */
export const obsidianFetcher: Fetcher = async (url, headers) => {
	const response = await requestUrl({ url, headers, method: "GET", throw: false });
	let json: unknown = null;
	try {
		json = response.json;
	} catch {
		// A non-JSON error body is normal. The status sets the error kind.
	}
	return { status: response.status, json, text: response.text };
};
