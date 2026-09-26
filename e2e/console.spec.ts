/** Console forms, from the owner's side. */
import { expect, test } from '@playwright/test';
import { CONSOLE, GTL, api, asAnother, at, signInConsole, signInStudio } from './helpers';

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

test('the owner sets which platform courses an academy may offer, and the academy\'s catalogue follows', async ({ page, browser }, info) => {
  await signInConsole(page, 'owner');
  await page.goto(at(CONSOLE, '/academies'));
  const gtl = (await api<{ tenants: { id: string; primaryDomain: string }[] }>(page, '/api/console/tenants')).body.tenants
    .find((t) => t.primaryDomain === GTL)!;
  await page.goto(at(CONSOLE, `/academies/${gtl.id}`));
  const section = page.getByRole('region', { name: 'Courses it may offer' });
  const box = section.getByRole('checkbox').first();
  const title = (await section.locator('label.check').first().locator('span span').first().textContent())!;
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(section.locator('.notice.caution')).toContainText(`Saving takes ${title} away from its learners at once`);
  await section.getByRole('button', { name: 'Save allowed courses' }).click();
  await expect(box).not.toBeChecked();

  const admin = await asAnother(browser, info);
  await signInStudio(admin.page, GTL, 'admin');
  await admin.page.goto(at(GTL, '/studio/catalogue'));
  await expect(admin.page.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeVisible();
  await expect(admin.page.getByRole('switch', { name: `Offer ${title} to learners` })).toHaveCount(0);

  // Put it back as it was: allowed, and on.
  await box.check();
  await section.getByRole('button', { name: 'Save allowed courses' }).click();
  await expect(box).toBeChecked();
  await admin.page.reload();
  await admin.page.getByRole('switch', { name: `Offer ${title} to learners` }).click();
  await expect(admin.page.getByRole('switch', { name: `Offer ${title} to learners` })).toHaveAttribute('aria-checked', 'true');
  await admin.close();
});
