/**
 * The studio's main path, through the browser: an author writes a course
 * and a lesson with the learner preview beside it, a reviewer sends it
 * back and then approves it, compliance publishes it.
 */
import { expect, test, type Page } from '@playwright/test';
import { inline, parseLesson } from '../packages/shared/markdown';
import { GTL, api, asAnother, at, expectAccessible, shot, signInStudio, unique } from './helpers';

const BODY = [
  '## What a spread is',
  'The gap between the **bid** and the ask, which a [[market maker|a firm quoting both sides]] keeps.',
  '',
  '## Why it matters',
  'Every trade pays it once, going in.',
  '',
  '> **In practice**',
  '> Check the spread before the price.',
].join('\n');

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 1100;

/** On a phone, the preview is a tap away; on a desktop, it is always beside the form. */
async function showPreview(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Preview', exact: true }).click();
}
async function showForm(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Write', exact: true }).click();
}

async function addQuestion(page: Page, n: number) {
  await page.getByRole('button', { name: 'Add a check question' }).click();
  await page.getByLabel(`Question ${n}`, { exact: true }).fill(`Question ${n} about spreads?`);
  for (const k of ['A', 'B', 'C']) {
    await page.getByLabel(`Option ${k} of question ${n}`).fill(`Answer ${k}`);
    await page.getByLabel(`Why option ${k} is right or wrong`).nth(n - 1).fill(`Because ${k} is how it works.`);
  }
}

test('an author writes a lesson against the learner preview, and three people take it to learners', async ({ page, browser }, info) => {
  const courseTitle = unique('Spreads');
  const lessonTitle = unique('Reading a spread');

  await signInStudio(page, GTL, 'author');
  await page.getByRole('link', { name: 'Start a new course' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Start a new course' })).toBeVisible();
  await page.getByLabel('Title').fill(courseTitle);
  await page.getByLabel('Summary').fill('What a spread costs, and how to read it.');
  await page.getByRole('button', { name: 'Create course draft' }).click();
  await page.waitForURL(/\/studio\/courses\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: courseTitle })).toBeVisible();

  await page.getByRole('link', { name: 'Add a lesson' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New lesson' })).toBeVisible();
  await page.getByLabel('Title').fill(lessonTitle);
  await page.getByRole('button', { name: 'Create lesson draft' }).click();
  await page.waitForURL(/\/studio\/lessons\//);
  await expect(page.getByText('Version 1')).toBeVisible();

  // The preview follows the text as it is typed, through the shared renderer.
  await page.getByLabel('Lesson text').fill(BODY);
  await showPreview(page);
  const preview = page.getByRole('figure', { name: 'Learner preview' });
  await expect(preview.getByRole('heading', { name: 'What a spread is' })).toBeVisible();
  const doc = parseLesson(BODY);
  expect(await preview.locator('.step p').first().innerHTML()).toBe(inline(doc.steps[0]!.p));
  expect(await preview.locator('.callout p').innerHTML()).toBe(inline(doc.callout!.p));
  await expect(preview.getByText('a firm quoting both sides')).toBeVisible();
  await showForm(page);

  // Not ready until it has five questions.
  await expect(page.getByText('Add 5 more check questions: a lesson needs 5.')).toBeVisible();
  for (let n = 1; n <= 5; n++) await addQuestion(page, n);
  await expect(page.getByText('Ready to send for review.')).toBeVisible();
  await expect(page.getByText('5 of 5 needed')).toBeVisible();
  await showPreview(page);
  await expect(preview.getByText('3 of the 5 questions below are drawn each time. 2 of 3 correct to pass.')).toBeVisible();
  await shot(page, info, 'lesson-editor');
  await showForm(page);
  await expectAccessible(page, 'the lesson editor');

  // Sending for review saves first.
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('In expert review').first()).toBeVisible();
  const lessonUrl = page.url();

  // A reviewer sends it back with notes.
  const reviewer = await asAnother(browser, info);
  await signInStudio(reviewer.page, GTL, 'reviewer');
  await reviewer.page.goto(at(GTL, '/studio/review'));
  await reviewer.page.getByRole('link', { name: new RegExp(lessonTitle) }).click();
  await expect(reviewer.page.getByRole('figure', { name: 'Learner preview' }).getByRole('heading', { name: 'Why it matters' })).toBeVisible();
  await shot(reviewer.page, info, 'version-review');
  await reviewer.page.getByRole('button', { name: 'Send back with notes' }).click();
  await reviewer.page.getByLabel('Notes for the author').fill('Say who pays the spread.');
  await reviewer.page.getByRole('dialog').getByRole('button', { name: 'Send back with notes' }).click();
  await expect(reviewer.page.getByText('Sent back').first()).toBeVisible();

  // The author reads the notes and revises.
  await page.goto(lessonUrl);
  await expect(page.getByText('Say who pays the spread.')).toBeVisible();
  await page.getByRole('button', { name: 'Start a revision' }).click();
  await expect(page.getByLabel('Lesson text')).toBeVisible();
  await page.getByLabel('Lesson text').fill(BODY.replace('Every trade pays it once', 'The trader pays it once on every trade'));
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('In expert review').first()).toBeVisible();

  // The reviewer approves; compliance publishes. The course goes the same way first.
  await reviewer.page.goto(at(GTL, '/studio/review'));
  await reviewer.page.getByRole('link', { name: new RegExp(lessonTitle) }).click();
  await reviewer.page.getByRole('button', { name: 'Approve for compliance' }).click();
  await expect(reviewer.page.getByText('In compliance review').first()).toBeVisible();
  await reviewer.close();

  await page.goto(lessonUrl);
  await page.getByRole('link', { name: courseTitle }).click();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('In expert review').first()).toBeVisible();
  const courseUrl = page.url();

  const second = await asAnother(browser, info);
  await signInStudio(second.page, GTL, 'reviewer');
  await second.page.goto(courseUrl);
  await second.page.getByRole('button', { name: 'Approve for compliance' }).click();
  await expect(second.page.getByText('In compliance review').first()).toBeVisible();
  await second.close();

  const compliance = await asAnother(browser, info);
  await signInStudio(compliance.page, GTL, 'compliance');
  await compliance.page.goto(courseUrl);
  await compliance.page.getByRole('button', { name: 'Publish to learners' }).click();
  await expect(compliance.page.getByText('Published').first()).toBeVisible();
  await compliance.page.goto(lessonUrl);
  await compliance.page.getByRole('button', { name: 'Publish to learners' }).click();
  await expect(compliance.page.getByRole('heading', { level: 1, name: lessonTitle })).toBeVisible();
  await expect(compliance.page.getByText('Published').first()).toBeVisible();
  await compliance.close();

  // The author cannot publish their own work: the button is never offered.
  await page.goto(courseUrl);
  await expect(page.getByRole('button', { name: 'Publish to learners' })).toHaveCount(0);
});

