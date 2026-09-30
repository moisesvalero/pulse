import { createHat, createKick, createSharedNoiseBuffer, type DrumVoice } from './drums';
import { MELODIC_TRACK_IDS, VOICE_PRESETS } from './constants';
import { createMasterChain, delaySecondsForBpm, type MasterChain } from './master';
import { secondsPerStep, Transport, type PlannedStep } from './scheduler';
import { createSynthVoice, type SynthVoice } from './voice';
import type {
	MasterParams,
	MelodicTrackId,
	Pattern,
	PercussiveTrackId
} from './types';

/**
 * The audio engine owns every Web Audio node in Pulse.
 *
 * It never copies state: it reads the pattern and the master parameters through
 * `EngineSources` on every step, so the UI cannot end up driving a stale engine
 * and live tweaks need no synchronisation step.
 */

export interface EngineSources {
	getPattern(): Pattern;
	getMasterParams(): MasterParams;
	/** 0..1 swing amount. */
	getSwing(): number;
}

/**
 * Melodic gates stop slightly before the next step so repeated notes retrigger
 * with a crisp articulation instead of smearing into each other.
 */
const MELODIC_GATE_RATIO = 0.9;

/** Fallback pitch if a melodic lane has no note for a gated step. */
const FALLBACK_MIDI = 48;

export class AudioEngine {
	private readonly context: AudioContext;
	private readonly master: MasterChain;
	private readonly melodic: Record<MelodicTrackId, SynthVoice>;
	private readonly drums: Record<PercussiveTrackId, DrumVoice>;
	private readonly transport: Transport;
	private readonly sources: EngineSources;
	private lastDelayBpm = 0;
	private disposed = false;

	constructor(context: AudioContext, sources: EngineSources) {
		this.context = context;
		this.sources = sources;
		this.master = createMasterChain(context, context.destination, sources.getMasterParams());

		// One noise buffer shared by the kick click and the hi-hat.
		const noiseBuffer = createSharedNoiseBuffer(context);

		this.melodic = {
			bass: createSynthVoice(context, 'bass', VOICE_PRESETS.bass, this.master.input),
			lead: createSynthVoice(context, 'lead', VOICE_PRESETS.lead, this.master.input),
			pad: createSynthVoice(context, 'pad', VOICE_PRESETS.pad, this.master.input)
		};

		this.drums = {
			kick: createKick(context, this.master.input, {
				level: VOICE_PRESETS.kick.level,
				noiseBuffer
			}),
			hat: createHat(context, this.master.input, {
				level: VOICE_PRESETS.hat.level,
				noiseBuffer
			})
		};

		this.transport = new Transport({
			clock: { now: () => this.context.currentTime },
			getStepSeconds: () => secondsPerStep(this.sources.getMasterParams().bpm),
			getSwing: () => this.sources.getSwing(),
			onStep: (step) => this.scheduleStep(step)
		});

		this.applyLiveParams();
	}

	/** Analyser sitting at the end of the master chain, for the visuals. */
	get analyser(): AnalyserNode {
		return this.master.analyser;
	}

	get sampleRate(): number {
		return this.context.sampleRate;
	}

	get state(): AudioContextState {
		return this.context.state;
	}

	get isPlaying(): boolean {
		return this.transport.isRunning;
	}

	/** Starts the transport, resuming the context if the browser suspended it. */
	async play(): Promise<void> {
		if (this.disposed) return;

		if (this.context.state === 'suspended') {
			await this.context.resume();
		}

		this.applyLiveParams();
		this.transport.start();
	}

	pause(): void {
		this.transport.stop();
	}

	/**
	 * Pushes the current master parameters and tempo into the audio graph.
	 *
	 * Every ramp is smoothed inside the master chain, so calling this from a
	 * slider's `oninput` is safe and never produces a click.
	 */
	applyLiveParams(): void {
		if (this.disposed) return;

		const params = this.sources.getMasterParams();
		this.master.applyParams(params);

		// Only touch the delay when the tempo actually moved: retargeting
		// `delayTime` bends the pitch of whatever is already in the line.
		if (params.bpm !== this.lastDelayBpm) {
			this.master.setDelaySeconds(delaySecondsForBpm(params.bpm));
			this.lastDelayBpm = params.bpm;
		}
	}

	/**
	 * Step that should be highlighted right now, read from the audio clock so the
	 * UI never drifts from what is being heard.
	 */
	currentStep(): number | null {
		return this.transport.stepAt(this.context.currentTime);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		this.transport.stop();

		for (const track of MELODIC_TRACK_IDS) {
			this.melodic[track].dispose();
		}
		this.drums.kick.dispose();
		this.drums.hat.dispose();
		this.master.dispose();

		if (this.context.state !== 'closed') {
			await this.context.close();
		}
	}

	/** Turns one planned step into sound. Runs on the timer, not on the audio thread. */
	private scheduleStep(planned: PlannedStep): void {
		const pattern = this.sources.getPattern();
		const holdSeconds = planned.holdSeconds * MELODIC_GATE_RATIO;

		for (const track of MELODIC_TRACK_IDS) {
			const lane = pattern[track];
			if (!lane.gates[planned.step]) continue;

			const midi = lane.notes[planned.step] ?? FALLBACK_MIDI;
			this.melodic[track].trigger(planned.time, midi, 1, holdSeconds);
		}

		if (pattern.kick.gates[planned.step]) {
			this.drums.kick.trigger(planned.time, 1);
		}

		if (pattern.hat.gates[planned.step]) {
			this.drums.hat.trigger(planned.time, 1);
		}
	}
}

/**
 * Creates the engine. **Must be called from a user gesture**: browsers refuse to
 * start an `AudioContext` otherwise, which is why the UI has a start screen.
 */
export function createAudioEngine(sources: EngineSources): AudioEngine {
	if (!isAudioSupported()) {
		throw new Error('Web Audio API is not available in this browser.');
	}

	const context = new AudioContext({ latencyHint: 'interactive' });
	return new AudioEngine(context, sources);
}

export function isAudioSupported(): boolean {
	return typeof globalThis.AudioContext === 'function';
}
