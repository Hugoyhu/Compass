/**
 * Browser smoke test of the main flows against a running dev server.
 *
 *   npm run dev            # in another terminal
 *   npm run test:smoke     # or: npm run test:smoke -- --screenshots=/some/dir
 *
 * Uses your installed Google Chrome via playwright-core. The upload step
 * sends the fictional fixture transcript to the Claude API (well under a cent).
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import postgres from "postgres";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const FIXTURE = path.resolve("tests/fixtures/transcript/sample-transcript.pdf");
const shotsDir = process.argv.find((a) => a.startsWith("--screenshots="))?.split("=")[1];

let failures = 0;
function check(condition: boolean, label: string) {
  console.log(`${condition ? "✓" : "✗"} ${label}`);
  if (!condition) failures++;
}

async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
}

/** Opens My Courses and uploads the fixture transcript, waiting for the review screen. */
async function uploadFixture(page: Page) {
  await page.goto(`${BASE}/record`);
  await page.getByRole("heading", { name: "My courses", exact: true }).waitFor();
  // Wait for hydration so the file input's change handler is attached.
  await page.waitForLoadState("networkidle");
  await page.locator("#transcript-file").setInputFiles(FIXTURE);
  await page.getByText("Review courses").waitFor({ timeout: 90_000 });
  check(await page.getByText("15 courses").first().isVisible(), "Review screen lists 15 courses from the fixture");
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    // 1. A new visitor sees onboarding.
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Add your courses" }).waitFor();
    check(true, "New visitor sees the get-started screen");
    await shot(page, "1-onboarding");

    // 2. The Degree Explorer needs no record.
    await page.goto(`${BASE}/degrees/cse-bs`);
    await page.getByRole("heading", { name: "Computer Science, BS" }).waitFor();
    check(
      await page.getByText("Alternative path: replaces CSE 114, CSE 214, CSE 307").isVisible(),
      "Degree Explorer shows the honors sequence as an alternative path",
    );

    // 3. Upload the fixture transcript, review, replace, and see the dashboard update.
    await uploadFixture(page);
    await shot(page, "4-review");
    await page.getByRole("button", { name: /Replace my courses/ }).click();
    await page.getByText("Saved", { exact: true }).waitFor();
    check(await page.getByText("HON 105").first().isVisible(), "Saved courses include HON 105 from the transcript");
    await shot(page, "5-record-saved");

    await page.goto(BASE);
    await page.getByRole("heading", { name: /Alex/ }).waitFor();
    check(await page.getByText(/Spring 2026/).first().isVisible(), "Dashboard uses the transcript's current term");
    await shot(page, "6-dashboard-uploaded");

    // 4. Clearing returns to onboarding.
    await page.goto(`${BASE}/record`);
    await page.waitForLoadState("networkidle");
    page.once("dialog", (d) => d.accept());
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Delete all courses" }).click(),
    ]);
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Add your courses" }).waitFor();
    check(true, "Clearing the record returns to onboarding");

    // 5. Accounts: a guest record moves into a new account and survives sign-out/sign-in.
    await page.goto(`${BASE}/signup`);
    await page.waitForLoadState("networkidle");
    if (await page.getByText("Accounts aren't available").isVisible()) {
      console.log("- Accounts aren't configured on this server; skipping account checks");
    } else {
      const username = `smoketest-${Date.now().toString(36)}`;
      const password = "correct horse battery";
      await uploadFixture(page);
      await page.getByRole("button", { name: /Replace my courses/ }).click();
      await page.getByText("Saved", { exact: true }).waitFor();

      await page.goto(`${BASE}/signup`);
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Username").fill(username);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();
      await page.getByRole("heading", { name: /Alex/ }).waitFor();
      check(await page.getByText(username).first().isVisible(), "Sign-up moves the guest record into the new account");
      await shot(page, "7-signed-in");

      await page.getByRole("button", { name: "Sign out" }).click();
      await page.getByRole("heading", { name: "Add your courses" }).waitFor();
      check(true, "Signing out shows onboarding (the guest copy was moved, not left behind)");

      await page.goto(`${BASE}/login`);
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Username").fill(username);
      await page.getByLabel("Password").fill("wrong password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByText("Incorrect username or password.").waitFor();
      check(true, "A wrong password is rejected");
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("heading", { name: /Alex/ }).waitFor();
      check(true, "Signing back in restores the record from the database");

      await page.goto(`${BASE}/progress`);
      await page.waitForLoadState("networkidle");
      check(!(await page.getByText("Add your courses").isVisible()), "Degree progress works for a signed-in account");

      // Remove the throwaway account (its sessions and record cascade).
      if (process.env.DATABASE_URL || existsSync(".env")) {
        if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
        const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
        await sql`delete from users where username = ${username}`;
        await sql.end();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll smoke checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
