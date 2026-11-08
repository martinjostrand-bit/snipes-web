import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Spec 9 M0 / WP 02: the page shows the title text and version number.
// Runs against the local production build, or against BASE_URL (e.g. production) when set.
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

test("M0: shows the title and version", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  await expect(page).toHaveTitle("Snipes Web");
  await expect(
    page.getByRole("img", { name: `Snipes Web v${version}` }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
