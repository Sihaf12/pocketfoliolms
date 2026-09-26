/**
 * Module 4a · the review workflow rules. Pure: no database. The trigger
 * in 008 enforces the same machine; the studio proof tests that side.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableActions, decide, dutiesOf, requiredSignoffs, separationRefusal,
  type Attempt, type ReviewAction, type ReviewState,
} from '../src/domain/review.js';

const NOBODY = { author: null, reviewer: null, publisher: null };

function attempt(over: Partial<Attempt>): Attempt {
  return { action: 'submit', state: 'draft', actorDuties: ['author'], actorId: 'ann', notes: null, signoffs: NOBODY, required: 2, ...over };
}

test('each action moves one state to the next, and only from where it is legal', () => {
  const legal: [ReviewAction, ReviewState, Attempt['actorDuties'][number], ReviewState][] = [
    ['submit', 'draft', 'author', 'in_expert_review'],
    ['approve', 'in_expert_review', 'reviewer', 'in_compliance_review'],
    ['reject', 'in_expert_review', 'reviewer', 'rejected'],
    ['reject', 'in_compliance_review', 'compliance', 'rejected'],
    ['publish', 'in_compliance_review', 'compliance', 'published'],
    ['retire', 'published', 'compliance', 'retired'],
    ['revise', 'rejected', 'author', 'draft'],
    ['revise', 'published', 'author', 'draft'],
  ];
  for (const [action, state, duty, to] of legal) {
    const out = decide(attempt({ action, state, actorDuties: [duty], actorId: 'zed', notes: 'fix step 2', signoffs: { author: 'ann', reviewer: 'rob', publisher: null } }));
    assert.deepEqual(out, { ok: true, to }, `${action} from ${state}`);
  }

  const illegal: [ReviewAction, ReviewState][] = [
    ['publish', 'draft'], ['publish', 'in_expert_review'], ['approve', 'draft'], ['approve', 'rejected'],
    ['submit', 'in_expert_review'], ['retire', 'draft'], ['reject', 'published'], ['revise', 'draft'],
    ['submit', 'approved'], ['publish', 'approved'],
  ];
  for (const [action, state] of illegal) {
    const out = decide(attempt({ action, state, actorDuties: ['compliance'], notes: 'n' }));
    assert.equal(out.ok, false, `${action} from ${state}`);
    if (!out.ok) assert.equal(out.refusal.code, 'illegal_transition', `${action} from ${state}`);
  }
});

test('each step belongs to one duty', () => {
  const out = decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: ['reviewer'] }));
  assert.equal(!out.ok && out.refusal.code, 'wrong_role');
  const admin = decide(attempt({ action: 'approve', state: 'in_expert_review', actorDuties: [] }));
  assert.equal(!admin.ok && admin.refusal.code, 'wrong_role', 'a tenant admin has no review duty');
});

test('sending a version back needs notes', () => {
  for (const notes of [null, '', '   ']) {
    const out = decide(attempt({ action: 'reject', state: 'in_expert_review', actorDuties: ['reviewer'], notes }));
    assert.equal(!out.ok && out.refusal.code, 'notes_required');
  }
});

test('the floor: the author never publishes their own work, whatever the setting', () => {
  for (const required of [2, 3]) {
    const out = decide(attempt({
      action: 'publish', state: 'in_compliance_review', actorDuties: ['compliance'], actorId: 'ann', required,
      signoffs: { author: 'ann', reviewer: 'rob', publisher: null },
    }));
    assert.equal(!out.ok && out.refusal.code, 'separation', `at ${required}`);
  }
});

test('at two, the reviewer may be the author or the publisher; at three, all three differ', () => {
  const selfReviewed = { author: 'ann', reviewer: 'ann', publisher: null };
  const two = decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: ['compliance'], actorId: 'cat', required: 2, signoffs: selfReviewed }));
  assert.deepEqual(two, { ok: true, to: 'published' }, 'two people: ann wrote and reviewed, cat published');

  const three = decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: ['compliance'], actorId: 'cat', required: 3, signoffs: selfReviewed }));
  assert.equal(!three.ok && three.refusal.code, 'separation');

  const reviewerPublishes = decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: ['compliance'], actorId: 'rob', required: 3, signoffs: { author: 'ann', reviewer: 'rob', publisher: null } }));
  assert.equal(!reviewerPublishes.ok && reviewerPublishes.refusal.code, 'separation');

  const approveOwn = decide(attempt({ action: 'approve', state: 'in_expert_review', actorDuties: ['reviewer'], actorId: 'ann', required: 3, signoffs: { author: 'ann', reviewer: null, publisher: null } }));
  assert.equal(!approveOwn.ok && approveOwn.refusal.code, 'separation', 'refused at approval, before it reaches compliance');

  const allDifferent = decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: ['compliance'], actorId: 'cat', required: 3, signoffs: { author: 'ann', reviewer: 'rob', publisher: null } }));
  assert.deepEqual(allDifferent, { ok: true, to: 'published' });
});

test('the setting has a floor of two and a ceiling of three; platform content is always three', () => {
  assert.equal(requiredSignoffs('academy', null), 2, 'the default');
  assert.equal(requiredSignoffs('academy', 2), 2);
  assert.equal(requiredSignoffs('academy', 3), 3);
  for (const bad of [0, 1, 4, 2.5]) {
    assert.throws(() => requiredSignoffs('academy', bad), RangeError, `${bad}`);
  }
  for (const setting of [null, 2, 3]) {
    assert.equal(requiredSignoffs('platform', setting), 3, 'platform content ignores any academy setting');
  }
  assert.ok(separationRefusal({ author: 'ann', reviewer: 'ann', publisher: 'cat' }, requiredSignoffs('platform', 2)),
    'a platform version reviewed by its author cannot be published');
});

test('the studio offers each duty only what it can do now', () => {
  assert.deepEqual(availableActions('draft', ['author']), ['submit']);
  assert.deepEqual(availableActions('in_expert_review', ['reviewer']), ['approve', 'reject']);
  assert.deepEqual(availableActions('in_compliance_review', ['compliance']), ['reject', 'publish']);
  assert.deepEqual(availableActions('published', ['compliance']), ['retire']);
  assert.deepEqual(availableActions('published', ['author']), ['revise']);
  assert.deepEqual(availableActions('in_expert_review', ['author']), []);
  assert.deepEqual(availableActions('draft', []), []);
});

test('a person holding every role is still one person', () => {
  const everything = dutiesOf(['author', 'reviewer', 'compliance', 'tenant_admin']);
  assert.deepEqual(everything.sort(), ['author', 'compliance', 'reviewer']);
  assert.deepEqual(dutiesOf(['tenant_admin']), [], 'an admin alone has no review duty');
  assert.deepEqual(dutiesOf(['platform_author', 'platform_reviewer']).sort(), ['author', 'reviewer']);

  // Ann holds every role. She may approve someone else's work, but her own
  // is still hers: at two she cannot publish it, at three she cannot even
  // approve it.
  const annWrote = { author: 'ann', reviewer: null, publisher: null };
  assert.deepEqual(decide(attempt({ action: 'approve', state: 'in_expert_review', actorDuties: everything, actorId: 'ann',
    required: 2, signoffs: annWrote })), { ok: true, to: 'in_compliance_review' });
  const publishOwn = decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: everything, actorId: 'ann',
    required: 2, signoffs: { ...annWrote, reviewer: 'ann' } }));
  assert.equal(!publishOwn.ok && publishOwn.refusal.code, 'separation');
  const approveOwn = decide(attempt({ action: 'approve', state: 'in_expert_review', actorDuties: everything, actorId: 'ann',
    required: 3, signoffs: annWrote }));
  assert.equal(!approveOwn.ok && approveOwn.refusal.code, 'separation');

  // Rob also holds every role and publishes Ann's work at two: two people.
  assert.deepEqual(decide(attempt({ action: 'publish', state: 'in_compliance_review', actorDuties: everything, actorId: 'rob',
    required: 2, signoffs: { ...annWrote, reviewer: 'ann' } })), { ok: true, to: 'published' });
  assert.deepEqual(availableActions('in_expert_review', everything), ['approve', 'reject']);
});
