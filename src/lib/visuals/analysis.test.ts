import { describe, expect, it } from 'vitest';
import {
	averageBand,
	computeBands,
	DEFAULT_BAND_CONFIG,
	EMPTY_BANDS,
	smoothBands
} from './analysis';

/** Builds a 1024-bin spectrum with the given bin ranges set to `value`. */
function spectrumWith(entries: Array<[number, number, number]>, length = 1024): Uint8Array {
	const spectrum = new Uint8Array(length);
	for (const [from, to, value] of entries) {
		for (let bin = from; bin <= to; bin += 1) spectrum[bin] = value;
	}
	return spectrum;
}

/** 48 kHz / fftSize 2048 -> 1024 bins -> 23.44 Hz per bin. */
const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;

describe('averageBand', () => {
	it('averages only the bins inside the frequency window', () => {
		const spectrum = spectrumWith([[0, 1023, 0]]);
		// 25..160 Hz -> bins 1..7
		spectrum[1] = 255;
		spectrum[7] = 255;

		const average = averageBand(spectrum, SAMPLE_RATE, FFT_SIZE / 2, DEFAULT_BAND_CONFIG.bass);

		// 2 of 7 bins at full scale.
		expect(average).toBeCloseTo(2 / 7, 5);
	});

	it('returns zero for an empty spectrum', () => {
		expect(averageBand(new Uint8Array(0), SAMPLE_RATE, 1024, DEFAULT_BAND_CONFIG.bass)).toBe(0);
	});

	it('returns zero instead of dividing by zero for a degenerate sample rate', () => {
		expect(averageBand(new Uint8Array(16), 0, 8, DEFAULT_BAND_CONFIG.bass)).toBe(0);
	});

	it('covers at least one bin for a window narrower than the resolution', () => {
		const spectrum = spectrumWith([[3, 3, 200]]);
		const narrow = { from: 70, to: 71, gain: 1 };

		expect(averageBand(spectrum, SAMPLE_RATE, FFT_SIZE / 2, narrow)).toBeCloseTo(200 / 255, 5);
	});
});

describe('computeBands', () => {
	it('returns silence for silence', () => {
		const bands = computeBands(new Uint8Array(1024), SAMPLE_RATE, FFT_SIZE);

		expect(bands).toEqual(EMPTY_BANDS);
	});

	it('separates a low tone into the bass band only', () => {
		// 50 Hz sits in bins 2..3.
		const bands = computeBands(spectrumWith([[2, 3, 255]]), SAMPLE_RATE, FFT_SIZE);

		expect(bands.bass).toBeGreaterThan(0);
		expect(bands.mid).toBe(0);
		expect(bands.treble).toBe(0);
	});

	it('separates a mid tone into the mid band only', () => {
		// 1 kHz -> bin 43.
		const bands = computeBands(spectrumWith([[43, 43, 255]]), SAMPLE_RATE, FFT_SIZE);

		expect(bands.bass).toBe(0);
		expect(bands.mid).toBeGreaterThan(0);
		expect(bands.treble).toBe(0);
	});

	it('separates a high tone into the treble band only', () => {
		// 6 kHz -> bin 256.
		const bands = computeBands(spectrumWith([[256, 256, 255]]), SAMPLE_RATE, FFT_SIZE);

		expect(bands.bass).toBe(0);
		expect(bands.mid).toBe(0);
		expect(bands.treble).toBeGreaterThan(0);
	});

	it('clamps every band to 0..1 even with heavy gain', () => {
		const bands = computeBands(spectrumWith([[0, 1023, 255]]), SAMPLE_RATE, FFT_SIZE);

		for (const value of [bands.bass, bands.mid, bands.treble, bands.level]) {
			expect(value).toBeLessThanOrEqual(1);
			expect(value).toBeGreaterThanOrEqual(0);
		}
	});

	it('measures the overall level as the mean of the whole spectrum', () => {
		const bands = computeBands(spectrumWith([[0, 511, 255]]), SAMPLE_RATE, FFT_SIZE);

		expect(bands.level).toBeCloseTo(0.5, 3);
	});

	it('never returns NaN for an empty spectrum', () => {
		const bands = computeBands(new Uint8Array(0), SAMPLE_RATE, FFT_SIZE);

		for (const value of Object.values(bands)) expect(Number.isFinite(value)).toBe(true);
	});
});

describe('smoothBands', () => {
	const loud = { bass: 1, mid: 1, treble: 1, level: 1 };

	it('rises faster than it falls, which is what makes the visuals punchy', () => {
		const rising = smoothBands(EMPTY_BANDS, loud);
		const falling = smoothBands(loud, EMPTY_BANDS);

		// Compare the fraction of the gap covered in one frame, not the absolute
		// value: starting from silence the value stays low while the fall starts
		// high, so absolute values would compare the wrong thing.
		const gapCoveredRising = rising.bass - EMPTY_BANDS.bass;
		const gapCoveredFalling = loud.bass - falling.bass;

		expect(gapCoveredRising).toBeGreaterThan(gapCoveredFalling);
		expect(gapCoveredRising).toBeCloseTo(0.55, 9);
		expect(gapCoveredFalling).toBeCloseTo(0.12, 9);
	});

	it('moves monotonically towards the target', () => {
		const half = smoothBands(EMPTY_BANDS, loud);

		expect(half.bass).toBeGreaterThan(0);
		expect(half.bass).toBeLessThan(1);
	});

	it('is a no-op when the target equals the previous value', () => {
		expect(smoothBands(loud, loud)).toEqual(loud);
	});

	it('converges on the target if the same value is held', () => {
		let bands = EMPTY_BANDS;
		for (let step = 0; step < 60; step += 1) bands = smoothBands(bands, loud);

		expect(bands.bass).toBeCloseTo(1, 6);
	});

	it('respects explicit attack and release factors', () => {
		const half = smoothBands(EMPTY_BANDS, loud, 0.5, 0.5);

		expect(half.bass).toBeCloseTo(0.5, 9);
	});
});
