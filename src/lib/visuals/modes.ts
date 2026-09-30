import { TUNNEL_FRAGMENT } from './shaders';

/**
 * Visual modes. Each one is a fragment shader that honours the uniform contract
 * documented in `shaders.ts`; adding a mode means adding one entry here.
 */

export type VisualModeId = 'tunnel' | 'ripple' | 'particles';

export interface VisualMode {
	id: VisualModeId;
	/** Shown in the mode switcher. */
	label: string;
	/** Short description used as the switcher's accessible name. */
	description: string;
	fragment: string;
}

export const VISUAL_MODES: readonly VisualMode[] = [
	{
		id: 'tunnel',
		label: 'Túnel',
		description: 'Túnel de ruido que avanza con los graves',
		fragment: TUNNEL_FRAGMENT
	}
];

export const DEFAULT_VISUAL_MODE: VisualModeId = 'tunnel';

export function findVisualMode(id: VisualModeId): VisualMode {
	return VISUAL_MODES.find((mode) => mode.id === id) ?? VISUAL_MODES[0];
}
