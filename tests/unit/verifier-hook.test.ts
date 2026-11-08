import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Spec 5.7 and 9.1 WP 03: inside the verifier, the hook allows only read-only git
// commands, simple text filters and the four checks exactly as written.
const HOOK = ".claude/hooks/verifier-bash-guard.js";

// agentType null = the main session, which has no agent type.
function run(
  command: string,
  agentType: string | null = "verifier",
): number | null {
  const input = JSON.stringify({
    agent_type: agentType,
    tool_name: "Bash",
    tool_input: { command },
  });
  return spawnSync(process.execPath, [HOOK], { input }).status;
}

describe("5.7 Verifier hook", () => {
  it.each([
    "npm run check",
    "npm test",
    "npm run build",
    "npm run test:e2e",
    "git status --short",
    "git diff HEAD",
    "git diff HEAD --stat -- tests/",
    "git log --oneline main..HEAD",
    "git ls-files --others --exclude-standard",
    "cat SPEC.md",
    "grep -n Hive SPEC.md | head -20",
    "cd /c/Users/marti/Projects/SnipesWeb && git status --short",
    "npm test 2>&1",
  ])("allows %s", (command) => {
    expect(run(command)).toBe(0);
  });

  it.each([
    "rm -rf src",
    "npm install",
    "npm ci",
    "npm run check -- --fix",
    "npx prettier --write .",
    "npx eslint --fix .",
    "git commit -m x",
    "git checkout -- .",
    "git restore src",
    "git stash",
    "git add -A",
    "git diff --output=x",
    "echo x > src/main.ts",
    "cat SPEC.md; rm SPEC.md",
    "git status && touch x",
    "cat $(rm x)",
    "cat `rm x`",
    "node -e 1",
    "gh pr list",
  ])("blocks %s", (command) => {
    expect(run(command)).toBe(2);
  });

  it("does not restrict other agents", () => {
    expect(run("rm -rf dist", "developer")).toBe(0);
    expect(run("npm install", null)).toBe(0);
  });
});
