import { describe, expect, it } from 'vitest';
import { type CandidateFacts, ineligibleReason } from './candidates';
import { pickLeastLoaded, pickRoundRobin, pickWeighted, type WeightState } from './pick';

const T = ['a', 'b', 'c'];
const all = new Set(T);

describe('pickRoundRobin', () => {
  it('rotates evenly a → b → c → a', () => {
    let cursor = 0;
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = pickRoundRobin(T, cursor, all)!;
      picks.push(r.userId);
      cursor = r.state;
    }
    expect(picks).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('skips an OFF sales and the turn moves to the next person (AC 6.3)', () => {
    const r = pickRoundRobin(T, 1, new Set(['a', 'c']))!; // b is OFF
    expect(r).toEqual({ userId: 'c', state: 0 });
    // b comes back: rotation continues from a, b keeps its place in the order
    expect(pickRoundRobin(T, r.state, all)!.userId).toBe('a');
  });

  it('90 leads over 3 sales → 30/30/30', () => {
    const counts: Record<string, number> = {};
    let cursor = 0;
    for (let i = 0; i < 90; i++) {
      const r = pickRoundRobin(T, cursor, all)!;
      counts[r.userId] = (counts[r.userId] ?? 0) + 1;
      cursor = r.state;
    }
    expect(counts).toEqual({ a: 30, b: 30, c: 30 });
  });

  it('handles a stale cursor beyond the list and empty pools', () => {
    expect(pickRoundRobin(T, 7, all)!.userId).toBe('b');
    expect(pickRoundRobin(T, 0, new Set())).toBeNull();
    expect(pickRoundRobin([], 0, all)).toBeNull();
  });
});

describe('pickWeighted', () => {
  it('distributes by weight (2:1:1) smoothly', () => {
    let state: WeightState = { weights: { a: 2, b: 1, c: 1 }, current: {} };
    const picks: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = pickWeighted(T, state, all)!;
      picks.push(r.userId);
      state = r.state;
    }
    expect(picks.filter((p) => p === 'a')).toHaveLength(4);
    expect(picks.filter((p) => p === 'b')).toHaveLength(2);
    expect(picks.filter((p) => p === 'c')).toHaveLength(2);
    expect(picks[0]).toBe('a');
    expect(picks[1]).not.toBe('a'); // smooth: no back-to-back for a 2:1:1 split
  });

  it('defaults missing weights to 1 and skips ineligible users', () => {
    const r = pickWeighted(T, null, new Set(['c']))!;
    expect(r.userId).toBe('c');
    expect(pickWeighted(T, null, new Set())).toBeNull();
  });
});

describe('pickLeastLoaded', () => {
  it('chooses the fewest open leads, ties by order', () => {
    const load = new Map([['a', 5], ['b', 2], ['c', 2]]);
    expect(pickLeastLoaded(T, load, all)!.userId).toBe('b');
    expect(pickLeastLoaded(T, load, new Set(['a', 'c']))!.userId).toBe('c');
  });
});

describe('ineligibleReason (SPEC 6.3.3)', () => {
  const base: CandidateFacts = { id: 'a', fullName: 'A', status: 'AVAILABLE', deletedAt: null, maxOpenLeads: 40, openLeads: 3, onLeave: false };
  it.each([
    [{}, null],
    [{ status: 'BUSY' as const }, 'NOT_AVAILABLE'],
    [{ status: 'OFF' as const }, 'NOT_AVAILABLE'],
    [{ status: 'INACTIVE' as const }, 'INACTIVE'],
    [{ deletedAt: new Date() }, 'INACTIVE'],
    [{ onLeave: true }, 'ON_LEAVE'],
    [{ openLeads: 40 }, 'AT_CAPACITY'],
  ])('%o → %s', (patch, expected) => {
    expect(ineligibleReason({ ...base, ...patch }, new Set())).toBe(expected);
  });
  it('excludes users who returned / let this lead expire', () => {
    expect(ineligibleReason(base, new Set(['a']))).toBe('EXCLUDED');
  });
});
