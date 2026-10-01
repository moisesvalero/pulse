import {
	DEFAULT_MASTER_PARAMS,
	DEFAULT_SWING,
	MAX_BPM,
	MIN_BPM,
	TRACK_IDS
} from '$lib/audio/constants';
import { createAudioEngine, isAudioSupported, type AudioEngine } from '$lib/audio/engine';
import { triggerIosAudioUnlock } from '$lib/audio/unlock';
import {
	clonePattern,
	createDefaultPattern,
	randomizePattern
} from '$lib/audio/pattern';
import type { MasterParams, Pattern, TrackId } from '$lib/audio/types';
import type { ShareState } from '$lib/utils/share';

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
	/**
	 * False until the transport has run at least once. Lets the UI say "silent"
	 * instead of "paused" when somebody has only just walked in.
	 */
	hasPlayed = $state(false);

	private engine: AudioEngine | null = null;
	private frame: number | null = null;

	/**
	 * Creating an `AudioContext` requires a user gesture, so this is called from
	 * the Start button. Safe to call twice.
	 */
	async start(): Promise<void> {
		triggerIosAudioUnlock();

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
		} catch (cause) {
			this.engine = null;
			this.fail(cause, 'No se pudo iniciar el audio.');
			return;
		}

		this.status = 'ready';

		// Unlock the audio context inside the user gesture, but stay silent: nothing
		// should start playing just because somebody walked in. The transport only
		// starts when the play button is pressed.
		try {
			await this.engine.unlock();
		} catch (cause) {
			this.fail(cause, 'El navegador bloqueó el audio. Vuelve a pulsar Entrar.');
		}
	}

	async play(): Promise<void> {
		triggerIosAudioUnlock();

		if (!this.engine) {
			await this.start();
			if (!this.engine) return;
		}

		try {
			await this.engine.play();
		} catch (cause) {
			// Browsers can refuse to resume a context that was not created inside a
			// gesture, and the rejection has to reach the start screen instead of
			// becoming an unhandled promise.
			this.fail(cause, 'El navegador bloqueó el audio. Vuelve a pulsar Empezar.');
			return;
		}

		this.playing = this.engine.isPlaying;
		if (this.playing) this.hasPlayed = true;
		this.startFrameLoop();
	}

	private fail(cause: unknown, fallback: string): void {
		this.status = 'error';
		this.playing = false;
		this.stopFrameLoop();
		this.error = cause instanceof Error ? cause.message : fallback;
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

	/**
	 * Snapshot of everything worth persisting.
	 *
	 * It reads every gate, note and parameter through the reactive proxies, which
	 * is what lets a `$effect` depend on the whole instrument state with one call
	 * instead of hand-rolling a subscription.
	 */
	toShareState(): ShareState {
		return {
			pattern: clonePattern(this.pattern),
			master: { ...this.master },
			swing: this.swing
		};
	}

	/** Replaces the whole instrument state, e.g. from a shared link. */
	restoreFrom(state: ShareState): void {
		this.loadPattern(state.pattern);
		this.master = { ...state.master };
		this.swing = state.swing;
		// The engine reads parameters live, so the restored values only need to be
		// pushed into the audio graph; no restart is required.
		this.engine?.applyLiveParams();
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
