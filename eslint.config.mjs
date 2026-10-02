import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const typescriptFiles = [
  "apps/*/{bench,src,stress,test}/**/*.{ts,tsx}",
  "packages/*/{src,test}/**/*.ts",
];
const scopeToTypeScript = (configs) =>
  configs.map((config) => ({
    ...config,
    files: typescriptFiles,
  }));

export default defineConfig(
  {
    ignores: [
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.ts",
      "**/next-env.d.ts",
    ],
  },
  eslint.configs.recommended,
  {
    // Plain Node.js scripts outside the TypeScript workspaces.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", console: "readonly", fetch: "readonly", process: "readonly" },
    },
  },
  ...scopeToTypeScript(tseslint.configs.strictTypeChecked),
  ...scopeToTypeScript(tseslint.configs.stylisticTypeChecked),
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
        },
      ],
    },
  },
);
