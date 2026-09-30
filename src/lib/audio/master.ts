import { DEFAULT_MASTER_PARAMS } from './constants';
import type { MasterParams } from './types';

/**
 * Master bus.
 *
 * Signal flow:
 *
 *   voices -> input -> low-pass filter -+-> dry -------------+
 *                                       +-> delay -> wet ----+-> compressor
 *                                       +-> reverb -> wet ---+        |
 *                                                                     v
 *                                       destination <- analyser <- volume
 *
 * The delay and reverb are parallel wet paths rather than inserts, so the mix
 * controls are just gain values and can be moved while playing without ever
 * cutting the dry signal (no clicks, no dropouts).
 *
 * The `AnalyserNode` sits last, after the volume fader, so the visuals react to
 * what is actually being heard.
 */

/** Time constant used to smooth every live parameter change. */
const SMOOTHING_SECONDS = 0.02;

/** Filters, delay times and gains are clamped to sane ranges. Exported so the UI
 *  can build sliders over exactly the same domain the chain enforces. */
export const MIN_CUTOFF_HZ = 80;
export const MAX_CUTOFF_HZ = 18000;
export const MIN_RESONANCE = 0.1;
export const MAX_RESONANCE = 18;

/** Damping inside the delay feedback loop keeps repeats from turning into mush. */
const DELAY_DAMPING_HZ = 3200;
const DELAY_FEEDBACK = 0.34;

/** Let the delay tail ring for longer than the analysis window needs. */
const MAX_DELAY_SECONDS = 2;

/** Convolution reverb impulse length and decay curve. */
const IMPULSE_SECONDS = 2.4;
const IMPULSE_DECAY_POWER = 2.8;

export interface MasterChain {
	/** Voices and drums connect here. */
	readonly input: GainNode;
	readonly analyser: AnalyserNode;
	/** Applies every parameter at once, without clicks. */
	applyParams(params: MasterParams): void;
	/** Keeps the delay musically in time with the step sequencer. */
	setDelaySeconds(seconds: number): void;
	dispose(): void;
}

export function createMasterChain(
	context: BaseAudioContext,
	destination: AudioNode,
	params: MasterParams = DEFAULT_MASTER_PARAMS
): MasterChain {
	const now = () => context.currentTime;

	const input = context.createGain();
	input.gain.value = 1;

	const filter = context.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = clamp(params.cutoff, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ);
	filter.Q.value = clamp(params.resonance, MIN_RESONANCE, MAX_RESONANCE);

	const dry = context.createGain();
	dry.gain.value = 1;

	const sum = context.createGain();
	sum.gain.value = 1;

	// --- delay: dotted-eighth tap with damped feedback ----------------------
	const delaySend = context.createGain();
	delaySend.gain.value = 0;
	const delay = context.createDelay(MAX_DELAY_SECONDS);
	delay.delayTime.value = 0.28;
	const damping = context.createBiquadFilter();
	damping.type = 'lowpass';
	damping.frequency.value = DELAY_DAMPING_HZ;
	const feedback = context.createGain();
	feedback.gain.value = DELAY_FEEDBACK;

	// --- reverb: convolution with a procedurally generated impulse ----------
	const reverbSend = context.createGain();
	reverbSend.gain.value = 0;
	const convolver = context.createConvolver();
	convolver.normalize = true;
	convolver.buffer = createImpulseResponse(context);

	// --- dynamics and output ------------------------------------------------
	const compressor = context.createDynamicsCompressor();
	// Gentle glue rather than heavy pumping: five voices can stack on one step.
	compressor.threshold.value = -12;
	compressor.knee.value = 24;
	compressor.ratio.value = 4;
	compressor.attack.value = 0.004;
	compressor.release.value = 0.18;

	const volume = context.createGain();
	volume.gain.value = params.volume;

	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	analyser.smoothingTimeConstant = 0.78;
	analyser.minDecibels = -95;

	// --- wiring -------------------------------------------------------------
	input.connect(filter);
	filter.connect(dry).connect(sum);

	filter.connect(delaySend).connect(delay);
	delay.connect(damping);
	damping.connect(feedback).connect(delay);
	delay.connect(sum);

	filter.connect(reverbSend).connect(convolver);
	convolver.connect(sum);

	sum.connect(compressor).connect(volume).connect(analyser);
	analyser.connect(destination);

	let disposed = false;

	function ramp(param: AudioParam, value: number): void {
		param.setTargetAtTime(value, now(), SMOOTHING_SECONDS);
	}

	return {
		input,
		analyser,

		applyParams(next) {
			if (disposed) return;

			// Never jump `gain` directly: a stepped gain change is an audible click.
			ramp(volume.gain, clamp01(next.volume));
			ramp(filter.frequency, clamp(next.cutoff, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ));
			ramp(filter.Q, clamp(next.resonance, MIN_RESONANCE, MAX_RESONANCE));
			ramp(delaySend.gain, clamp01(next.delayMix));
			ramp(reverbSend.gain, clamp01(next.reverbMix));
		},

		setDelaySeconds(seconds) {
			if (disposed) return;
			ramp(delay.delayTime, clamp(seconds, 0.01, MAX_DELAY_SECONDS));
		},

		dispose() {
			if (disposed) return;
			disposed = true;

			// Cutting every connection is what actually releases the graph; the
			// convolver's impulse buffer is the only large allocation here.
			input.disconnect();
			filter.disconnect();
			dry.disconnect();
			sum.disconnect();
			delaySend.disconnect();
			delay.disconnect();
			damping.disconnect();
			feedback.disconnect();
			reverbSend.disconnect();
			convolver.disconnect();
			compressor.disconnect();
			volume.disconnect();
			analyser.disconnect();
			convolver.buffer = null;
		}
	};
}

/**
 * Generates a stereo impulse response: exponentially decaying white noise.
 *
 * This is what lets Pulse ship without an impulse-response file — the reverb is
 * synthesised the same way the drums are. The two channels are generated
 * independently, which is what gives the tail its width.
 */
export function createImpulseResponse(
	context: BaseAudioContext,
	seconds = IMPULSE_SECONDS
): AudioBuffer {
	const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
	const impulse = context.createBuffer(2, frames, context.sampleRate);

	for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
		const data = impulse.getChannelData(channel);
		for (let frame = 0; frame < frames; frame += 1) {
			const envelope = Math.pow(1 - frame / frames, IMPULSE_DECAY_POWER);
			data[frame] = (Math.random() * 2 - 1) * envelope;
		}
	}

	return impulse;
}

/**
 * Dotted-eighth delay, the classic sequencer choice: it fills the gaps between
 * 16ths without smearing the groove.
 */
export function delaySecondsForBpm(bpm: number): number {
	const beat = 60 / Math.max(bpm, 1);
	return beat * 0.75;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
	return clamp(value, 0, 1);
}
