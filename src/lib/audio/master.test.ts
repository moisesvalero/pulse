import { describe, expect, it } from 'vitest';
import { delaySecondsForBpm } from './master';

describe('delaySecondsForBpm', () => {
	it('returns a dotted eighth, the classic sequencer delay', () => {
		// 120 BPM -> 0.5 s per beat -> dotted eighth = 0.375 s.
		expect(delaySecondsForBpm(120)).toBeCloseTo(0.375, 9);
		expect(delaySecondsForBpm(60)).toBeCloseTo(0.75, 9);
	});

	it('shortens the delay as the tempo rises, keeping it locked to the grid', () => {
		expect(delaySecondsForBpm(160)).toBeLessThan(delaySecondsForBpm(90));
	});

	it('never divides by zero for a degenerate tempo', () => {
		expect(Number.isFinite(delaySecondsForBpm(0))).toBe(true);
		expect(delaySecondsForBpm(0)).toBeGreaterThan(0);
		expect(Number.isFinite(delaySecondsForBpm(-10))).toBe(true);
	});
});
