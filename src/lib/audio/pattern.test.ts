import { describe, expect, it } from 'vitest';
import { MELODIC_TRACK_IDS, STEPS_PER_BAR, TRACK_IDS } from './constants';
import {
	clonePattern,
	countActiveSteps,
	createDefaultPattern,
	createEmptyPattern,
	DEFAULT_SCALE,
	isInScale,
	LANE_RANGES,
	MINOR_PENTATONIC,
	quantizeToScale,
	randomizePattern,
	scalePitches
} from './pattern';

/**
 * Small seeded PRNG (mulberry32). Injecting it into `randomizePattern` is what
 * makes the randomiser testable: same seed, same pattern, every run.
 */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('scale helpers', () => {
	it('knows the A minor pentatonic pitch classes', () => {
		// A=9, C=0, D=2, E=4, G=7 relative to the root.
		for (const offset of MINOR_PENTATONIC) {
			expect(isInScale(DEFAULT_SCALE.root + offset, DEFAULT_SCALE)).toBe(true);
		}
		// B and F are not in A minor pentatonic.
		expect(isInScale(DEFAULT_SCALE.root + 2, DEFAULT_SCALE)).toBe(false);
		expect(isInScale(DEFAULT_SCALE.root + 8, DEFAULT_SCALE)).toBe(false);
	});

	it('lists ascending in-scale pitches inside a window', () => {
		const pitches = scalePitches(DEFAULT_SCALE, LANE_RANGES.bass.min, LANE_RANGES.bass.max);

		expect(pitches.length).toBeGreaterThan(4);
		expect(pitches).toEqual([...pitches].sort((a, b) => a - b));
		for (const pitch of pitches) {
			expect(isInScale(pitch, DEFAULT_SCALE)).toBe(true);
			expect(pitch).toBeGreaterThanOrEqual(LANE_RANGES.bass.min);
			expect(pitch).toBeLessThanOrEqual(LANE_RANGES.bass.max);
		}
	});

	it('quantises an out-of-scale note to the nearest scale member', () => {
		// B1 (35) is not in A minor pentatonic; C2 (36) and A1 (33) are.
		const quantised = quantizeToScale(35, DEFAULT_SCALE, 28, 48);

		expect(isInScale(quantised, DEFAULT_SCALE)).toBe(true);
		expect(Math.abs(quantised - 35)).toBeLessThanOrEqual(2);
	});

	it('leaves an in-scale note untouched', () => {
		expect(quantizeToScale(33, DEFAULT_SCALE, 28, 48)).toBe(33);
	});
});

describe('pattern constructors', () => {
	it('creates an empty pattern shaped for every lane', () => {
		const pattern = createEmptyPattern();

		for (const track of TRACK_IDS) {
			expect(pattern[track].gates).toHaveLength(STEPS_PER_BAR);
			expect(pattern[track].notes).toHaveLength(STEPS_PER_BAR);
			expect(pattern[track].gates.some(Boolean)).toBe(false);
		}
	});

	it('gives every lane the same lane keys, so serialisation cannot lose one', () => {
		expect(Object.keys(createEmptyPattern()).sort()).toEqual([...TRACK_IDS].sort());
	});

	it('ships a default groove that already sounds deliberate', () => {
		const pattern = createDefaultPattern();

		// Four-on-the-floor.
		expect(pattern.kick.gates.filter(Boolean)).toHaveLength(4);
		expect(pattern.kick.gates[0]).toBe(true);
		// Off-beat hats.
		expect(pattern.hat.gates[2]).toBe(true);
		expect(pattern.hat.gates[6]).toBe(true);
		expect(countActiveSteps(pattern, 'bass')).toBeGreaterThan(3);
		expect(countActiveSteps(pattern, 'pad')).toBe(2);

		for (const track of MELODIC_TRACK_IDS) {
			pattern[track].gates.forEach((gate, step) => {
				if (!gate) return;
				expect(isInScale(pattern[track].notes[step], DEFAULT_SCALE)).toBe(true);
				expect(pattern[track].notes[step]).toBeGreaterThanOrEqual(LANE_RANGES[track].min);
				expect(pattern[track].notes[step]).toBeLessThanOrEqual(LANE_RANGES[track].max);
			});
		}
	});

	it('clones deeply, so editing a copy cannot touch the original', () => {
		const original = createDefaultPattern();
		const copy = clonePattern(original);

		copy.bass.gates[0] = false;
		copy.lead.notes[4] = 12;

		expect(original.bass.gates[0]).toBe(true);
		expect(original.lead.notes[4]).toBe(69);
	});
});

