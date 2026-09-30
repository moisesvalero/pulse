import {
	DEFAULT_MASTER_PARAMS,
	DEFAULT_SWING,
	MAX_BPM,
	MIN_BPM,
	TRACK_IDS
} from '$lib/audio/constants';
import { createAudioEngine, isAudioSupported, type AudioEngine } from '$lib/audio/engine';
import {
	clonePattern,
	createDefaultPattern,
	randomizePattern
} from '$lib/audio/pattern';
import type { MasterParams, Pattern, TrackId } from '$lib/audio/types';

export type StudioStatus = 'idle' | 'starting' | 'ready' | 'error';

/**
 * Single source of truth for the whole instrument.
 *
 * The audio engine never copies this state: it reads it through the getters
 * passed to `createAudioEngine`, so mutating a gate here is immediately audible
 * on the next scheduled step without any synchronisation step.
 */
class Studio {
	pattern = $state<Pattern>(createDefaultPattern());
	master = $state<MasterParams>({ ...DEFAULT_MASTER_PARAMS });
	swing = $state(DEFAULT_SWING);
	status = $state<StudioStatus>('idle');
	error = $state<string | null>(null);
	playing = $state(false);
	/** Step currently sounding, or `null` while stopped. Drives the playhead. */
	currentStep = $state<number | null>(null);

	private engine: AudioEngine | null = null;
	private frame: number | null = null;

	/**
	 * Creating an `AudioContext` requires a user gesture, so this is called from
	 * the Start button. Safe to call twice.
	 */
	async start(): Promise<void> {
		if (this.engine) {
			await this.play();
			return;
		}

		if (!isAudioSupported()) {
			this.status = 'error';
			this.error = 'Este navegador no soporta la Web Audio API.';
			return;
		}

		this.status = 'starting';
		this.error = null;

		try {
			this.engine = createAudioEngine({
				getPattern: () => this.pattern,
				getMasterParams: () => this.master,
				getSwing: () => this.swing
			});
			this.status = 'ready';
		} catch (cause) {
			this.status = 'error';
			this.error = cause instanceof Error ? cause.message : 'No se pudo iniciar el audio.';
			return;
		}

		await this.play();
	}

	async play(): Promise<void> {
		if (!this.engine) {
			await this.start();
			return;
		}

		await this.engine.play();
		this.playing = this.engine.isPlaying;
		this.startFrameLoop();
	}

	pause(): void {
		this.engine?.pause();
		this.playing = false;
		this.currentStep = null;
		this.stopFrameLoop();
	}

	async toggle(): Promise<void> {
		if (this.playing) {
			this.pause();
		} else {
			await this.play();
		}
	}

	/** Live parameter change. Every ramp is smoothed inside the master chain. */
	setMaster<K extends keyof MasterParams>(key: K, value: MasterParams[K]): void {
		this.master[key] = value;
		this.engine?.applyLiveParams();
	}

	setBpm(value: number): void {
		const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
		this.setMaster('bpm', bpm);
	}

	setSwing(value: number): void {
		this.swing = Math.min(1, Math.max(0, value));
	}

	setGate(track: TrackId, step: number, on: boolean): void {
		if (this.pattern[track].gates[step] === on) return;
		this.pattern[track].gates[step] = on;
	}

	toggleGate(track: TrackId, step: number): void {
		this.pattern[track].gates[step] = !this.pattern[track].gates[step];
	}

	setNote(track: TrackId, step: number, midi: number): void {
		this.pattern[track].notes[step] = Math.min(127, Math.max(0, Math.round(midi)));
	}

	clear(): void {
		for (const track of TRACK_IDS) {
			this.pattern[track].gates = this.pattern[track].gates.map(() => false);
		}
	}

	randomize(density = 0.55): void {
		const generated = randomizePattern(Math.random, { density });
		// Copy lane by lane so the reactive proxies in `this.pattern` survive;
		// replacing the whole object would detach every `$derived` consumer.
		for (const track of TRACK_IDS) {
			this.pattern[track].gates = [...generated[track].gates];
			this.pattern[track].notes = [...generated[track].notes];
		}
	}

	reset(): void {
		this.loadPattern(createDefaultPattern());
	}

	/** Replaces the current pattern without breaking the reactive proxies. */
	loadPattern(next: Pattern): void {
		const copy = clonePattern(next);
		for (const track of TRACK_IDS) {
			this.pattern[track].gates = copy[track].gates;
			this.pattern[track].notes = copy[track].notes;
		}
	}

	/** Called by the visualiser so it can read the analyser without owning it. */
	getAnalyser(): AnalyserNode | null {
		return this.engine?.analyser ?? null;
	}

	get sampleRate(): number {
		return this.engine?.sampleRate ?? 48000;
	}

	dispose(): void {
		this.stopFrameLoop();
		void this.engine?.dispose();
		this.engine = null;
		this.playing = false;
		this.status = 'idle';
	}

	/**
	 * One animation frame loop, owned by the transport rather than by the canvas:
	 * the canvas already renders on its own loop, and the playhead must keep
	 * working even if the visuals are paused or unsupported.
	 */
	private startFrameLoop(): void {
		if (this.frame !== null) return;

		const tick = (): void => {
			this.frame = requestAnimationFrame(tick);
			if (this.engine) this.currentStep = this.engine.currentStep();
		};

		this.frame = requestAnimationFrame(tick);
	}

	private stopFrameLoop(): void {
		if (this.frame === null) return;
		cancelAnimationFrame(this.frame);
		this.frame = null;
	}
}

export const studio = new Studio();
