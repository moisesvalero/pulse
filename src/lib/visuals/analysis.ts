import type { VisualBands } from './renderer';

/**
 * Turns an `AnalyserNode` spectrum into the three bands the shaders consume.
 *
 * The interesting part is `computeBands` and `smoothBands`: both are pure, so the
 * band maths can be unit tested without a browser or an audio device.
 */

export interface BandSpec {
	/** Lower edge in Hz. */
	from: number;
	/** Upper edge in Hz. */
	to: number;
	/**
	 * Post-average gain. `getByteFrequencyData` returns decibel-scaled bytes, and
	 * high frequencies carry far less energy than low ones in almost all music,
	 * so the treble band needs more gain than the bass band to feel balanced.
	 */
	gain: number;
}

export interface BandConfig {
	bass: BandSpec;
	mid: BandSpec;
	treble: BandSpec;
}

export const DEFAULT_BAND_CONFIG: BandConfig = {
	bass: { from: 25, to: 160, gain: 1.6 },
	mid: { from: 160, to: 2000, gain: 1.3 },
	treble: { from: 2000, to: 11000, gain: 1.9 }
};

/**
 * Attack is fast and release is slow: the visuals snap on a transient and then
 * decay, which is what makes them look like they are reacting to the music
 * instead of merely following it.
 */
export const DEFAULT_ATTACK = 0.55;
export const DEFAULT_RELEASE = 0.12;

export const EMPTY_BANDS: VisualBands = { bass: 0, mid: 0, treble: 0, level: 0 };

/**
 * Averages the spectrum over a frequency window.
 *
 * @param spectrum byte magnitudes from `getByteFrequencyData` (0..255 each).
 */
export function averageBand(
	spectrum: Uint8Array,
	sampleRate: number,
	binCount: number,
	spec: BandSpec
): number {
	if (spectrum.length === 0 || sampleRate <= 0 || binCount <= 0) return 0;

	const nyquist = sampleRate / 2;
	const toBin = (hertz: number): number =>
		Math.min(spectrum.length - 1, Math.max(0, Math.round((hertz / nyquist) * binCount)));

	const first = toBin(spec.from);
	// Always cover at least one bin: a very narrow band must not divide by zero.
	const last = Math.max(first, toBin(spec.to));

	let total = 0;
	let counted = 0;
	for (let bin = first; bin <= last; bin += 1) {
		total += spectrum[bin];
		counted += 1;
	}

	return counted === 0 ? 0 : total / counted / 255;
}

/** Extracts the three bands plus an overall level, each clamped to 0..1. */
export function computeBands(
	spectrum: Uint8Array,
	sampleRate: number,
	fftSize: number,
	config: BandConfig = DEFAULT_BAND_CONFIG
): VisualBands {
	const binCount = Math.floor(fftSize / 2);

	if (spectrum.length === 0) return { ...EMPTY_BANDS };

	let total = 0;
	for (let bin = 0; bin < spectrum.length; bin += 1) total += spectrum[bin];

	return {
		bass: clamp01(averageBand(spectrum, sampleRate, binCount, config.bass) * config.bass.gain),
		mid: clamp01(averageBand(spectrum, sampleRate, binCount, config.mid) * config.mid.gain),
		treble: clamp01(
			averageBand(spectrum, sampleRate, binCount, config.treble) * config.treble.gain
		),
		level: clamp01(total / spectrum.length / 255)
	};
}

/** Asymmetric exponential smoothing: quick to rise, slow to fall. */
export function smoothBands(
	previous: VisualBands,
	next: VisualBands,
	attack = DEFAULT_ATTACK,
	release = DEFAULT_RELEASE
): VisualBands {
	return {
		bass: approach(previous.bass, next.bass, attack, release),
		mid: approach(previous.mid, next.mid, attack, release),
		treble: approach(previous.treble, next.treble, attack, release),
		level: approach(previous.level, next.level, attack, release)
	};
}

export interface BandReader {
	/** Samples the analyser and returns the smoothed bands. */
	read(): VisualBands;
	reset(): void;
}

/** Binds a reader to an analyser, reusing one buffer and the previous envelope. */
export function createBandReader(
	analyser: AnalyserNode,
	options: { config?: BandConfig; attack?: number; release?: number } = {}
): BandReader {
	const spectrum = new Uint8Array(analyser.frequencyBinCount);
	let bands: VisualBands = { ...EMPTY_BANDS };

	return {
		read() {
			analyser.getByteFrequencyData(spectrum);

			const measured = computeBands(
				spectrum,
				analyser.context.sampleRate,
				analyser.fftSize,
				options.config
			);

			bands = smoothBands(bands, measured, options.attack, options.release);
			return bands;
		},

		reset() {
			bands = { ...EMPTY_BANDS };
		}
	};
}

function approach(previous: number, next: number, attack: number, release: number): number {
	const factor = next > previous ? attack : release;
	return previous + (next - previous) * factor;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}
