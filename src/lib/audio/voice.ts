import { scheduleAdsr, schedulePitch } from './envelope';
import { midiToFrequency } from './pitch';
import type { MelodicTrackId, VoicePreset } from './types';

/**
 * A monophonic, persistent subtractive voice: oscillators -> per-voice low-pass
 * filter -> amp envelope -> bus.
 *
 * The nodes are created once and kept alive for the lifetime of the engine.
 * Notes only write automation, so a 16th-note pattern allocates nothing at all
 * while playing. That is also what makes the glide in `schedulePitch` possible:
 * the oscillators never restart.
 */
export interface SynthVoice {
	readonly track: MelodicTrackId;
	/**
	 * Schedules one note.
	 *
	 * @param time absolute AudioContext time, not `currentTime`.
	 * @param holdSeconds gate length; the release starts right after it.
	 */
	trigger(time: number, midi: number, velocity: number, holdSeconds: number): void;
	dispose(): void;
}

interface OscillatorChain {
	node: OscillatorNode;
	level: GainNode;
}

export function createSynthVoice(
	context: BaseAudioContext,
	track: MelodicTrackId,
	preset: VoicePreset,
	destination: AudioNode
): SynthVoice {
	const amp = context.createGain();
	// Silent until the first note: an unscheduled envelope must not leak the
	// oscillators straight into the mix.
	amp.gain.value = 0;
	amp.connect(destination);

	const filter = context.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = preset.baseCutoff;
	filter.Q.value = preset.q;
	filter.connect(amp);

	const oscillators: OscillatorChain[] = preset.oscillators.map((spec) => {
		const node = context.createOscillator();
		node.type = spec.type;
		node.detune.value = spec.detune;

		const level = context.createGain();
		level.gain.value = spec.level;
		node.connect(level).connect(filter);
		node.start();

		return { node, level };
	});

	let disposed = false;

	return {
		track,

		trigger(time, midi, velocity, holdSeconds) {
			if (disposed) return;

			const frequency = midiToFrequency(midi);
			for (const { node } of oscillators) {
				schedulePitch(node.frequency, time, frequency, preset.glide);
			}

			// Filter envelope: opens to base + env amount, then falls back. Gives
			// each note its pluck without touching the master filter, which stays
			// free for live tweaking.
			const peakCutoff = preset.baseCutoff + preset.filterEnvAmount;
			filter.frequency.cancelScheduledValues(time);
			if (preset.filterEnvAmount > 0) {
				filter.frequency.setValueAtTime(peakCutoff, time);
				filter.frequency.exponentialRampToValueAtTime(
					preset.baseCutoff,
					time + Math.max(preset.filterEnvDecay, 0.001)
				);
			} else {
				filter.frequency.setValueAtTime(preset.baseCutoff, time);
			}

			scheduleAdsr(amp.gain, time, preset.level * velocity, holdSeconds, preset.amp);
		},

		dispose() {
			if (disposed) return;
			disposed = true;

			for (const { node, level } of oscillators) {
				try {
					node.stop();
				} catch {
					// Already stopped; nothing to do.
				}
				node.disconnect();
				level.disconnect();
			}

			filter.disconnect();
			amp.disconnect();
		}
	};
}
