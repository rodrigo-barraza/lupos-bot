import { defineConfig } from "vitest/config";
import { serviceVitestConfig } from "@rodrigo-barraza/utilities-library/vitest";
import path from "path";

export default defineConfig({
  ...serviceVitestConfig,
  resolve: {
    alias: {
      "#root": path.resolve(import.meta.dirname, "src"),
    },
  },
});
