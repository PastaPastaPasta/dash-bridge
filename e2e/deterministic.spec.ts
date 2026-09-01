import { expect, test } from '@playwright/test';
import {
  E2E_MOCK_DPNS_WIF,
  E2E_MOCK_IDENTITY_ID,
  E2E_MOCK_MANAGE_WIF,
  E2E_MOCK_WITHDRAW_WIF,
  E2E_MOCK_WITHDRAW_ADDRESS,
  E2E_MOCK_XFER_MNEMONIC,
  E2E_MOCK_XFER_RECIPIENT_ID,
} from '../src/e2e-mock-constants';

const MOCK_QUERY = '/?network=testnet&e2e=mock';

test.describe('Deterministic UI E2E (mock mode)', () => {
  test('create identity flow transitions to completion and DPNS registration', async ({ page }) => {
    await page.goto(MOCK_QUERY);

    await page.click('#mode-create-btn');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

    await page.click('#continue-btn');

    await expect(page.locator('.deposit-headline')).toBeVisible();
    await expect.poll(async () => {
      return page.evaluate(() => typeof (window as { __e2eMockAdvance?: () => void }).__e2eMockAdvance);
    }).toBe('function');
    await page.evaluate(() => (window as { __e2eMockAdvance?: () => void }).__e2eMockAdvance?.());

    await expect(page.getByText('Save your keys')).toBeVisible();
    await expect(page.locator('.contract-id-section', { hasText: 'Your Identity ID' }).locator('.identity-id')).toHaveText(E2E_MOCK_IDENTITY_ID);

    await page.click('#dpns-from-identity-btn');
    await expect(page.getByText('Choose Your Usernames')).toBeVisible();

    const usernameInput = page.locator('.dpns-username-input').first();
    await usernameInput.fill('alpha');
    await page.click('#check-availability-btn');

    await expect(page.getByText('Review Usernames')).toBeVisible();
    await expect(page.getByText('Available (Contested)')).toBeVisible();
    await expect(page.locator('#dpns-contested-checkbox')).toBeVisible();
    await expect(page.locator('#register-dpns-btn')).toBeDisabled();

    await page.locator('#dpns-contested-checkbox').click({ force: true });
    await expect(page.locator('#register-dpns-btn')).toBeEnabled();

    await page.click('#register-dpns-btn');
    await expect(page.getByText('Registration Complete!')).toBeVisible();
  });

  test('top up flow validates identity input and reaches completion', async ({ page }) => {
    await page.goto(MOCK_QUERY);

    await page.click('#mode-topup-btn');
    await expect(page.locator('#identity-id-input')).toBeVisible();

    await page.click('#continue-topup-btn');
    await expect(page.locator('#validation-msg')).toContainText('Please enter a valid identity ID');

    await page.fill('#identity-id-input', E2E_MOCK_IDENTITY_ID);
    await page.click('#continue-topup-btn');

    await expect(page.locator('.deposit-headline')).toBeVisible();
    await expect.poll(async () => {
      return page.evaluate(() => typeof (window as { __e2eMockAdvance?: () => void }).__e2eMockAdvance);
    }).toBe('function');
    await page.evaluate(() => (window as { __e2eMockAdvance?: () => void }).__e2eMockAdvance?.());

    await expect(page.getByText('Top-up complete!')).toBeVisible();
    await expect(page.locator('.contract-id-section', { hasText: 'Identity ID' }).locator('.identity-id')).toHaveText(E2E_MOCK_IDENTITY_ID);
  });

  test('manage identity flow validates key and applies changes', async ({ page }) => {
    await page.goto(MOCK_QUERY);

    await page.click('#mode-manage-btn');
    await expect(page.locator('#manage-action-keys-btn')).toBeVisible();

    await page.click('#manage-action-keys-btn');
    await expect(page.locator('#manage-identity-id-input')).toBeVisible();

    await page.fill('#manage-identity-id-input', E2E_MOCK_IDENTITY_ID);
    await page.locator('#manage-identity-id-input').press('Tab');
    await expect(page.getByText('Identity found with 2 keys')).toBeVisible();

    await page.fill('#manage-private-key-input', 'bad-key');
    await page.locator('#manage-private-key-input').press('Tab');
    await expect(page.getByText('Mock mode: use the configured test private key')).toBeVisible();

    await page.fill('#manage-private-key-input', E2E_MOCK_MANAGE_WIF);
    await page.locator('#manage-private-key-input').blur();
    await expect(page.getByText('Manage Keys')).toBeVisible();

    await page.click('#add-manage-key-btn');
    await page.locator('.manage-disable-key-checkbox').first().click({ force: true });
    await expect(page.getByText('Will add 1 key, disable 1 key')).toBeVisible();

    await page.click('#apply-manage-btn');
    await expect(page.getByText('Update Complete!')).toBeVisible();
  });

  test('withdraw flow validates inputs and completes with status tracking', async ({ page }) => {
    await page.goto(MOCK_QUERY);

    await page.click('#mode-withdraw-btn');
    await expect(page.locator('#withdraw-identity-id-input')).toBeVisible();

    // Invalid identity ID is rejected
    await page.fill('#withdraw-identity-id-input', 'nope');
    await page.locator('#withdraw-identity-id-input').press('Tab');
    await expect(page.getByText(/Invalid identity ID/)).toBeVisible();

    // Valid identity advances to configure with the balance shown
    await page.fill('#withdraw-identity-id-input', E2E_MOCK_IDENTITY_ID);
    await page.locator('#withdraw-identity-id-input').press('Tab');
    await expect(page.getByText('Configure Withdrawal')).toBeVisible();
    await expect(page.locator('.withdraw-balance')).toContainText('0.25 DASH');

    // Wrong WIF is rejected, the mock WIF validates as a TRANSFER key
    await page.fill('#withdraw-private-key-input', 'bad-key');
    await page.locator('#withdraw-private-key-input').press('Tab');
    await expect(page.getByText('Mock mode: use the configured test private key')).toBeVisible();

    await page.fill('#withdraw-private-key-input', E2E_MOCK_WITHDRAW_WIF);
    await page.locator('#withdraw-private-key-input').press('Tab');
    await expect(page.getByText('Key matches key #3 (TRANSFER / CRITICAL)')).toBeVisible();

    // Bad address is rejected (real validation runs even in mock mode)
    await page.fill('#withdraw-address-input', 'not-an-address');
    await page.locator('#withdraw-address-input').press('Tab');
    await expect(page.locator('#withdraw-address-error')).toBeVisible();

    await page.fill('#withdraw-address-input', E2E_MOCK_WITHDRAW_ADDRESS);
    await page.locator('#withdraw-address-input').press('Tab');
    await expect(page.locator('#withdraw-address-error')).toHaveCount(0);

    // Amount below the minimum, above the balance, then valid
    await page.fill('#withdraw-amount-input', '0.000001');
    await page.locator('#withdraw-amount-input').press('Tab');
    await expect(page.locator('#withdraw-amount-error')).toContainText('Minimum withdrawal');

    await page.fill('#withdraw-amount-input', '1');
    await page.locator('#withdraw-amount-input').press('Tab');
    await expect(page.locator('#withdraw-amount-error')).toContainText('exceeds your balance');
    await expect(page.locator('#withdraw-submit-btn')).toBeDisabled();

    await page.fill('#withdraw-amount-input', '0.1');
    await page.locator('#withdraw-amount-input').press('Tab');
    await expect(page.locator('#withdraw-amount-credits')).toContainText('10,000,000,000 credits');
    await expect(page.locator('#withdraw-submit-btn')).toBeEnabled();

    // Submit walks the mock status sequence to completion
    await page.click('#withdraw-submit-btn');
    await expect(page.getByText('Withdrawal Complete!')).toBeVisible();
    const details = page.locator('.withdraw-success-details');
    await expect(details).toContainText('Amount: 0.1 DASH');
    await expect(details).toContainText(E2E_MOCK_WITHDRAW_ADDRESS);
    await expect(details).toContainText('Remaining balance: 0.15 DASH');
  });

  test('standalone DPNS flow validates identity + key and completes registration', async ({ page }) => {
    await page.goto(MOCK_QUERY);

    await page.click('#mode-dpns-btn');
    await expect(page.getByText('Register a Username')).toBeVisible();

    await page.click('#dpns-choose-existing-btn');
    await expect(page.locator('#dpns-identity-id-input')).toBeVisible();

    await page.fill('#dpns-identity-id-input', E2E_MOCK_IDENTITY_ID);
    await page.locator('#dpns-identity-id-input').press('Tab');
    await expect(page.getByText('Identity found with 2 keys')).toBeVisible();

    await page.fill('#dpns-private-key-input', E2E_MOCK_DPNS_WIF);
    await page.locator('#dpns-private-key-input').press('Tab');
    await expect(page.getByText('Key matches key #1 (CRITICAL level)')).toBeVisible();

    await page.click('#dpns-identity-continue-btn');
    await expect(page.getByText('Choose Your Usernames')).toBeVisible();

    await page.locator('.dpns-username-input').first().fill('noncontested123456789012345');
    await page.click('#check-availability-btn');

    await expect(page.getByText('Review Usernames')).toBeVisible();
    await expect(page.locator('#register-dpns-btn')).toBeEnabled();

    await page.click('#register-dpns-btn');
    await expect(page.getByText('Registration Complete!')).toBeVisible();
  });

  test('username transfer flow discovers the identity from a seed phrase and completes', async ({ page }) => {
    await page.goto(MOCK_QUERY);

    await page.click('#mode-manage-btn');
    await page.click('#manage-action-transfer-btn');
    await expect(page.locator('#xfer-mnemonic-input')).toBeVisible();

    // A phrase that fails the BIP39 checksum is rejected before any lookup.
    await page.fill('#xfer-mnemonic-input', 'abandon abandon abandon');
    await page.click('#xfer-unlock-btn');
    await expect(page.getByText('That is not a valid BIP39 seed phrase.')).toBeVisible();

    await page.fill('#xfer-mnemonic-input', E2E_MOCK_XFER_MNEMONIC);
    await page.click('#xfer-unlock-btn');

    await expect(page.getByText('Signing with key #1 (HIGH level)')).toBeVisible();
    await expect(page.locator('.xfer-username-option')).toHaveCount(2);
    await expect(page.locator('#xfer-select-continue-btn')).toBeDisabled();

    await page.locator('.xfer-username-radio').first().click({ force: true });

    // A malformed destination is rejected without a network round trip.
    await page.fill('#xfer-recipient-input', 'not-an-identity');
    await page.locator('#xfer-recipient-input').blur();
    await expect(page.getByText(/Invalid identity ID/)).toBeVisible();

    // Transferring to yourself is a no-op the SDK would reject anyway.
    await page.fill('#xfer-recipient-input', E2E_MOCK_IDENTITY_ID);
    await page.locator('#xfer-recipient-input').blur();
    await expect(page.getByText('This is the identity that already owns the username')).toBeVisible();
    await expect(page.locator('#xfer-select-continue-btn')).toBeDisabled();

    await page.fill('#xfer-recipient-input', E2E_MOCK_XFER_RECIPIENT_ID);
    await page.locator('#xfer-recipient-input').blur();
    await expect(page.getByText('Destination identity found')).toBeVisible();
    await expect(page.locator('#xfer-select-continue-btn')).toBeEnabled();

    await page.click('#xfer-select-continue-btn');
    await expect(page.getByText('Confirm Transfer')).toBeVisible();
    await expect(page.locator('#xfer-transfer-btn')).toBeDisabled();

    await page.locator('#xfer-confirm-checkbox').click({ force: true });
    await expect(page.locator('#xfer-transfer-btn')).toBeEnabled();

    await page.click('#xfer-transfer-btn');
    await expect(page.getByText('Username Transferred!')).toBeVisible();
    await expect(
      page.locator('.contract-id-section', { hasText: 'New Owner' }).locator('.identity-id')
    ).toHaveText(E2E_MOCK_XFER_RECIPIENT_ID);
  });
});
