import tseslint from "typescript-eslint";

/**
 * Size limits are enforced here rather than by prose in AGENTS.md, so a
 * function that outgrows its budget fails the lint step instead of relying on
 * a reviewer to notice.
 */
const SIZE_LIMITS = {
	"max-lines-per-function": [
		"error",
		{ max: 80, skipBlankLines: true, skipComments: true },
	],
	"max-params": ["error", 5],
	"max-depth": ["error", 3],
	// 15 rather than the usual 10: the decision functions here are flat chains
	// of guard clauses, one per documented outcome, which score high on
	// cyclomatic complexity while staying easy to read. The highest today is 13,
	// so this still bites before a function becomes genuinely tangled.
	complexity: ["error", 15],
};

/**
 * The dependency rule, enforced rather than described.
 *
 * `src/core/` is policy and must not name a framework, a vendor SDK, or a
 * concrete adapter. Use the typescript-eslint rule, not the base one, because a
 * type-only import of an Obsidian type is still a leak.
 */
const CORE_IMPORT_BOUNDARY = {
	"@typescript-eslint/no-restricted-imports": [
		"error",
		{
			patterns: [
				{
					group: ["obsidian", "microsoft-cognitiveservices-speech-sdk", "franc-min"],
					message:
						"core is policy. Declare a port in core/ports.ts and implement it under adapters/.",
				},
				{
					group: ["**/adapters/**", "**/ui/**"],
					message: "core must not import a detail. Invert the dependency.",
				},
			],
		},
	],
};

export default tseslint.config(
	{ ignores: ["main.js", "node_modules/**"] },
	...tseslint.configs.recommended,
	{
		rules: {
			...SIZE_LIMITS,
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "none",
					// Allows `const { id, ...rest } = obj` to drop a field.
					ignoreRestSiblings: true,
					varsIgnorePattern: "^_",
				},
			],
		},
	},
	{
		// A test may reach for a real adapter. `detectLanguage.test.ts` runs
		// against the real franc on purpose, because a wrong ISO code fails
		// silently and only the real model catches it.
		files: ["src/core/**/*.ts"],
		ignores: ["src/core/**/*.test.ts"],
		rules: CORE_IMPORT_BOUNDARY,
	},
	{
		// The profile editor is one long declarative builder chain. Splitting it
		// to satisfy a line budget would hurt more than it helps. The settings tab
		// no longer needs this: splitting it into two tabs broke it into sections
		// that each fit the budget.
		files: ["src/ui/ProfileEditorModal.ts"],
		rules: { "max-lines-per-function": "off" },
	},
	{
		// A table-driven test case is one `it()` per behaviour; the budget is
		// about production control flow, not assertion count.
		files: ["src/**/*.test.ts"],
		rules: { "max-lines-per-function": "off" },
	},
);
