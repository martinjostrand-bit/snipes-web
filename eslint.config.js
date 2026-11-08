import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "test-results/", "playwright-report/"] },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
      },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  {
    // Spec 4.3: all randomness and time in core/ come from the game state.
    files: ["src/core/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the seeded PRNG in the game state (spec 4.3).",
        },
        {
          object: "Date",
          property: "now",
          message: "Game time comes from ticks, not the clock (spec 4.3).",
        },
      ],
    },
  },
);
