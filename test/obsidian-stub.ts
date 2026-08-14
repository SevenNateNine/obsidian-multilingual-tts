/**
 * Minimal stand-in for the `obsidian` module, which only exists inside the app.
 *
 * vitest.config.ts aliases `obsidian` here so pure logic in modules that also
 * import Obsidian APIs stays unit testable. Anything a test actually exercises
 * must be injected or mocked; these throw loudly rather than silently doing
 * nothing.
 */

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "");
}

export function requestUrl(): never {
	throw new Error("requestUrl is not available in tests; inject a fetcher instead.");
}

export class Notice {
	constructor(public message?: string | DocumentFragment) {}
	setMessage(): this {
		return this;
	}
	hide(): void {}
}

export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class FuzzySuggestModal {}
export class Setting {}
export class Menu {}
export const Platform = { isDesktopApp: true, isMobileApp: false };
