/**
 * Slider mappings.
 *
 * Audio ranges are rarely linear in a useful way: a 80 Hz -> 18 kHz cutoff
 * spends 95% of a linear slider in the top two octaves, which makes the bottom
 * of the range unusable. These helpers convert between a normalised slider
 * position (0..1) and the real value, with either a linear or a logarithmic
 * curve.
 */

export type Curve = 'linear' | 'log';

/** Real value -> slider position, 0..1. */
export function toNormalized(value: number, min: number, max: number, curve: Curve = 'linear'): number {
	if (max === min) return 0;

	const clamped = Math.min(max, Math.max(min, value));

	if (curve === 'log') {
		if (min <= 0) {
			throw new RangeError('A logarithmic mapping needs a positive minimum.');
		}
		return Math.log(clamped / min) / Math.log(max / min);
	}

	return (clamped - min) / (max - min);
}

/** Slider position, 0..1 -> real value. */
export function fromNormalized(position: number, min: number, max: number, curve: Curve = 'linear'): number {
	const t = Math.min(1, Math.max(0, position));

	if (curve === 'log') {
		if (min <= 0) {
			throw new RangeError('A logarithmic mapping needs a positive minimum.');
		}
		return min * Math.pow(max / min, t);
	}

	return min + (max - min) * t;
}
