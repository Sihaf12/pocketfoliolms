/** Console forms, from the owner's side. */
import { expect, test } from '@playwright/test';
import { CONSOLE, api, at, signInConsole } from './helpers';

test('adding an academy says what the short name and domain accept, and shows a refusal beside its field', async ({ page }) => {
  await signInConsole(page, 'owner');
  await page.goto(at(CONSOLE, '/academies/new'));
  const slug = page.getByLabel('Short name');
  const domain = page.getByLabel('Domain');
  const slugField = page.locator('.field').filter({ has: slug });
  const domainField = page.locator('.field').filter({ has: domain });
  await expect(slugField).toContainText('Lowercase letters, digits and hyphens');
  await expect(domainField).toContainText('A host name with no port, path or https://');

  await slug.fill('Harbour Trading');
  await expect(slugField.locator('.error')).toHaveText('Use lowercase letters.');
  await slug.fill('harbour trading');
  await expect(slugField.locator('.error')).toHaveText('Use hyphens instead of spaces.');
  await slug.fill(`e2e-${Date.now().toString(36)}`);
  await expect(slugField.locator('.error')).toHaveCount(0);

  await domain.fill('learn.harbour.test:8080');
  await expect(domainField.locator('.error')).toHaveText('Leave out the port.');
  await expect(page.getByRole('button', { name: 'Create academy' })).toBeDisabled();

  // Well-formed but taken: the API's refusal lands beside the Domain field.
  await domain.fill('gtl.academy.test');
  await page.getByLabel('Name', { exact: true }).fill('Harbour Trading');
  await page.getByLabel("First admin's email").fill('first-admin@example.com');
  await page.getByRole('button', { name: 'Create academy' }).click();
  await expect(domainField.locator('.error')).toHaveText('Another academy already uses that domain.');
  await expect(domain).toBeFocused();
});

test('the first admin\'s invitation can be reissued from the academy\'s page', async ({ page }) => {
  await signInConsole(page, 'owner');
  await page.goto(at(CONSOLE, '/academies'));
  const slug = `e2e-${Date.now().toString(36)}`;
  const made = await api<{ tenant: { id: string }; link: string }>(page, '/api/console/tenants', {
    method: 'POST', data: { slug, name: 'Reissue Academy', primaryDomain: `${slug}.academy.test`, adminEmail: `${slug}@example.com` },
  });
  expect(made.status).toBe(201);
  await page.goto(at(CONSOLE, `/academies/${made.body.tenant.id}`));
  await expect(page.getByText('Not joined yet')).toBeVisible();
  await page.getByRole('button', { name: 'Reissue invitation' }).click();
  const link = page.getByLabel("First admin's invitation link");
  await expect(link).toBeVisible();
  expect(await link.inputValue()).not.toBe(made.body.link);
  await expect(page.getByText('The link sent before no longer works.')).toBeVisible();
});
