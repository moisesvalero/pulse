import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_TICK, STEPS_PER_BAR, SWING_MAX_FRACTION } from './constants';
import {
	planSteps,
	secondsPerStep,
	swingOffset,
	Transport,
	type PlannedStep,
	type StepCursor
} from './scheduler';

/**
 * Deterministic stand-ins for the two things the transport normally borrows from
 * the browser: the audio clock and the interval timer. Driving them by hand is
 * what makes the look-ahead behaviour assertable.
 */
function createHarness(options: { bpm?: number; swing?: number } = {}) {
	let now = 0;
	let bpm = options.bpm ?? 120;
	let swing = options.swing ?? 0;

	let handler: (() => void) | null = null;
	const scheduled: PlannedStep[] = [];

	const transport = new Transport({
		clock: { now: () => now },
		getStepSeconds: () => secondsPerStep(bpm),
		getSwing: () => swing,
		onStep: (step) => scheduled.push(step),
		setTimer: (callback) => {
			handler = callback;
			return 1 as unknown as ReturnType<typeof setInterval>;
		},
		clearTimer: () => {
			handler = null;
		}
	});

	return {
		transport,
		scheduled,
		advance(seconds: number) {
			now += seconds;
		},
		setNow(value: number) {
			now = value;
		},
		setBpm(value: number) {
			bpm = value;
		},
		setSwing(value: number) {
			swing = value;
		},
		/** Simulates the interval timer firing. */
		tick() {
			handler?.();
		},
		get hasTimer() {
			return handler !== null;
		}
	};
}

