import { STEPS_PER_BAR, TRACK_IDS } from './constants';
import type { MelodicTrackId, Pattern, TrackId, TrackPattern } from './types';

/**
 * Pattern model and generation. Pure functions only: no Svelte runes, no Web
 * Audio. The store owns the mutable copy; this module produces and transforms.
 */

export interface Scale {
	/** MIDI note of the tonic. */
	root: number;
	/** Semitone offsets from the root, ascending. */
	intervals: readonly number[];
}

/**
 * A minor pentatonic. Five notes with no semitone clashes, so almost any
 * combination of steps sounds deliberate — the reason it is the default for the
 * randomiser.
 */
export const MINOR_PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];

export const DEFAULT_SCALE: Scale = { root: 33, intervals: MINOR_PENTATONIC };

/** MIDI windows each melodic lane is allowed to use. */
export const LANE_RANGES: Record<MelodicTrackId, { min: number; max: number }> = {
	// A1..C3: low enough to feel like a bass, high enough to survive a laptop speaker.
	bass: { min: 33, max: 48 },
	lead: { min: 57, max: 81 },
	pad: { min: 45, max: 72 }
};

/** Every pitch in the scale inside `[min, max]`, ascending. */
export function scalePitches(scale: Scale, min: number, max: number): number[] {
	const pitches: number[] = [];

	// Two octaves either side of the root are enough for any MIDI window here.
	for (let octave = -2; octave <= 4; octave += 1) {
		for (const interval of scale.intervals) {
			const midi = scale.root + octave * 12 + interval;
			if (midi >= min && midi <= max) pitches.push(midi);
		}
	}

	return [...new Set(pitches)].sort((a, b) => a - b);
}

/** True when `midi` belongs to the scale, in any octave. */
export function isInScale(midi: number, scale: Scale): boolean {
	const pitchClass = ((midi - scale.root) % 12 + 12) % 12;
	return scale.intervals.includes(pitchClass);
}

/** Snaps an arbitrary MIDI note to the nearest scale member. */
export function quantizeToScale(midi: number, scale: Scale, min: number, max: number): number {
	if (isInScale(midi, scale)) return clamp(midi, min, max);

	let best = clamp(midi, min, max);
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const pitch of scalePitches(scale, min, max)) {
		const distance = Math.abs(pitch - midi);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = pitch;
		}
	}

	return best;
}

export function createEmptyLane(): TrackPattern {
	return {
		gates: Array.from({ length: STEPS_PER_BAR }, () => false),
		notes: Array.from({ length: STEPS_PER_BAR }, () => DEFAULT_SCALE.root)
	};
}

export function createEmptyPattern(): Pattern {
	const pattern = {} as Pattern;
	for (const track of TRACK_IDS) {
		pattern[track] = createEmptyLane();
	}
	return pattern;
}

export function clonePattern(pattern: Pattern): Pattern {
	const clone = {} as Pattern;
	for (const track of TRACK_IDS) {
		clone[track] = {
			gates: [...pattern[track].gates],
			notes: [...pattern[track].notes]
		};
	}
	return clone;
}

/**
 * The groove Pulse boots with: four-on-the-floor kick, off-beat hats and an
 * A-minor-pentatonic bass line. It sounds intentional before the user touches
 * anything, which matters for a portfolio piece.
 */
export function createDefaultPattern(): Pattern {
	const pattern = createEmptyPattern();

	setGates(pattern.kick, [0, 4, 8, 12]);
	setGates(pattern.hat, [2, 6, 10, 14]);

	setSteps(pattern.bass, [
		[0, 33], // A1
		[3, 36], // C2
		[6, 40], // E2
		[8, 33], // A1
		[11, 38], // D2
		[14, 40] // E2
	]);

	setSteps(pattern.lead, [
		[4, 69], // A4
		[7, 72], // C5
		[12, 76] // E5
	]);

	setSteps(pattern.pad, [
		[0, 57], // A3
		[8, 64] // E4
	]);

	return pattern;
}

export interface RandomizeOptions {
	scale?: Scale;
	/**
	 * How busy the non-anchor steps get, 0..1. `0` keeps only the anchor steps
	 * (kick on the downbeat, a pad on each half of the bar).
	 */
	density?: number;
}