test('an admin offers a course, invites a colleague once, and cannot save an unreadable brand', async ({ page }, info) => {
  await signInStudio(page, GTL, 'admin');

  await page.goto(at(GTL, '/studio/catalogue'));
  const first = page.getByRole('switch').first();
  const name = await first.getAttribute('aria-label');
  const was = await first.getAttribute('aria-checked');
  await first.click();
  await expect(page.getByRole('switch', { name: name! })).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  await expect(page.getByRole('switch', { name: name! })).toBeFocused();
  await page.getByRole('switch', { name: name! }).click();
  await shot(page, info, 'catalogue');

  await page.goto(at(GTL, '/studio/team'));
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const email = `${unique('colleague').replace(/\s/g, '-')}@example.com`;
  await page.getByLabel('Their email').fill(email);
  await page.getByRole('dialog').getByRole('checkbox', { name: /^Author/ }).check();
  await page.getByRole('button', { name: 'Make the invitation link' }).click();
  const link = await page.getByRole('dialog').getByLabel('Invitation link').inputValue();
  expect(link).toMatch(new RegExp(`^http://${GTL}:\\d+/studio/invite/[A-Za-z0-9_-]{40,}$`));
  await shot(page, info, 'team-invite');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(link!.split('/invite/')[1]!);

  await page.goto(at(GTL, '/studio/settings/brand'));
  await page.getByLabel('Secondary text').fill('#C8CDD4');
  await expect(page.getByText('Too faint').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save brand' })).toBeDisabled();
  await shot(page, info, 'brand-refused');
});

test('learner search says when nobody matches', async ({ page }, info) => {
  await signInStudio(page, GTL, 'admin');
  await page.goto(at(GTL, '/studio/learners'));
  await expect(page.getByRole('heading', { level: 1, name: 'Learners' })).toBeVisible();
  await page.getByLabel('Find a learner').fill('zzzz-nobody');
  await expect(page.getByText('Nobody matches “zzzz-nobody”.')).toBeVisible();
  await shot(page, info, 'learners');
});

/** A course and one lesson draft, made through the API as the author signed in on this page. */
async function draftLesson(page: Page, extra: Record<string, unknown> = {}) {
  const course = (await api<{ version: { entityId: string } }>(page, '/api/studio/courses', {
    method: 'POST', data: { title: unique('Fixes course'), summary: 'For the fixes.', tier: 'learn', estMinutes: 20 },
  })).body;
  const lesson = (await api<{ version: { entityId: string } }>(page, `/api/studio/courses/${course.version.entityId}/lessons`, {
    method: 'POST', data: { position: 1, title: unique('Fixes lesson'), minutes: 8, bodyMd: '## A step\nSome text.', ...extra },
  })).body;
  return { courseId: course.version.entityId, lessonId: lesson.version.entityId };
}

test('a refused save shows its message beside the field it names, and takes the author there', async ({ page }) => {
  await signInStudio(page, GTL, 'author');
  const { lessonId } = await draftLesson(page);
  await page.goto(at(GTL, `/studio/lessons/${lessonId}`));
  await expect(page.getByText('Version 1')).toBeVisible();

  const video = page.getByRole('textbox', { name: /^Video/ });
  await video.fill('https://cdn.example.com/a video.mp4');
  await page.getByRole('button', { name: 'Save draft' }).click();
  const field = page.locator('.field').filter({ has: video });
  await expect(field.locator('.error')).toBeVisible();
  await expect(video).toHaveAttribute('aria-invalid', 'true');
  await expect(video).toBeFocused();

  // A refusal that names no field lands at the top of the form, in view.
  await video.fill('');
  await page.getByRole('button', { name: 'Send for review' }).click();
  const top = page.locator('.editor-form .notice.danger');
  await expect(top).toContainText('not ready for review');
  await expect(top).toContainText('A lesson needs at least 5 check questions');
  await expect(top).toBeInViewport();
});

test('the video field says what it accepts, and checks it as the author types', async ({ page }) => {
  await signInStudio(page, GTL, 'author');
  const { lessonId } = await draftLesson(page);
  await page.goto(at(GTL, `/studio/lessons/${lessonId}`));
  const video = page.getByRole('textbox', { name: 'Video asset reference' });
  const field = page.locator('.field').filter({ has: video });
  await expect(field).toContainText('Letters, digits and / _ . - only');
  await video.fill('https://cdn.example.com/a.mp4');
  await expect(field.locator('.error')).toHaveText('Use the asset\'s name in the media store, not a web address.');
  await video.fill('lessons/a spread.mp4');
  await expect(field.locator('.error')).toHaveText('Take out the spaces.');
  await video.fill('lessons/a-spread.mp4');
  await expect(field.locator('.error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
});

test('a draft saves with a question still being written; the checklist only advises', async ({ page }) => {
  await signInStudio(page, GTL, 'author');
  const { lessonId } = await draftLesson(page);
  await page.goto(at(GTL, `/studio/lessons/${lessonId}`));
  await page.getByRole('button', { name: 'Add a check question' }).click();
  await page.getByLabel('Option A of question 1').fill('Half an answer');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await expect(page.locator('.notice.danger')).toHaveCount(0);
  await expect(page.getByText('Question 1 needs its question.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Option A of question 1')).toHaveValue('Half an answer');
});

async function inviteSomeone(page: Page) {
  await page.goto(at(GTL, '/studio/team'));
  await page.getByRole('button', { name: 'Invite someone' }).click();
  await page.getByLabel('Their email').fill(`${unique('linked').replace(/\s/g, '-')}@example.com`);
  await page.getByRole('dialog').getByRole('checkbox', { name: /^Reviewer/ }).check();
  await page.getByRole('button', { name: 'Make the invitation link' }).click();
  return page.getByRole('dialog').getByLabel('Invitation link');
}

test('on plain http a one-time link is a field that selects itself, with no Copy button to fail', async ({ page }) => {
  await signInStudio(page, GTL, 'admin');
  const field = await inviteSomeone(page);
  const link = await field.inputValue();
  expect(link).toContain('/studio/invite/');
  await expect(field).toHaveAttribute('readonly', '');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await field.click();
  expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, link.length]);
});

test('where the clipboard exists but refuses, Copy says so and the link stays, selected', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  await signInStudio(page, GTL, 'admin');
  const field = await inviteSomeone(page);
  const link = await field.inputValue();
  await page.getByRole('dialog').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('dialog').getByText('Could not copy it.', { exact: false })).toBeVisible();
  await expect(field).toHaveValue(link);
  await expect(field).toBeFocused();
  expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, link.length]);
});

