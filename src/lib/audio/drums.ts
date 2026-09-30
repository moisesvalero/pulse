import { KICK_END_HZ, KICK_START_HZ, KICK_SWEEP_SECONDS } from './constants';
import { schedulePercussiveEnvelope } from './envelope';
import { createLoopingNoiseSource, createNoiseBuffer } from './noise';

/**
 * Synthesised drum voices. No samples are loaded: the kick is a pitch-swept
 * sine plus a filtered click, and the hat is gated white noise through a
 * high-pass/band-pass pair.
 *
 * Both are persistent, gated by envelopes, so a running pattern performs zero
 * allocations per step.
 */
export interface DrumVoice {
	trigger(time: number, velocity: number): void;
	dispose(): void;
}

/** Length of the kick's body, in seconds. */
const KICK_DECAY = 0.34;
/** Extra 12 ms of noise on top of the kick gives it an audible beater click. */
const KICK_CLICK_DECAY = 0.014;
const KICK_CLICK_LEVEL = 0.3;
const KICK_CLICK_HIGHPASS = 1400;

const HAT_DECAY = 0.05;
const HAT_HIGHPASS = 7000;
const HAT_BANDPASS = 11000;

interface DrumOptions {
	/** Peak amplitude of the voice before per-hit velocity. */
	level: number;
	/** Looping noise shared by all noise-based voices of the engine. */
	noiseBuffer: AudioBuffer;
}

export function createKick(
	context: BaseAudioContext,
	destination: AudioNode,
	options: DrumOptions
): DrumVoice {
	const output = context.createGain();
	output.gain.value = 0;
	output.connect(destination);

	// Body: one sine whose pitch drops from a click-ish 155 Hz to a 47 Hz thump.
	const body = context.createOscillator();
	body.type = 'sine';
	const bodyGain = context.createGain();
	bodyGain.gain.value = 1;
	body.connect(bodyGain).connect(output);
	body.start();

	// Beater click: a very short noise burst, high-passed so it reads as "tick"
	// rather than "hiss".
	const clickSource = createLoopingNoiseSource(context, options.noiseBuffer);
	const clickHighpass = context.createBiquadFilter();
	clickHighpass.type = 'highpass';
	clickHighpass.frequency.value = KICK_CLICK_HIGHPASS;
	const clickGain = context.createGain();
	clickGain.gain.value = 0;
	clickSource.connect(clickHighpass).connect(clickGain).connect(output);

	let disposed = false;

	return {
		trigger(time, velocity) {
			if (disposed) return;

			const peak = Math.max(options.level * velocity, 0);

			body.frequency.cancelScheduledValues(time);
			body.frequency.setValueAtTime(KICK_START_HZ, time);
			body.frequency.exponentialRampToValueAtTime(
				KICK_END_HZ,
				time + KICK_SWEEP_SECONDS
			);

			schedulePercussiveEnvelope(output.gain, time, peak, KICK_DECAY);
			schedulePercussiveEnvelope(
				clickGain.gain,
				time,
				peak * KICK_CLICK_LEVEL,
				KICK_CLICK_DECAY
			);
		},

		dispose() {
			if (disposed) return;
			disposed = true;

			try {
				body.stop();
			} catch {
				// Already stopped.
			}
			body.disconnect();
			bodyGain.disconnect();
			clickSource.disconnect();
			clickHighpass.disconnect();
			clickGain.disconnect();
			output.disconnect();
		}
	};
}

export function createHat(
	context: BaseAudioContext,
	destination: AudioNode,
	options: DrumOptions
): DrumVoice {
	const output = context.createGain();
	output.gain.value = 0;
	output.connect(destination);

	const source = createLoopingNoiseSource(context, options.noiseBuffer);

	const highpass = context.createBiquadFilter();
	highpass.type = 'highpass';
	highpass.frequency.value = HAT_HIGHPASS;

	// A band-pass on top of the high-pass keeps the decay from sounding like
	// tape hiss; the peak sits where a closed hat actually has energy.
	const bandpass = context.createBiquadFilter();
	bandpass.type = 'bandpass';
	bandpass.frequency.value = HAT_BANDPASS;
	bandpass.Q.value = 0.9;

	source.connect(highpass).connect(bandpass).connect(output);

	let disposed = false;

	return {
		trigger(time, velocity) {
			if (disposed) return;

			schedulePercussiveEnvelope(
				output.gain,
				time,
				Math.max(options.level * velocity, 0),
				HAT_DECAY
			);
		},

		dispose() {
			if (disposed) return;
			disposed = true;

			source.disconnect();
			highpass.disconnect();
			bandpass.disconnect();
			output.disconnect();
		}
	};
}

/** Exposed so tests and the UI can reason about the shared noise buffer length. */
export const NOISE_BUFFER_SECONDS = 2;

/** Convenience factory used by the engine, which owns a single noise buffer. */
export function createSharedNoiseBuffer(context: BaseAudioContext): AudioBuffer {
	return createNoiseBuffer(context, NOISE_BUFFER_SECONDS);
}
