/**
 * Shared audio types for Pulse.
 *
 * Everything here is plain data: no Web Audio objects. That keeps the pattern
 * model usable from pure functions (randomiser, URL serialiser, scheduler) and
 * from unit tests running in node.
 */

import type { AmpEnvelope } from './envelope';

/** The five sequenced lanes. Three melodic synth voices plus two drum voices. */
export type TrackId = 'bass' | 'lead' | 'pad' | 'kick' | 'hat';

/** Melodic tracks carry a MIDI note per step; percussion tracks ignore `notes`. */
export type MelodicTrackId = Extract<TrackId, 'bass' | 'lead' | 'pad'>;

export type PercussiveTrackId = Extract<TrackId, 'kick' | 'hat'>;

/** One lane of the 16-step grid. Both arrays always have `STEPS_PER_BAR` entries. */
export interface TrackPattern {
	gates: boolean[];
	/** MIDI note numbers (0-127). Only read for melodic tracks. */
	notes: number[];
}

export type Pattern = Record<TrackId, TrackPattern>;

/** A single note the transport wants to hear, in absolute AudioContext time. */
export interface NoteEvent {
	track: TrackId;
	step: number;
	/** Absolute time on the AudioContext clock, in seconds. */
	time: number;
	/** MIDI note number. For percussion tracks it only drives pitch tinting. */
	midi: number;
	/** 1 = fully on, 0 = silent. Reserved for future accent lanes. */
	velocity: number;
}

/** One oscillator inside a synth voice. */
export interface OscillatorSpec {
	type: OscillatorType;
	/** Constant detune in cents. Negative values drop by whole octaves (sub). */
	detune: number;
	/** Relative level, 0..1, applied through its own GainNode. */
	level: number;
}

/**
 * A subtractive voice definition: oscillators into a per-voice low-pass filter,
 * shaped by an amplitude envelope.
 *
 * The filter also has its own decay envelope (`filterEnvAmount` added to
 * `baseCutoff`, falling back over `filterEnvDecay` seconds), which is what makes
 * each note pluck without having to automate the shared master filter.
 */
export interface VoicePreset {
	oscillators: readonly OscillatorSpec[];
	/** Filter cutoff the note settles on, in Hz. */
	baseCutoff: number;
	/** Filter resonance (BiquadFilter Q). */
	q: number;
	/** Hz added to `baseCutoff` at note start. 0 disables the filter envelope. */
	filterEnvAmount: number;
	/** Seconds for the filter envelope to fall back to `baseCutoff`. */
	filterEnvDecay: number;
	amp: AmpEnvelope;
	/** Portamento between consecutive notes of the same voice, in seconds. */
	glide: number;
	/** Voice level before per-note velocity, 0..1. */
	level: number;
}

/** Master bus parameters exposed to the UI. */
export interface MasterParams {
	/** 0..1 */
	volume: number;
	bpm: number;
	/** Low-pass cutoff of the master filter, in Hz. */
	cutoff: number;
	/** Master filter resonance (BiquadFilter Q). */
	resonance: number;
	/** 0..1 wet amount of the ping-pong delay. */
	delayMix: number;
	/** 0..1 wet amount of the convolution reverb. */
	reverbMix: number;
}
