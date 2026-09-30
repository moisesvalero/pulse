import { MELODIC_TRACK_IDS, TRACK_IDS } from '$lib/audio/constants';
import { createEmptyPattern } from '$lib/audio/pattern';
import type { MasterParams, Pattern } from '$lib/audio/types';

/**
 * URL/localStorage codec for the whole instrument state.
 *
 * The format is deliberately compact *and* readable, because it ends up in the
 * address bar:
 *
 *   #p1.<params>.<gates>.<notes>
 *
 *   params  110-75-6200-12-22-28-16        bpm-volume-cutoff-resonance-delay-reverb-swing
 *   gates   f0a300000... (5 x 4 hex)       one 16-bit word per track, step 0 is bit 0
 *   notes   0k1c... (3 x 32 base36 chars)  16 MIDI notes per melodic track
 *
 * So the BPM is legible straight from the URL. Decoding is total: any malformed
 * input returns `null` instead of throwing, because a bad hash must never be able
 * to stop the app from starting.
 */

export const SHARE_VERSION = 'p1';
const FIELD_SEPARATOR = '.';
const PARAM_SEPARATOR = '-';
/** A real payload is ~150 characters; anything much longer is not ours. */
const MAX_PAYLOAD_LENGTH = 2000;
/** 16 gates fit exactly in 4 hex digits. */
const GATE_HEX_WIDTH = 4;
/** MIDI 127 fits in two base36 characters. */
const NOTE_WIDTH = 2;
const STEP_COUNT = 16;

export interface ShareState {
	pattern: Pattern;
	master: MasterParams;
	/** 0..1 */
	swing: number;
}

/** Bare payload, without the leading `#`. */
export function encodeShareState(state: ShareState): string {
	const params = [
		Math.round(state.master.bpm),
		Math.round(state.master.volume * 100),
		Math.round(state.master.cutoff),
		Math.round(state.master.resonance * 10),
		Math.round(state.master.delayMix * 100),
		Math.round(state.master.reverbMix * 100),
		Math.round(state.swing * 100)
	].join(PARAM_SEPARATOR);

	const gates = TRACK_IDS.map((track) => gatesToHex(state.pattern[track].gates)).join('');
	const notes = MELODIC_TRACK_IDS.map((track) => notesToBase36(state.pattern[track].notes)).join('');

	return [SHARE_VERSION, params, gates, notes].join(FIELD_SEPARATOR);
}

/** The hash to put in the address bar. */
export function toHash(state: ShareState): string {
	return `#${encodeShareState(state)}`;
}

/**
 * @param input a full hash (`#p1....`), a bare payload, or an entire URL.
 * @returns the decoded state, or `null` when the input is not a valid payload.
 */
export function decodeShareState(input: string): ShareState | null {
	const payload = extractPayload(input);
	if (!payload) return null;

	const fields = payload.split(FIELD_SEPARATOR);
	if (fields.length !== 4) return null;

	const [version, paramsField, gatesField, notesField] = fields;
	if (version !== SHARE_VERSION) return null;

	const params = decodeParams(paramsField);
	if (!params) return null;

	const pattern = decodePattern(gatesField, notesField);
	if (!pattern) return null;

	return { pattern, master: params.master, swing: params.swing };
}

/**
 * Pulls the payload out of a bare hash, a full URL or a bare payload, and
 * rejects anything that cannot be ours before doing any parsing.
 */
export function extractPayload(input: string): string | null {
	if (typeof input !== 'string' || input.length === 0) return null;

	let candidate = input.trim();

	const hashIndex = candidate.indexOf('#');
	if (hashIndex >= 0) candidate = candidate.slice(hashIndex + 1);

	if (candidate.length === 0 || candidate.length > MAX_PAYLOAD_LENGTH) return null;

	const prefix = `${SHARE_VERSION}${FIELD_SEPARATOR}`;
	if (!candidate.startsWith(prefix)) return null;

	return candidate;
}

interface DecodedParams {
	master: MasterParams;
	swing: number;
}

function decodeParams(field: string): DecodedParams | null {
	const parts = field.split(PARAM_SEPARATOR);
	if (parts.length !== 7) return null;
	// Digits only: this also rejects an empty part, unlike `Number.parseInt`.
	if (parts.some((part) => !/^\d{1,6}$/.test(part))) return null;

	const [bpm, volume, cutoff, resonance, delay, reverb, swing] = parts.map((part) =>
		Number.parseInt(part, 10)
	);

	// Ranges are wider than the UI limits so that a payload written by a future
	// version with a bigger range still loads instead of being discarded.
	if (bpm < 20 || bpm > 400) return null;
	if (volume > 100) return null;
	if (cutoff < 20 || cutoff > 24000) return null;
	if (resonance > 1000) return null;
	if (delay > 100 || reverb > 100) return null;
	if (swing > 100) return null;

	return {
		master: {
			bpm,
			volume: volume / 100,
			cutoff,
			resonance: resonance / 10,
			delayMix: delay / 100,
			reverbMix: reverb / 100
		},
		swing: swing / 100
	};
}

function decodePattern(gatesField: string, notesField: string): Pattern | null {
	if (gatesField.length !== TRACK_IDS.length * GATE_HEX_WIDTH) return null;
	if (notesField.length !== MELODIC_TRACK_IDS.length * STEP_COUNT * NOTE_WIDTH) return null;

	const pattern = createEmptyPattern();

	for (const [index, track] of TRACK_IDS.entries()) {
		const hex = gatesField.slice(index * GATE_HEX_WIDTH, (index + 1) * GATE_HEX_WIDTH);
		const gates = hexToGates(hex);
		if (!gates) return null;
		pattern[track].gates = gates;
	}

	for (const [index, track] of MELODIC_TRACK_IDS.entries()) {
		const start = index * STEP_COUNT * NOTE_WIDTH;
		const notes = base36ToNotes(notesField.slice(start, start + STEP_COUNT * NOTE_WIDTH));
		if (!notes) return null;
		pattern[track].notes = notes;
	}

	return pattern;
}

function gatesToHex(gates: readonly boolean[]): string {
	let word = 0;
	for (let step = 0; step < Math.min(gates.length, STEP_COUNT); step += 1) {
		if (gates[step]) word |= 1 << step;
	}
	return word.toString(16).padStart(GATE_HEX_WIDTH, '0');
}

function hexToGates(hex: string): boolean[] | null {
	if (!/^[0-9a-f]{4}$/i.test(hex)) return null;

	const word = Number.parseInt(hex, 16);
	return Array.from({ length: STEP_COUNT }, (_, step) => (word & (1 << step)) !== 0);
}

function notesToBase36(notes: readonly number[]): string {
	return notes
		.slice(0, STEP_COUNT)
		.map((note) => clampMidi(note).toString(36).padStart(NOTE_WIDTH, '0'))
		.join('');
}

function base36ToNotes(text: string): number[] | null {
	const notes: number[] = [];

	for (let index = 0; index < STEP_COUNT; index += 1) {
		const pair = text.slice(index * NOTE_WIDTH, (index + 1) * NOTE_WIDTH);
		if (!/^[0-9a-z]{2}$/i.test(pair)) return null;

		const value = Number.parseInt(pair, 36);
		if (!Number.isInteger(value) || value > 127) return null;
		notes.push(value);
	}

	return notes;
}

function clampMidi(value: number): number {
	if (!Number.isFinite(value)) return 60;
	return Math.min(127, Math.max(0, Math.round(value)));
}
