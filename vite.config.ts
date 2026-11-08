import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Spec 5.5: the version lives only in package.json and is injected at build time.
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/sim/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Spec 5.6 rule 3 and 6.1: at least 90 % line coverage of core/.
      thresholds: { "src/core/**": { lines: 90 } },
    },
  },
});
