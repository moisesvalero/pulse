import { DEFAULT_VISUAL_MODE, VISUAL_MODES, type VisualModeId } from '$lib/visuals/modes';

/**
 * Visual settings, kept out of `studio` because the audio engine must keep
 * working even when WebGL does not.
 */
class VisualSettings {
	mode = $state<VisualModeId>(DEFAULT_VISUAL_MODE);
	/** Measured frame rate, reported twice per second by the renderer. */
	fps = $state(0);
	/** Internal resolution multiplier currently in use (task C4). */
	scale = $state(1);
	/** True once a WebGL context exists; false shows the CSS fallback. */
	supported = $state(true);

	get modeIndex(): number {
		return VISUAL_MODES.findIndex((candidate) => candidate.id === this.mode);
	}

	setMode(id: VisualModeId): void {
		this.mode = id;
	}

	/** Cycles through the modes; used by the keyboard shortcut and the switcher. */
	cycle(direction = 1): void {
		const total = VISUAL_MODES.length;
		const next = (this.modeIndex + direction + total) % total;
		this.mode = VISUAL_MODES[next].id;
	}
}

export const visuals = new VisualSettings();
