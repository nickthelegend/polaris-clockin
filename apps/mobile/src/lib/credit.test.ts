import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDue } from './credit';
test('a payment one hour past due is already overdue', () => {
  const now = new Date(2026, 9, 8, 12);
  assert.match(fmtDue(now.getTime() / 1000 - 3600, now), /overdue$/);
});
test('due labels use calendar days, including a midnight crossing', () => {
  const now = new Date(2026, 9, 8, 23, 30);
  assert.match(fmtDue(new Date(2026, 9, 9, 0, 30).getTime() / 1000, now), /in 1 day$/);
  assert.match(fmtDue(new Date(2026, 9, 8, 23, 45).getTime() / 1000, now), /today$/);
});
