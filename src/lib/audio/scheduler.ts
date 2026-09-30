import {
	MAX_STEPS_PER_TICK,
	SCHEDULE_AHEAD_SECONDS,
	SCHEDULER_TICK_MS,
	STEPS_PER_BAR,
	SWING_MAX_FRACTION
} from './constants';

/**
 * Look-ahead sequencer ("A Tale of Two Clocks").
 *
 * A coarse timer wakes up every 25 ms and hands every step that falls inside the
 * next 120 ms to the audio thread, stamped with an *absolute* AudioContext time.
 * The audio thread then plays them sample-accurately, so a hiccup in the main
 * thread (a repaint, a GC pause, a slow Svelte update) can never make the groove
 * stutter. The timer only decides *what* to play; the audio clock decides *when*.
 *
 * Everything in this module is free of Web Audio and DOM references: the clock
 * and the timer are injected. `planSteps` is a pure function.
 */

/** Position of the next step to be planned. */
export interface StepCursor {
	/** 0-based index inside the bar. */
	step: number;
	/** Absolute AudioContext time of that step, on the un-swung grid. */
	time: number;
}

/** One step handed to the audio engine. */
export interface PlannedStep {
	step: number;
	/** Exact position on the un-swung grid. */
	gridTime: number;
	/** When it actually sounds: `gridTime` plus the swing displacement. */
	time: number;
	/** Gate length to use for melodic voices, in seconds. */
	holdSeconds: number;
}

export interface StepPlan {
	steps: PlannedStep[];
	/** Cursor to resume from on the next tick. */
	cursor: StepCursor;
}

/**
 * Duration of one 16th note.
 *
 * @param bpm quarter-note beats per minute.
 */
export function secondsPerStep(bpm: number): number {
	if (!Number.isFinite(bpm) || bpm <= 0) return 0;
	return 60 / bpm / 4;
}

/**
 * Swing displacement applied to off-beat 16ths.
 *
 * Swing 0 is straight. Swing 1 pushes odd steps a third of a step late, which is
 * the classic 66% shuffle: the off-beat lands two thirds of the way to the beat.
 * Even steps never move, so the downbeats stay locked.
 */
export function swingOffset(step: number, stepSeconds: number, swing: number): number {
	if (step % 2 === 0) return 0;
	return clamp01(swing) * SWING_MAX_FRACTION * stepSeconds;
}

/**
 * Pure planning core: returns every step that sounds before `horizonTime` and
 * the cursor to continue from.
 *
 * Pure means no side effects and no clock reads, which is exactly what makes the
 * timing behaviour testable without an AudioContext.
 */
export function planSteps(
	cursor: StepCursor,
	stepSeconds: number,
	horizonTime: number,
	swing = 0
): StepPlan {
	// A non-positive step would make the loop below spin forever.
	if (!(stepSeconds > 0) || !Number.isFinite(horizonTime)) {
		return { steps: [], cursor };
	}

	const steps: PlannedStep[] = [];
	let step = cursor.step;
	let time = cursor.time;

	// Hard cap: if a background tab was frozen for a minute, the audio clock may
	// have jumped far ahead. We would rather drop the backlog than schedule
	// thousands of notes at once.
	while (time < horizonTime && steps.length < MAX_STEPS_PER_TICK) {
		steps.push({
			step,
			gridTime: time,
			time: time + swingOffset(step, stepSeconds, swing),
			holdSeconds: stepSeconds
		});

		time += stepSeconds;
		step = (step + 1) % STEPS_PER_BAR;
	}

	return { steps, cursor: { step, time } };
}

/** Just enough of `AudioContext` for the transport: the audio clock. */
export interface TransportClock {
	now(): number;
}

export interface TransportOptions {
	clock: TransportClock;
	/** Called for every planned step, with an absolute time. */
	onStep(step: PlannedStep): void;
	/** Re-read on every tick so tempo changes apply to subsequent steps. */
	getStepSeconds(): number;
	/** Re-read on every tick; 0..1. */
	getSwing(): number;
	/** Start of the first step relative to `clock.now()`. */
	startLookaheadSeconds?: number;
	scheduleAheadSeconds?: number;
	tickMs?: number;
	/** Injectable timer hooks, so tests can drive the transport manually. */
	setTimer?(handler: () => void, ms: number): TimerHandle;
	clearTimer?(handle: TimerHandle): void;
}

export type TimerHandle = ReturnType<typeof globalThis.setInterval>;

/** Head start for the very first step, so the first tick already has headroom. */
export const START_LOOKAHEAD_SECONDS = 0.06;

export class Transport {
	private readonly clock: TransportClock;
	private readonly onStep: (step: PlannedStep) => void;
	private readonly getStepSeconds: () => number;
	private readonly getSwing: () => number;
	private readonly startLookahead: number;
	private readonly scheduleAhead: number;
	private readonly tickMs: number;
	private readonly setTimer: (handler: () => void, ms: number) => TimerHandle;
	private readonly clearTimer: (handle: TimerHandle) => void;

	private cursor: StepCursor = { step: 0, time: 0 };
	private timer: TimerHandle | null = null;
	/** Steps already handed to the audio thread but not yet sounding. */
	private pending: PlannedStep[] = [];
	private currentStep: number | null = null;

	constructor(options: TransportOptions) {
		this.clock = options.clock;
		this.onStep = options.onStep;
		this.getStepSeconds = options.getStepSeconds;
		this.getSwing = options.getSwing;
		this.startLookahead = options.startLookaheadSeconds ?? START_LOOKAHEAD_SECONDS;
		this.scheduleAhead = options.scheduleAheadSeconds ?? SCHEDULE_AHEAD_SECONDS;
		this.tickMs = options.tickMs ?? SCHEDULER_TICK_MS;
		this.setTimer =
			options.setTimer ?? ((handler, ms) => globalThis.setInterval(handler, ms));
		this.clearTimer = options.clearTimer ?? ((handle) => globalThis.clearInterval(handle));
	}

	get isRunning(): boolean {
		return this.timer !== null;
	}

	start(): void {
		if (this.timer !== null) return;

		this.cursor = { step: 0, time: this.clock.now() + this.startLookahead };
		this.pending = [];
		this.currentStep = null;

		this.timer = this.setTimer(() => this.tick(), this.tickMs);
		// Fill the first window immediately instead of waiting a full tick.
		this.tick();
	}

	stop(): void {
		if (this.timer !== null) {
			this.clearTimer(this.timer);
			this.timer = null;
		}

		this.cursor = { step: 0, time: 0 };
		this.pending = [];
		this.currentStep = null;
	}

	/**
	 * Step that should be highlighted right now, or `null` while stopped.
	 *
	 * The UI calls this from its animation frame with `clock.now()`, so the
	 * highlight follows the audio clock instead of the timer that scheduled it.
	 */
	stepAt(now: number): number | null {
		while (this.pending.length > 0 && this.pending[0].time <= now) {
			const sounded = this.pending.shift();
			if (sounded) this.currentStep = sounded.step;
		}

		return this.currentStep;
	}

	/** Schedules everything that falls inside the look-ahead window. */
	private tick(): void {
		const horizon = this.clock.now() + this.scheduleAhead;
		const plan = planSteps(this.cursor, this.getStepSeconds(), horizon, this.getSwing());

		this.cursor = plan.cursor;

		for (const step of plan.steps) {
			this.pending.push(step);
			this.onStep(step);
		}
	}
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