describe('secondsPerStep', () => {
	it('treats a step as a 16th note', () => {
		// 120 BPM -> 0.5 s per beat -> 0.125 s per 16th.
		expect(secondsPerStep(120)).toBeCloseTo(0.125, 9);
		expect(secondsPerStep(60)).toBeCloseTo(0.25, 9);
	});

	it('guards against a non-positive or non-finite tempo', () => {
		expect(secondsPerStep(0)).toBe(0);
		expect(secondsPerStep(-120)).toBe(0);
		expect(secondsPerStep(Number.NaN)).toBe(0);
		expect(secondsPerStep(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('swingOffset', () => {
	it('never moves the downbeats', () => {
		for (const step of [0, 2, 4, 8, 14]) {
			expect(swingOffset(step, 0.125, 1)).toBe(0);
		}
	});

	it('pushes off-beats by at most a third of a step', () => {
		expect(swingOffset(1, 0.125, 0)).toBe(0);
		expect(swingOffset(1, 0.125, 1)).toBeCloseTo(0.125 * SWING_MAX_FRACTION, 9);
		expect(swingOffset(3, 0.125, 0.5)).toBeCloseTo(0.125 * SWING_MAX_FRACTION * 0.5, 9);
	});

	it('clamps the swing amount to 0..1', () => {
		expect(swingOffset(1, 0.125, 5)).toBeCloseTo(0.125 * SWING_MAX_FRACTION, 9);
		expect(swingOffset(1, 0.125, -5)).toBe(0);
	});
});

describe('planSteps', () => {
	const straight: StepCursor = { step: 0, time: 0 };

	it('plans nothing while the horizon is behind the cursor', () => {
		const plan = planSteps({ step: 4, time: 10 }, 0.125, 10);

		expect(plan.steps).toEqual([]);
		expect(plan.cursor).toEqual({ step: 4, time: 10 });
	});

	it('plans exactly the steps that sound before the horizon', () => {
		const plan = planSteps(straight, 0.125, 0.3);

		// Horizons are exclusive: 0.25 < 0.3 but 0.375 is not.
		expect(plan.steps.map((step) => step.step)).toEqual([0, 1, 2]);
		expect(plan.steps.map((step) => step.time)).toEqual([0, 0.125, 0.25]);
		expect(plan.cursor).toEqual({ step: 3, time: 0.375 });
	});

	it('hands the gate length to the caller', () => {
		const plan = planSteps(straight, 0.2, 0.3);

		expect(plan.steps[0].holdSeconds).toBeCloseTo(0.2, 9);
	});

	it('wraps the step counter at the end of the bar', () => {
		const plan = planSteps({ step: 15, time: 0 }, 0.125, 0.3);

		expect(plan.steps.map((step) => step.step)).toEqual([15, 0, 1]);
		expect(plan.cursor.step).toBe(2);
	});

	it('never replays a step: the next plan starts after the previous cursor', () => {
		const first = planSteps(straight, 0.125, 0.3);
		const second = planSteps(first.cursor, 0.125, 0.6);

		expect(first.steps.map((step) => step.step)).toEqual([0, 1, 2]);
		expect(second.steps.map((step) => step.step)).toEqual([3, 4]);
		expect(second.steps[0].time).toBeCloseTo(0.375, 9);
	});

	it('applies swing to the sounding time but not to the grid time', () => {
		const plan = planSteps(straight, 0.125, 0.5, 1);

		expect(plan.steps.map((step) => step.gridTime)).toEqual([0, 0.125, 0.25, 0.375]);
		expect(plan.steps[1].time).toBeCloseTo(0.125 + 0.125 * SWING_MAX_FRACTION, 9);
		expect(plan.steps[0].time).toBeCloseTo(0, 9);
		expect(plan.steps[2].time).toBeCloseTo(0.25, 9);
	});

	it('keeps the grid steady under swing so the tempo never drifts', () => {
		const plan = planSteps(straight, 0.125, 4, 1);
		const times = plan.steps.map((step) => step.gridTime);

		for (let index = 1; index < times.length; index += 1) {
			expect(times[index] - times[index - 1]).toBeCloseTo(0.125, 9);
		}
		expect(plan.cursor.time).toBeCloseTo(times.length * 0.125, 9);
	});

	it('returns an unchanged cursor for a non-positive step length', () => {
		const cursor = { step: 7, time: 3 };
		const plan = planSteps(cursor, 0, 100);

		expect(plan.steps).toEqual([]);
		expect(plan.cursor).toEqual(cursor);
	});

	it('caps the burst when the audio clock jumped far ahead', () => {
		// Simulates a tab that was frozen: a huge horizon must not produce a
		// thousands-of-notes backlog.
		const plan = planSteps(straight, 0.001, 1000);

		expect(plan.steps).toHaveLength(MAX_STEPS_PER_TICK);
	});

	it('always produces strictly increasing, correctly spaced times', () => {
		let cursor: StepCursor = straight;
		const collected: PlannedStep[] = [];

		for (let tick = 0; tick < 60; tick += 1) {
			const plan = planSteps(cursor, 0.125, cursor.time + 0.5);
			cursor = plan.cursor;
			collected.push(...plan.steps);
		}

		expect(collected.length).toBeGreaterThan(200);
		for (let index = 1; index < collected.length; index += 1) {
			expect(collected[index].time).toBeGreaterThan(collected[index - 1].time);
			expect(collected[index].time - collected[index - 1].time).toBeCloseTo(0.125, 9);
		}
		// Steps cycle through the bar without skipping.
		collected.forEach((step, index) => {
			expect(step.step).toBe(index % STEPS_PER_BAR);
		});
	});
});

describe('Transport', () => {
	it('schedules the first window immediately on start', () => {
		const harness = createHarness({ bpm: 120 });
		harness.transport.start();

		// Horizon = now + 0.12, first step at now + 0.06, step = 0.125 s.
		expect(harness.scheduled.map((step) => step.step)).toEqual([0]);
		expect(harness.scheduled[0].time).toBeCloseTo(0.06, 9);
		expect(harness.transport.isRunning).toBe(true);
	});

	it('keeps scheduling ahead as the timer fires, without duplicates', () => {
		const harness = createHarness({ bpm: 120 });
		harness.transport.start();

		for (let index = 0; index < 20; index += 1) {
			harness.advance(0.025);
			harness.tick();
		}

		const times = harness.scheduled.map((step) => step.time);
		expect(new Set(times).size).toBe(times.length);
		expect(times).toEqual([...times].sort((a, b) => a - b));

		// The window stays roughly one and a half steps ahead of the clock.
		expect(times.at(-1)!).toBeGreaterThan(0.5);
		expect(times.at(-1)!).toBeLessThan(0.5 + 0.3);
	});

	it('never stamps a step in the past, which would make it sound immediately', () => {
		const harness = createHarness({ bpm: 160 });
		harness.transport.start();

		let clock = 0;
		for (let index = 0; index < 40; index += 1) {
			clock += 0.025;
			harness.setNow(clock);
			harness.tick();
		}

		expect(harness.scheduled.length).toBeGreaterThan(10);
		for (const step of harness.scheduled) {
			expect(step.time).toBeGreaterThan(0);
		}
	});

	it('applies a tempo change from the next planned step onwards', () => {
		const harness = createHarness({ bpm: 120 });
		harness.transport.start();
		harness.setBpm(60);

		harness.advance(0.2);
		harness.tick();

		// 60 BPM -> 0.25 s per 16th. Steps planned after the change must be
		// spaced by the new value, while the first one keeps its old position.
		const after = harness.scheduled.filter((step) => step.gridTime > 0.06);
		for (let index = 1; index < after.length; index += 1) {
			expect(after[index].gridTime - after[index - 1].gridTime).toBeCloseTo(0.25, 9);
		}
	});

	it('stops cleanly and can restart from the top', () => {
		const harness = createHarness({ bpm: 120 });
		harness.transport.start();
		const afterFirstRun = harness.scheduled.length;

		harness.transport.stop();
		expect(harness.transport.isRunning).toBe(false);
		expect(harness.hasTimer).toBe(false);
		expect(harness.transport.stepAt(999)).toBeNull();

		harness.transport.start();
		expect(harness.transport.isRunning).toBe(true);
		expect(harness.scheduled.length).toBeGreaterThan(afterFirstRun);
	});

	it('ignores a second start while already running', () => {
		const harness = createHarness({ bpm: 120 });
		harness.transport.start();
		const count = harness.scheduled.length;

		harness.transport.start();

		expect(harness.scheduled.length).toBe(count);
	});

	it('reports the sounding step from the audio clock, not the timer', () => {
		const harness = createHarness({ bpm: 120 });
		harness.transport.start();

		// First step is stamped at 0.06 s.
		expect(harness.transport.stepAt(0.05)).toBeNull();
		expect(harness.transport.stepAt(0.06)).toBe(0);

		harness.advance(0.5);
		harness.tick();

		expect(harness.transport.stepAt(0.2)).toBe(1);
		expect(harness.transport.stepAt(0.35)).toBe(2);
		// Reading the same time twice must be idempotent.
		expect(harness.transport.stepAt(0.35)).toBe(2);
	});
});
