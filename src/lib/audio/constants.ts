import type { MasterParams, VoicePreset } from './types';
import type { TrackId } from './types';

/** Steps in one bar. The whole app assumes 16 (16th notes). */
export const STEPS_PER_BAR = 16;

/** Order of the lanes in the UI and in the persisted pattern. */
export const TRACK_IDS = ['bass', 'lead', 'pad', 'kick', 'hat'] as const satisfies readonly TrackId[];

export const TRACK_LABELS: Record<TrackId, string> = {
	bass: 'Bass',
	lead: 'Lead',
	pad: 'Pad',
	kick: 'Kick',
	hat: 'Hat'
};

/** Melodic voices: these read `notes` and are randomised inside a scale. */
export const MELODIC_TRACK_IDS = ['bass', 'lead', 'pad'] as const;

export const MIN_BPM = 50;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 110;

/** Seconds scheduled ahead of the audio clock on every timer tick. */
export const SCHEDULE_AHEAD_SECONDS = 0.12;
/** How often the interval timer wakes up to refill the schedule, in ms. */
export const SCHEDULER_TICK_MS = 25;
/** Hard cap of steps planned per tick; protects against a runaway loop if a
 *  tab was suspended and the audio clock jumped forward. */
export const MAX_STEPS_PER_TICK = 64;

/**
 * Max swing displacement as a fraction of a step. At `swing = 1` the off-beat
 * 16ths land two thirds of the way to the next beat (the classic 66% shuffle).
 */
export const SWING_MAX_FRACTION = 1 / 3;

export const DEFAULT_MASTER_PARAMS: MasterParams = {
	volume: 0.75,
	bpm: DEFAULT_BPM,
	cutoff: 6200,
	resonance: 1.2,
	delayMix: 0.22,
	reverbMix: 0.28
};

/**
 * Per-track synthesis presets. Values are deliberately a little conservative
 * because five voices can stack on the same 16th note.
 *
 * `oscillators[].detune` is in cents and stays constant while the pitch glides,
 * which is what gives the lead and pad their width.
 */
export const VOICE_PRESETS: Record<TrackId, VoicePreset> = {
	bass: {
		oscillators: [
			{ type: 'sawtooth', detune: 0, level: 1 },
			// Sub an octave below: adds weight without mudding the mid range.
			{ type: 'square', detune: -1200, level: 0.45 }
		],
		baseCutoff: 240,
		q: 7,
		filterEnvAmount: 1500,
		filterEnvDecay: 0.18,
		amp: { attack: 0.005, decay: 0.13, sustain: 0.35, release: 0.12 },
		glide: 0,
		level: 0.85
	},
	lead: {
		oscillators: [
			{ type: 'sawtooth', detune: -8, level: 0.8 },
			{ type: 'sawtooth', detune: 9, level: 0.8 },
			{ type: 'square', detune: 0, level: 0.35 }
		],
		baseCutoff: 900,
		q: 5,
		filterEnvAmount: 2600,
		filterEnvDecay: 0.24,
		amp: { attack: 0.008, decay: 0.18, sustain: 0.42, release: 0.2 },
		glide: 0.045,
		level: 0.5
	},
	pad: {
		oscillators: [
			{ type: 'triangle', detune: 0, level: 0.9 },
			{ type: 'sawtooth', detune: -7, level: 0.5 },
			{ type: 'sawtooth', detune: 7, level: 0.5 }
		],
		baseCutoff: 620,
		q: 2,
		filterEnvAmount: 900,
		filterEnvDecay: 0.6,
		amp: { attack: 0.35, decay: 0.5, sustain: 0.7, release: 1.1 },
		glide: 0.08,
		level: 0.3
	},
	kick: {
		oscillators: [{ type: 'sine', detune: 0, level: 1 }],
		baseCutoff: 1800,
		q: 1,
		filterEnvAmount: 0,
		filterEnvDecay: 0.001,
		amp: { attack: 0.002, decay: 0.34, sustain: 0, release: 0.04 },
		glide: 0,
		level: 1
	},
	hat: {
		oscillators: [],
		baseCutoff: 9000,
		q: 1,
		filterEnvAmount: 0,
		filterEnvDecay: 0.001,
		// Very short: closed hat. Open hats would need a per-step length lane.
		amp: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
		glide: 0,
		level: 0.5
	}
};

/** Kick pitch sweep: starts here and falls to `KICK_END_HZ`. */
export const KICK_START_HZ = 155;
export const KICK_END_HZ = 47;
export const KICK_SWEEP_SECONDS = 0.09;
