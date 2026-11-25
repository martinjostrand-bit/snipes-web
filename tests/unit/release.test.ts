import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 5.5, 9 and 9.1 WP 18: the release of M5. The last work package of a milestone bumps the
// version, M5 to 1.0.0, in `package.json` `version`, the one place it is defined, and adds the
// version's section to `CHANGELOG.md`. The newest release comes first there, as a section whose
// heading starts `## <version>` and names its milestone, such as
// `## 0.5.0 – 2026-11-24 – M4 Game flow`, followed by its list of changes.

const RELEASE = "1.0.0";

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  };
  return pkg.version;
}

// Each release section of the changelog: its heading line and the lines up to the next one.
function changelogSections(): { heading: string; body: string[] }[] {
  const sections: { heading: string; body: string[] }[] = [];
  for (const line of readFileSync("CHANGELOG.md", "utf8").split("\n")) {
    if (line.startsWith("## ")) sections.push({ heading: line, body: [] });
    else sections.at(-1)?.body.push(line);
  }
  return sections;
}

describe("5.5 Versioning: release 1.0.0 after M5", () => {
  it("sets package.json version to 1.0.0", () => {
    expect(packageVersion()).toBe(RELEASE);
  });

  it("puts the 1.0.0 section first in CHANGELOG.md, naming M5", () => {
    const [newest] = changelogSections();
    expect(newest?.heading).toMatch(/^## 1\.0\.0[\s–-]/);
    expect(newest?.heading).toMatch(/\bM5\b/);
  });

  it("lists the release's changes in its section", () => {
    const release = changelogSections().find((s) =>
      s.heading.startsWith(`## ${RELEASE}`),
    );
    const items = (release?.body ?? []).filter((line) => /^- \S/.test(line));
    expect(items.length).toBeGreaterThan(0);
  });

  it("has one section for 1.0.0 and keeps the earlier releases after it", () => {
    const headings = changelogSections().map((s) => s.heading);
    expect(headings.filter((h) => h.startsWith(`## ${RELEASE}`))).toHaveLength(
      1,
    );
    const earlier = ["0.5.0", "0.4.0", "0.3.0", "0.2.0", "0.1.0"].map((v) =>
      headings.findIndex((h) => h.startsWith(`## ${v} `)),
    );
    expect(earlier.every((i) => i > 0)).toBe(true);
    expect([...earlier].sort((a, b) => a - b)).toEqual(earlier);
  });

  it("holds the version nowhere else in the page's source", () => {
    // Spec 5.5: package.json is the only place; the build injects it into the page.
    const version = packageVersion();
    const files = [
      "index.html",
      ...readdirSync("src", { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(ts|html|css|json)$/.test(f))
        .map((f) => join("src", f)),
    ];
    const copies = files.filter((f) =>
      readFileSync(f, "utf8").includes(version),
    );
    expect(copies).toEqual([]);
  });
});
