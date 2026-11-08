import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

// Spec 9.1 WP 01 and 5.6 rule 1, 4.3: the lint setup itself.
// The snippets below are not files in the project, so they are linted without type information.
const eslint = new ESLint({
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "");
}

describe("4.3 No outside randomness or time in core/", () => {
  it("rejects Math.random and Date.now in src/core", async () => {
    const ids = await ruleIds(
      "export const r = Math.random() + Date.now();\n",
      "src/core/example.ts",
    );
    expect(ids).toEqual([
      "no-restricted-properties",
      "no-restricted-properties",
    ]);
  });

  it("allows them outside src/core", async () => {
    const ids = await ruleIds(
      "export const r = Math.random() + Date.now();\n",
      "src/render/example.ts",
    );
    expect(ids).toEqual([]);
  });
});

describe("5.6 rule 1: warnings are errors", () => {
  it("runs ESLint with --max-warnings 0 in npm run check", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check"]).toMatch(/eslint \. --max-warnings 0/);
  });

  it("reports unused eslint-disable directives as errors", async () => {
    const [result] = await eslint.lintText(
      "// eslint-disable-next-line no-console\nexport const x = 1;\n",
      { filePath: "src/render/example.ts" },
    );
    expect(result?.errorCount).toBe(1);
  });
});

describe("5.5 Version in one place", () => {
  it("injects the package.json version at build time", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    expect(__APP_VERSION__).toBe(pkg.version);
  });
});
