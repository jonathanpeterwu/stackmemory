import { describe, it, expect } from 'vitest';
import { filterPending, type PendingItem } from '../pending-utils.js';

const base: PendingItem[] = [
  { approvalId: 'a1', task: 'Refactor loader', createdAt: 1000 },
  { approvalId: 'a2', task: 'Add tests', createdAt: 2000 },
  { approvalId: 'a3', task: 'Refactor parser', createdAt: 3000 },
  { approvalId: 'a4', task: 'Docs update', createdAt: null },
];

describe('pending-utils filterPending', () => {
  it('filters by taskContains (case-insensitive)', () => {
    const out = filterPending(base, { taskContains: 'refactor' }, 5000);
    expect(out.map((x) => x.approvalId)).toEqual(['a1', 'a3']);
  });

  it('filters by olderThanMs', () => {
    const out = filterPending(base, { olderThanMs: 1500 }, 5000);
    // createdAt must exist and be older than 1500ms ago
    expect(out.map((x) => x.approvalId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('filters by newerThanMs', () => {
    const out = filterPending(base, { newerThanMs: 2500 }, 5000);
    // newer than threshold: now - createdAt < 2500 => createdAt > 2500
    expect(out.map((x) => x.approvalId)).toEqual(['a3']);
  });

  it('sorts asc/desc and applies limit', () => {
    const asc = filterPending(base, { sort: 'asc' }, 5000);
    expect(asc.map((x) => x.approvalId)).toEqual(['a1', 'a2', 'a3', 'a4']);
    const desc = filterPending(base, { sort: 'desc', limit: 2 }, 5000);
    expect(desc.map((x) => x.approvalId)).toEqual(['a4', 'a3']);
  });
});
