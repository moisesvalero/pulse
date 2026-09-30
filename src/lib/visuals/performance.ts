/**
 * Automatic resolution control.
 *
 * A permanently animated full-screen shader is the most expensive thing on the
 * page, and on weak GPUs (or a high-DPI laptop in a huge window) it can drag the
 * whole interface below 60 fps. When the measured frame rate stays under the
 * target, the renderer quietly lowers the internal resolution: the shader keeps
 * running at the same visual complexity, it is just rasterised at fewer pixels
 * and scaled up by the compositor.
 *
 * The decision logic is deliberately pure — `report(fps)` in, new scale or
 * `null` out — so it can be unit tested without a GPU.
 */

/** Resolution ladder. Discrete steps avoid continuous oscillation. */
export const RESOLUTION_STEPS = [1, 0.85, 0.7, 0.6, 0.5] as const;

export const DEFAULT_TARGET_FPS = 45;
/** Floor for the internal resolution multiplier. */
export const MIN_SCALE = 0.5;

export interface ResolutionOptions {
	/** Frame rate we want to stay at or above. */
	targetFps?: number;
	/** Consecutive slow windows before stepping down. */
	slowWindowsBeforeDowngrade?: number;
	/**
	 * Consecutive fast windows before stepping back up. Much larger than the
	 * downgrade threshold on purpose: recovering too eagerly would flap between
	 * two resolutions and look worse than running at the lower one.
	 */
	fastWindowsBeforeUpgrade?: number;
	/** Ratio over the target required to count as "fast" (hysteresis band). */
	upgradeMargin?: number;
	steps?: readonly number[];
	minScale?: number;
}

export class ResolutionController {
	private readonly targetFps: number;
	private readonly slowLimit: number;
	private readonly fastLimit: number;
	private readonly upgradeAbove: number;
	private readonly steps: readonly number[];
	private readonly minScale: number;

	private scaleIndex = 0;
	private slowWindows = 0;
	private fastWindows = 0;
	private downgradeCount = 0;

	constructor(options: ResolutionOptions = {}) {
		this.targetFps = options.targetFps ?? DEFAULT_TARGET_FPS;
		this.slowLimit = options.slowWindowsBeforeDowngrade ?? 3;
		this.fastLimit = options.fastWindowsBeforeUpgrade ?? 12;
		this.upgradeAbove = this.targetFps * (options.upgradeMargin ?? 1.15);

		// Highest resolution first; the ladder is walked by index. Steps below the
		// floor are dropped, and an impossible floor still leaves one usable step.
		this.minScale = options.minScale ?? MIN_SCALE;
		const ladder = [...(options.steps ?? RESOLUTION_STEPS)]
			.filter((step) => step >= this.minScale && step <= 1)
			.sort((a, b) => b - a);

		this.steps = ladder.length > 0 ? ladder : [1];
	}

	get scale(): number {
		return this.steps[this.scaleIndex];
	}

	/** How many times the resolution has been reduced. */
	get downgrades(): number {
		return this.downgradeCount;
	}

	/**
	 * Feeds one measurement window in.
	 *
	 * @param fps frame rate measured over the last window.
	 * @returns the new scale when it changed, otherwise `null`.
	 */
	report(fps: number): number | null {
		if (!Number.isFinite(fps) || fps <= 0) return null;

		if (fps < this.targetFps) {
			this.fastWindows = 0;
			this.slowWindows += 1;

			if (this.slowWindows < this.slowLimit) return null;
			this.slowWindows = 0;

			if (this.scaleIndex >= this.steps.length - 1) return null;

			this.scaleIndex += 1;
			this.downgradeCount += 1;
			return this.scale;
		}

		if (fps <= this.upgradeAbove) {
			// Inside the hysteresis band: good enough to keep working, not enough
			// to justify spending more pixels.
			this.slowWindows = 0;
			this.fastWindows = 0;
			return null;
		}

		this.slowWindows = 0;
		this.fastWindows += 1;

		if (this.fastWindows < this.fastLimit) return null;
		this.fastWindows = 0;

		if (this.scaleIndex === 0) return null;

		this.scaleIndex -= 1;
		return this.scale;
	}

	reset(): void {
		this.scaleIndex = 0;
		this.slowWindows = 0;
		this.fastWindows = 0;
	}
}