describe('randomizePattern', () => {
	it('is deterministic for a given seed', () => {
		const first = randomizePattern(mulberry32(1234));
		const second = randomizePattern(mulberry32(1234));

		expect(first).toEqual(second);
	});

	it('produces different patterns for different seeds', () => {
		const first = randomizePattern(mulberry32(1));
		const second = randomizePattern(mulberry32(99));

		expect(first).not.toEqual(second);
	});

	it('always produces a valid, fully-populated pattern', () => {
		for (let seed = 0; seed < 50; seed += 1) {
			const pattern = randomizePattern(mulberry32(seed));

			for (const track of TRACK_IDS) {
				expect(pattern[track].gates).toHaveLength(STEPS_PER_BAR);
				expect(pattern[track].notes).toHaveLength(STEPS_PER_BAR);
			}
		}
	});

	it('keeps every generated note inside its lane range and inside the scale', () => {
		for (let seed = 0; seed < 50; seed += 1) {
			const pattern = randomizePattern(mulberry32(seed));

			for (const track of MELODIC_TRACK_IDS) {
				for (const note of pattern[track].notes) {
					expect(isInScale(note, DEFAULT_SCALE)).toBe(true);
					expect(note).toBeGreaterThanOrEqual(LANE_RANGES[track].min);
					expect(note).toBeLessThanOrEqual(LANE_RANGES[track].max);
				}
			}
		}
	});

	it('never generates two melodic lanes with the same register', () => {
		for (let seed = 0; seed < 25; seed += 1) {
			const pattern = randomizePattern(mulberry32(seed));
			const bassTop = Math.max(...pattern.bass.notes);
			const leadBottom = Math.min(...pattern.lead.notes);

			expect(bassTop).toBeLessThan(leadBottom);
		}
	});

	it('always anchors the kick on the downbeat, at any density', () => {
		for (const density of [0, 0.1, 0.5, 1]) {
			for (let seed = 0; seed < 20; seed += 1) {
				const pattern = randomizePattern(mulberry32(seed), { density });
				expect(pattern.kick.gates[0]).toBe(true);
			}
		}
	});

	it('keeps only the anchor steps at density 0', () => {
		const pattern = randomizePattern(mulberry32(7), { density: 0 });

		expect(countActiveSteps(pattern, 'kick')).toBe(1);
		expect(countActiveSteps(pattern, 'hat')).toBe(0);
		expect(countActiveSteps(pattern, 'bass')).toBe(1);
		expect(countActiveSteps(pattern, 'lead')).toBe(0);
		expect(countActiveSteps(pattern, 'pad')).toBe(0);
	});

	it('gets denser as the density control rises', () => {
		const sparse = averageGates(0.1);
		const dense = averageGates(0.9);

		expect(dense).toBeGreaterThan(sparse);
	});

	it('keeps the pad sparse: it is a bed, not a rhythm', () => {
		for (let seed = 0; seed < 50; seed += 1) {
			const pattern = randomizePattern(mulberry32(seed), { density: 1 });
			expect(countActiveSteps(pattern, 'pad')).toBeLessThanOrEqual(2);
		}
	});

	it('accepts a custom scale and stays inside it', () => {
		const majorPentatonic = { root: 36, intervals: [0, 2, 4, 7, 9] };
		const pattern = randomizePattern(mulberry32(5), { scale: majorPentatonic });

		for (const track of MELODIC_TRACK_IDS) {
			for (const note of pattern[track].notes) {
				expect(isInScale(note, majorPentatonic)).toBe(true);
			}
		}
	});

	it('gives every gated melodic step an actual note', () => {
		const pattern = randomizePattern(mulberry32(3));

		for (const track of MELODIC_TRACK_IDS) {
			pattern[track].gates.forEach((gate, step) => {
				if (gate) expect(Number.isFinite(pattern[track].notes[step])).toBe(true);
			});
		}
	});
});

function averageGates(density: number): number {
	let total = 0;
	const runs = 40;

	for (let seed = 0; seed < runs; seed += 1) {
		const pattern = randomizePattern(mulberry32(seed), { density });
		total += TRACK_IDS.reduce((sum, track) => sum + countActiveSteps(pattern, track), 0);
	}

	return total / runs;
}
