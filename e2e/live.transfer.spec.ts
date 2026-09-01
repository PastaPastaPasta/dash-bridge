import { expect, test } from '@playwright/test';

/**
 * Live testnet exercise of the username transfer flow.
 *
 * Opt in with PW_LIVE_XFER=1. These tests broadcast real testnet state
 * transitions and spend testnet credits, so they are skipped by default and are
 * not part of `npm run test:e2e`.
 *
 * Stage 1 creates a destination identity through the bridge's own create mode,
 * funded by the built-in testnet faucet.
 * Stage 2 transfers a username to it and verifies the result on-chain.
 */
const LIVE = process.env.PW_LIVE_XFER === '1';
const LIVE_URL = '/?network=testnet';

test.describe('Live testnet username transfer', () => {
  test.skip(!LIVE, 'set PW_LIVE_XFER=1 to run');

  test('create a destination identity via the faucet', async ({ page }) => {
    test.setTimeout(15 * 60_000);

    await page.goto(LIVE_URL);
    await page.click('#mode-create-btn');
    await page.click('#continue-btn');

    await expect(page.locator('.deposit-headline')).toBeVisible({ timeout: 60_000 });

    // Capture the mnemonic so the identity is reusable after the run.
    const depositAddress = await page.locator('.deposit-address, .address-value, code').first().innerText();
    console.log('DEPOSIT ADDRESS:', depositAddress.trim());

    await page.click('#request-faucet-btn');

    // Faucet solves a proof-of-work challenge, then the deposit must confirm
    // and the identity register — all of which is slow on a live network.
    await expect(page.getByText('Save your keys')).toBeVisible({ timeout: 13 * 60_000 });

    const identityId = await page
      .locator('.contract-id-section', { hasText: 'Your Identity ID' })
      .locator('.identity-id')
      .innerText();
    // Best-effort: the recovery phrase may sit behind a reveal control, in
    // which case this logs nothing and the identity is single-use.
    const words = await page.locator('.mnemonic-word').allInnerTexts();
    const phrase = words.map((w) => w.replace(/^\s*\d+\.\s*/, '').trim()).join(' ');

    console.log('DESTINATION IDENTITY:', identityId.trim());
    console.log('DESTINATION MNEMONIC:', phrase || '(not captured — reveal it in the UI to reuse)');
    expect(identityId.trim().length).toBeGreaterThan(40);
  });

  test('top up the source identity via the faucet', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const identityId = process.env.PW_XFER_TOPUP;
    test.skip(!identityId, 'set PW_XFER_TOPUP=<identityId> to run');

    await page.goto(LIVE_URL);
    await page.click('#mode-topup-btn');
    await page.fill('#identity-id-input', identityId!);
    await page.click('#continue-topup-btn');

    await expect(page.locator('.deposit-headline')).toBeVisible({ timeout: 60_000 });
    await page.click('#request-faucet-btn');

    await expect(page.getByText('Top-up complete!')).toBeVisible({ timeout: 13 * 60_000 });
    console.log('TOPPED UP:', identityId);
  });

  test('transfer a username to the destination identity', async ({ page }) => {
    test.setTimeout(10 * 60_000);

    const seed = process.env.PW_XFER_SEED;
    const recipient = process.env.PW_XFER_RECIPIENT;
    const username = process.env.PW_XFER_USERNAME;
    test.skip(!seed || !recipient || !username, 'needs PW_XFER_SEED / _RECIPIENT / _USERNAME');

    page.on('console', (m) => console.log(`[browser:${m.type()}]`, m.text()));

    await page.goto(LIVE_URL);
    await page.click('#mode-manage-btn');
    await page.click('#manage-action-transfer-btn');

    // Seed phrase alone must be enough to find the identity and its signing key.
    await page.fill('#xfer-mnemonic-input', seed!);
    await page.click('#xfer-unlock-btn');

    await expect(page.locator('.xfer-username-list')).toBeVisible({ timeout: 3 * 60_000 });
    const signingKey = await page.locator('.key-status.success').innerText();
    console.log('SIGNING KEY:', signingKey);
    // Must skip the MASTER key at index 0 and pick an eligible one.
    expect(signingKey).toMatch(/HIGH|CRITICAL/);

    const owned = await page.locator('.xfer-username-label').allInnerTexts();
    console.log('OWNED USERNAMES:', owned.join(', '));
    expect(owned).toContain(username!);

    await page
      .locator('.xfer-username-option', { hasText: username! })
      .locator('.xfer-username-radio')
      .click({ force: true });

    // A well-formed but nonexistent recipient must be refused before anything
    // is signed. (Not a string of "1"s — that decodes to 44 zero bytes and is
    // rejected as malformed by the local check, which is a different path.)
    const bogus = 'cEtJ6iEvm51o1zW56pKpytoE8bx8M1Z5bHNR3wBfwae';
    await page.fill('#xfer-recipient-input', bogus);
    await page.locator('#xfer-recipient-input').blur();
    await expect(page.getByText(/No identity with this ID exists/)).toBeVisible({ timeout: 2 * 60_000 });
    await expect(page.locator('#xfer-select-continue-btn')).toBeDisabled();
    console.log('OK: nonexistent recipient refused pre-broadcast');

    await page.fill('#xfer-recipient-input', recipient!);
    await page.locator('#xfer-recipient-input').blur();
    await expect(page.getByText('Destination identity found')).toBeVisible({ timeout: 2 * 60_000 });

    await page.click('#xfer-select-continue-btn');
    await expect(page.getByText('Confirm Transfer')).toBeVisible();
    await page.locator('#xfer-confirm-checkbox').click({ force: true });
    await page.click('#xfer-transfer-btn');

    await expect(page.getByText(/Username Transferred!|Transfer Failed/)).toBeVisible({ timeout: 5 * 60_000 });
    const headline = await page.locator('.xfer-headline').innerText();
    console.log('RESULT:', headline);
    await expect(page.getByText('Username Transferred!')).toBeVisible();
  });
});
