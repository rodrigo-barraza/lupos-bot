import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import { createServiceEslintConfig } from "@rodrigo-barraza/utilities-library/eslint";

export default [
  ...createServiceEslintConfig({
    javascript: js,
    typescriptEslint: tseslint,
    prettierConfig,
    globals,
  }),
  {
    files: [
      "src/wrappers/PuppeteerWrapper.ts",
      "src/wrappers/PuppeteerWrapper2.ts",
      "src/services/ScraperService.ts",
    ],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
      },
    },
  },
  {
    ignores: ["commands-unused/"],
  },
];
