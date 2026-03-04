import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(
  {
    ignores: ["dist", "coverage", "node_modules"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir,
      },
      globals: {
        ...globals.bun,
        ...globals.node,
      },
    },
    plugins: {
      unicorn,
    },
    rules: {
      ...unicorn.configs.recommended.rules,
      "unicorn/filename-case": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-useless-undefined": "off",
      "unicorn/no-null": "off",
    },
  },
  eslintConfigPrettier,
);