/**
 * Builds a coherent one-bar pattern.
 *
 * Coherence comes from three rules rather than from uniform randomness:
 *  1. Rhythm is anchored: the kick always lands on step 0, and each lane has
 *     strong/weak step weights so the result has a pulse.
 *  2. Every melodic note belongs to the scale.
 *  3. Melodic lanes move by small intervals (a random walk over scale degrees)
 *     with occasional leaps, instead of jumping anywhere in the range.
 *
 * @param random source of randomness in [0, 1); injected so tests are seeded.
 */
export function randomizePattern(
	random: () => number,
	options: RandomizeOptions = {}
): Pattern {
	const scale = options.scale ?? DEFAULT_SCALE;
	const density = clamp01(options.density ?? 0.55);
	const pattern = createEmptyPattern();

	// --- rhythm -------------------------------------------------------------
	// Weights are per step, so the result keeps a pulse even at low density.
	const kickWeights = [1, 0.05, 0.08, 0.12, 0.6, 0.08, 0.16, 0.1, 1, 0.05, 0.1, 0.14, 0.55, 0.1, 0.22, 0.12];
	const bassWeights = [1, 0.15, 0.25, 0.6, 0.2, 0.15, 0.55, 0.2, 0.9, 0.15, 0.3, 0.55, 0.2, 0.15, 0.5, 0.25];
	const leadWeights = [0.12, 0.1, 0.2, 0.35, 0.5, 0.2, 0.25, 0.4, 0.15, 0.15, 0.3, 0.45, 0.55, 0.2, 0.3, 0.4];
	const hatWeights = [0.35, 0.55, 0.6, 0.6, 0.35, 0.55, 0.6, 0.65, 0.4, 0.6, 0.6, 0.6, 0.45, 0.6, 0.65, 0.7];

	paintGates(pattern.kick, kickWeights, density, random, [0]);
	paintGates(pattern.hat, hatWeights, density, random, []);
	paintGates(pattern.bass, bassWeights, density, random, [0]);
	paintGates(pattern.lead, leadWeights, density * 0.8, random, []);
	// The pad is a bed, not a rhythm: it plays at most on the two half-bar marks.
	paintGates(pattern.pad, [0.9, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0], density, random, []);

	// --- pitch --------------------------------------------------------------
	pattern.bass.notes = randomWalkNotes(random, scale, LANE_RANGES.bass, 0, pattern.bass.gates);
	pattern.lead.notes = randomWalkNotes(random, scale, LANE_RANGES.lead, 2, pattern.lead.gates);
	pattern.pad.notes = randomWalkNotes(random, scale, LANE_RANGES.pad, 0, pattern.pad.gates);

	return pattern;
}

/**
 * Random walk over scale degrees: mostly steps of one or two degrees, with a
 * one-in-eight chance of a leap. Produces lines that sound like a player rather
 * than like a random-note generator.
 */
function randomWalkNotes(
	random: () => number,
	scale: Scale,
	range: { min: number; max: number },
	startOctaveOffset: number,
	gates: readonly boolean[]
): number[] {
	const pitches = scalePitches(
		{ root: scale.root + startOctaveOffset * 12, intervals: scale.intervals },
		range.min,
		range.max
	);
	const fallback = pitches[0];

	let index = Math.floor(random() * pitches.length);

	return gates.map((gate) => {
		if (gate) {
			const leap = random() < 0.125;
			const span = leap ? 4 : 2;
			const step = Math.floor(random() * (span * 2 + 1)) - span;
			index = Math.min(pitches.length - 1, Math.max(0, index + step));
		}

		return pitches[index] ?? fallback;
	});
}

function paintGates(
	lane: TrackPattern,
	weights: readonly number[],
	density: number,
	random: () => number,
	alwaysOn: readonly number[]
): void {
	lane.gates = weights.map((weight, step) => {
		if (alwaysOn.includes(step)) return true;
		if (density <= 0) return false;
		return random() < clamp01(weight * density);
	});
}

function setGates(lane: TrackPattern, steps: readonly number[]): void {
	for (const step of steps) lane.gates[step] = true;
}

function setSteps(lane: TrackPattern, steps: readonly (readonly [number, number])[]): void {
	for (const [step, midi] of steps) {
		lane.gates[step] = true;
		lane.notes[step] = midi;
	}
}

export function countActiveSteps(pattern: Pattern, track: TrackId): number {
	return pattern[track].gates.filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
	return clamp(value, 0, 1);
}