test('an open invitation can be reissued: the old link stops working and the new one is shown once', async ({ page, browser }, info) => {
  await signInStudio(page, GTL, 'admin');
  const field = await inviteSomeone(page);
  const oldLink = await field.inputValue();
  const email = (await page.getByRole('dialog').getByRole('heading').textContent())!.replace('Send this link to ', '');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: `Reissue invitation for ${email}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The link sent before no longer works.');
  const newLink = await dialog.getByLabel('Invitation link').inputValue();
  expect(newLink).not.toBe(oldLink);

  const visitor = await asAnother(browser, info);
  await visitor.page.goto(oldLink);
  await visitor.page.getByLabel('Your name').fill('Late Reader');
  await visitor.page.getByLabel('Password').fill('a long enough password');
  await visitor.page.getByRole('button', { name: 'Join the studio' }).click();
  await expect(visitor.page.locator('.notice.danger')).toContainText('expired, been used');
  await visitor.close();
});

/** A lesson through expert review, its course left as a draft: made with the API as each person in turn. */
async function lessonAwaitingCompliance(page: Page) {
  await signInStudio(page, GTL, 'author');
  const made = await draftLesson(page, { questions: [1, 2, 3, 4, 5].map((n) => ({
    prompt: `Q${n}?`, options: [{ key: 'a', text: 'Yes' }, { key: 'b', text: 'No' }], correctKey: 'a', rationales: { a: 'Right.', b: 'Wrong.' },
  })) });
  const versions = (await api<{ versions: { id: string }[] }>(page, `/api/studio/entities/lesson/${made.lessonId}/versions`)).body.versions;
  expect((await api(page, `/api/studio/versions/${versions[0]!.id}/submit`, { method: 'POST' })).status).toBe(200);
  await signInStudio(page, GTL, 'reviewer');
  expect((await api(page, `/api/studio/versions/${versions[0]!.id}/approve`, { method: 'POST' })).status).toBe(200);
  return made;
}

test('publishing a lesson whose course is a draft says nothing reaches learners yet, and leads to the course', async ({ page }) => {
  const { courseId, lessonId } = await lessonAwaitingCompliance(page);
  await signInStudio(page, GTL, 'compliance');
  await page.goto(at(GTL, `/studio/lessons/${lessonId}`));
  await page.getByRole('button', { name: 'Publish to learners' }).click();
  const notice = page.getByRole('status').filter({ hasText: 'Published, but not yet seen by learners.' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('is still a draft. Nothing in it reaches learners until the course itself is published.');

  await notice.getByRole('link', { name: 'Go to the course and where it stands' }).click();
  await page.waitForURL(new RegExp(`/studio/courses/${courseId}#where$`));
  const where = page.getByRole('region', { name: 'Where the course stands' });
  await expect(where).toContainText('Draft');
  await expect(where).toContainText('Learners see none of its lessons until the course itself is published');
  const lessons = page.getByRole('heading', { level: 2, name: 'Lessons' });
  expect((await where.boundingBox())!.y).toBeLessThan((await lessons.boundingBox())!.y);
});

test('the course list gives the course\'s state and its lessons\' separately', async ({ page }) => {
  const { courseId, lessonId } = await lessonAwaitingCompliance(page);
  await signInStudio(page, GTL, 'compliance');
  const versions = (await api<{ versions: { id: string }[] }>(page, `/api/studio/entities/lesson/${lessonId}/versions`)).body.versions;
  expect((await api(page, `/api/studio/versions/${versions[0]!.id}/publish`, { method: 'POST' })).status).toBe(200);
  await signInStudio(page, GTL, 'author');
  expect((await api(page, `/api/studio/courses/${courseId}/lessons`, {
    method: 'POST', data: { position: 2, title: unique('Second lesson'), minutes: 5, bodyMd: '' },
  })).status).toBe(201);

  await page.goto(at(GTL, '/studio'));
  const title = (await api<{ course: { title: string } }>(page, `/api/studio/courses/${courseId}`)).body.course.title;
  const row = page.getByRole('link', { name: new RegExp(title) });
  await expect(row).toContainText('Draft');
  await expect(row).toContainText('1 lesson published, 1 in draft');
});
