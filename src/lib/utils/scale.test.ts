import { describe, expect, it } from 'vitest';
import { fromNormalized, toNormalized } from './scale';

describe('toNormalized', () => {
	it('maps a linear range onto 0..1', () => {
		expect(toNormalized(50, 0, 100)).toBeCloseTo(0.5, 9);
		expect(toNormalized(0, 0, 100)).toBe(0);
		expect(toNormalized(100, 0, 100)).toBe(1);
	});

	it('clamps values outside the range', () => {
		expect(toNormalized(-20, 0, 100)).toBe(0);
		expect(toNormalized(999, 0, 100)).toBe(1);
	});

	it('puts the geometric mean at the middle of a logarithmic range', () => {
		// sqrt(80 * 18000) ~= 1200 Hz
		expect(toNormalized(1200, 80, 18000, 'log')).toBeCloseTo(0.5, 6);
	});

	it('returns 0 for a degenerate range instead of dividing by zero', () => {
		expect(toNormalized(5, 5, 5)).toBe(0);
	});

	it('rejects a logarithmic range that starts at zero', () => {
		expect(() => toNormalized(10, 0, 100, 'log')).toThrow(RangeError);
	});
});

describe('fromNormalized', () => {
	it('is the inverse of toNormalized for a linear curve', () => {
		for (const value of [0, 12.5, 50, 87.5, 100]) {
			const position = toNormalized(value, 0, 100);
			expect(fromNormalized(position, 0, 100)).toBeCloseTo(value, 9);
		}
	});

	it('is the inverse of toNormalized for a logarithmic curve', () => {
		for (const value of [80, 200, 1200, 5000, 18000]) {
			const position = toNormalized(value, 80, 18000, 'log');
			expect(fromNormalized(position, 80, 18000, 'log')).toBeCloseTo(value, 6);
		}
	});

	it('clamps the slider position', () => {
		expect(fromNormalized(-1, 0, 100)).toBe(0);
		expect(fromNormalized(2, 0, 100)).toBe(100);
	});

	it('rejects a logarithmic range that starts at zero', () => {
		expect(() => fromNormalized(0.5, 0, 100, 'log')).toThrow(RangeError);
	});
});
