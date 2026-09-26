/** Module 4b · stage 2: the line under each tier's bar, which the server words and the app shows as given. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierOutlook } from '../src/domain/placement.js';

test('each tier says what opens next, and how far off it is', () => {
  const b = { learn: 44, safeguard: 40, apply: 44, specialise: 46 };
  assert.equal(tierOutlook('learn', b), 'Apply opens at 50. 6 points to go.');
  assert.equal(tierOutlook('safeguard', b), 'Specialise also needs 50 here. 10 points to go.');
  assert.equal(tierOutlook('apply', b), 'Opens when Learn reaches 50. 6 points to go.');
  assert.equal(tierOutlook('specialise', b), 'Opens when Learn reaches 70 and Safeguard reaches 50.');

  const nearly = { learn: 69, safeguard: 50, apply: 0, specialise: 0 };
  assert.equal(tierOutlook('learn', nearly), 'Specialise opens at 70. 1 point to go.');
  assert.equal(tierOutlook('safeguard', nearly), 'Enough for every tier.');
  assert.equal(tierOutlook('apply', nearly), 'Open now.');

  const all = { learn: 70, safeguard: 50, apply: 0, specialise: 0 };
  assert.equal(tierOutlook('learn', all), 'Enough for every tier.');
  assert.equal(tierOutlook('specialise', all), 'Open now.');
});
