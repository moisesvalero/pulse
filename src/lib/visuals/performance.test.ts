import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TARGET_FPS,
	ResolutionController,
	RESOLUTION_STEPS
} from './performance';

/** Feeds the same frame rate in `count` times and returns the last decision. */
function hold(controller: ResolutionController, fps: number, count: number): number | null {
	let decision: number | null = null;
	for (let index = 0; index < count; index += 1) decision = controller.report(fps);
	return decision;
}

describe('ResolutionController', () => {
	it('starts at full resolution', () => {
		const controller = new ResolutionController();

		expect(controller.scale).toBe(1);
		expect(controller.downgrades).toBe(0);
	});

	it('ignores a single slow window', () => {
		const controller = new ResolutionController();

		expect(controller.report(20)).toBeNull();
		expect(controller.scale).toBe(1);
	});

	it('steps down only after the slowness is sustained', () => {
		const controller = new ResolutionController({ slowWindowsBeforeDowngrade: 3 });

		expect(hold(controller, 20, 2)).toBeNull();
		expect(hold(controller, 20, 1)).toBe(RESOLUTION_STEPS[1]);
		expect(controller.downgrades).toBe(1);
	});

	it('forgets a slow streak as soon as one healthy window arrives', () => {
		const controller = new ResolutionController({ slowWindowsBeforeDowngrade: 3 });

		controller.report(20);
		controller.report(20);
		controller.report(60);

		expect(hold(controller, 20, 2)).toBeNull();
		expect(controller.scale).toBe(1);
	});

	it('keeps stepping down while the frame rate stays low', () => {
		const controller = new ResolutionController({ slowWindowsBeforeDowngrade: 1 });

		hold(controller, 10, 1);
		hold(controller, 10, 1);
		hold(controller, 10, 1);

		expect(controller.scale).toBe(RESOLUTION_STEPS[3]);
	});

	it('never goes below the lowest step', () => {
		const controller = new ResolutionController({ slowWindowsBeforeDowngrade: 1 });

		for (let index = 0; index < 40; index += 1) controller.report(5);

		expect(controller.scale).toBe(RESOLUTION_STEPS.at(-1));
		expect(controller.scale).toBeGreaterThanOrEqual(0.5);
	});

	it('does not bounce up and down around the target', () => {
		const controller = new ResolutionController({
			slowWindowsBeforeDowngrade: 2,
			fastWindowsBeforeUpgrade: 4
		});

		// Alternating slow/fast windows: the fast streak never accumulates.
		for (let index = 0; index < 20; index += 1) {
			controller.report(60);
			controller.report(20);
		}

		expect(controller.scale).toBe(1);
		expect(controller.downgrades).toBe(0);
	});

	it('treats frame rates just above the target as "keep going", not "upgrade"', () => {
		const controller = new ResolutionController({
			fastWindowsBeforeUpgrade: 1,
			slowWindowsBeforeDowngrade: 1
		});

		// 1.05x the target is inside the hysteresis band.
		expect(controller.report(DEFAULT_TARGET_FPS * 1.05)).toBeNull();
		expect(controller.scale).toBe(1);
	});

	it('recovers resolution after a long healthy stretch', () => {
		const controller = new ResolutionController({
			slowWindowsBeforeDowngrade: 1,
			fastWindowsBeforeUpgrade: 3
		});

		hold(controller, 10, 1);
		expect(controller.scale).toBe(RESOLUTION_STEPS[1]);

		expect(hold(controller, 120, 2)).toBeNull();
		expect(hold(controller, 120, 1)).toBe(1);
		expect(controller.scale).toBe(1);
	});

	it('ignores a non-finite or zero measurement', () => {
		const controller = new ResolutionController({ slowWindowsBeforeDowngrade: 1 });

		expect(controller.report(Number.NaN)).toBeNull();
		expect(controller.report(0)).toBeNull();
		expect(controller.report(Number.POSITIVE_INFINITY)).toBeNull();
		expect(controller.scale).toBe(1);
	});

	it('keeps the ladder sorted from most to least detailed', () => {
		const controller = new ResolutionController({ steps: [0.5, 1, 0.7] });

		expect(controller.scale).toBe(1);
	});

	it('reset returns to full resolution', () => {
		const controller = new ResolutionController({ slowWindowsBeforeDowngrade: 1 });

		hold(controller, 10, 3);
		controller.reset();

		expect(controller.scale).toBe(1);
	});
});
