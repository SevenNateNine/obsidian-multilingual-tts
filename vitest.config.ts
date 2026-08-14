import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
	},
	resolve: {
		alias: {
			// `obsidian` only exists inside the app at runtime. Point it at a stub
			// so modules that import it can still be unit tested.
			obsidian: fileURLToPath(new URL("./test/obsidian-stub.ts", import.meta.url)),
		},
	},
});
