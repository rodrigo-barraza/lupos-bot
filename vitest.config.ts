import { defineConfig, configDefaults } from "vitest/config";
import { serviceVitestConfig } from "@rodrigo-barraza/utilities-library/vitest";
import path from "path";

export default defineConfig({
  ...serviceVitestConfig,
  test: {
    ...serviceVitestConfig.test,
    // The shared config's exclude REPLACES vitest's defaults, so keep them:
    // `**/node_modules/**` (not just the root one) and `**/dist/**`. Then
    // keep the deploy gate, which runs from the main checkout, out of the
    // task/batch worktrees under .claude/ — their hard-linked node_modules
    // carry vendor specs and their tests/ are a second copy of ours whose
    // `#root` mocks resolve against the wrong tree.
    exclude: [
      ...configDefaults.exclude,
      ...serviceVitestConfig.test.exclude,
      ".claude/**",
    ],
  },
  resolve: {
    alias: {
      "#root": path.resolve(import.meta.dirname, "src"),
    },
  },
});
