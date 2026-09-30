/** Pitch helpers. Pure maths, no Web Audio. */

/** A4 = MIDI 69 = 440 Hz. */
export const A4_MIDI = 69;
export const A4_HZ = 440;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Equal temperament conversion. */
export function midiToFrequency(midi: number): number {
	return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Human-readable note name, e.g. 40 -> "E2". */
export function midiToNoteName(midi: number): string {
	const rounded = Math.round(midi);
	const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
	const octave = Math.floor(rounded / 12) - 1;
	return `${name}${octave}`;
}

export function clampMidi(midi: number): number {
	return Math.min(127, Math.max(0, Math.round(midi)));
}
