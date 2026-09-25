import { expect, test } from "./fixtures/offlineTest";

/**
 * The offline server enables `identitySimulation`, which links a deterministic wallet identity
 * without a browser extension. That is what makes this testable at all: a real SIWE flow needs
 * an injected provider and a private key, and mocking one would only prove the mock works.
 */
async function linkSimulatedWallet(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v2/auth/simulation/link", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "E2E peněženka" })
    });
    return { status: response.status, body: await response.json() };
  });
}

test("the wallet section lists a linked wallet and can disconnect it", async ({ page }) => {
  await page.goto("/?mode=personal");
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/me", { credentials: "include" });
          return Boolean((await response.json()).user);
        }),
      { timeout: 20_000 }
    )
    .toBe(true);

  const mine = page.getByTestId("personal-panel");
  await expect(mine).toBeVisible();

  // Before anything is linked the section is present and honest about being empty, rather than
  // hidden — the user needs somewhere to start.
  await mine.getByText("Wallet", { exact: true }).click();
  const wallet = mine.getByTestId("personal-wallet");
  await expect(wallet).toBeVisible();
  await expect(wallet).toContainText("Žádná připojená peněženka");
  // Mobile wallets are unavailable without the Reown project ID, and that is stated once here
  // instead of failing when somebody taps connect.
  await expect(mine.getByRole("button", { name: /Mobilní peněženky/ })).toBeVisible();

  const linked = await linkSimulatedWallet(page);
  expect(linked.status).toBe(200);
  const identity = (linked.body as { identity: { id: string; subject: string } }).identity;

  // Reopening the panel re-reads the section, which is what a user gets after connecting. A
  // reload is a clean start (the URL keeps only the camera), so Personal is opened again.
  await page.reload();
  await page.getByTestId("mode-personal").click();
  await expect(mine).toBeVisible();
  await mine.getByText("Wallet", { exact: true }).click();
  const row = mine.getByTestId(`personal-wallet-${identity.id}`);
  await expect(row).toBeVisible();
  // A simulated identity says so and is never given a network or a balance it does not have.
  await expect(row).toContainText("simulace");
  await expect(row).not.toContainText("ETH");
  await expect(row).toContainText(identity.subject.slice(0, 6));

  await row.getByRole("button", { name: "Odpojit peněženku" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Odpojit peněženku?");
  await confirm.getByRole("button", { name: "Odpojit" }).click();

  await expect(mine.getByTestId("personal-wallet")).toContainText("Žádná připojená peněženka");

  const remaining = await page.evaluate(async () => {
    const response = await fetch("/api/v2/me/identities", { credentials: "include" });
    const data = (await response.json()) as {
      identities: Array<{ revokedAt: string | null; type: string }>;
    };
    return data.identities.filter((entry) => !entry.revokedAt && entry.type !== "email").length;
  });
  expect(remaining).toBe(0);
});
