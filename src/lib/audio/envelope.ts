/**
 * Envelope scheduling.
 *
 * These functions contain no Web Audio objects on purpose: they only write to a
 * structural subset of `AudioParam`, so unit tests can drive them with a fake
 * that records the automation timeline. Everything is expressed relative to an
 * absolute time on the AudioContext clock, which is what makes the look-ahead
 * scheduler glitch-free.
 */

/** Structural subset of `AudioParam` that the envelope writer needs. */
export interface AudioParamLike {
	/** Value of the param *now* (not at `time`). Used by the legacy anchor path. */
	value: number;
	cancelScheduledValues(startTime: number): void;
	setValueAtTime(value: number, startTime: number): void;
	setTargetAtTime?(target: number, startTime: number, timeConstant: number): void;
	linearRampToValueAtTime(value: number, endTime: number): void;
	exponentialRampToValueAtTime(value: number, endTime: number): void;
	cancelAndHoldAtTime?(cancelTime: number): void;
}

export interface AmpEnvelope {
	/** Seconds from note start to peak. */
	attack: number;
	/** Seconds from peak to the sustain level. */
	decay: number;
	/** Sustain level as a fraction of the peak (0..1). */
	sustain: number;
	/** Seconds from note off to silence. */
	release: number;
}

/** Timings computed for one scheduled note, relative to the AudioContext clock. */
export interface AdsrTiming {
	attackEnd: number;
	decayEnd: number;
	releaseStart: number;
	releaseEnd: number;
	/** When the voice is guaranteed to be silent again. */
	silentAt: number;
}

/**
 * `exponentialRampToValueAtTime` refuses to target zero, so envelopes decay to
 * this floor and then fade linearly to true silence.
 */
export const SILENCE_FLOOR = 0.0001;

/** Extra linear fade used to actually reach 0 after the exponential decay. */
export const FADE_TAIL_SECONDS = 0.008;

/** Envelopes never use a true zero attack; a couple of milliseconds avoids clicks. */
export const MIN_ATTACK_SECONDS = 0.001;

/**
 * Pins the param to the value it will actually have at `time`, discarding any
 * automation scheduled after that point.
 *
 * Why this matters: a voice is retriggered while its previous release may still
 * be ringing (the pad releases for over a second). Jumping straight to zero
 * would produce an audible click, so we hold the computed value and ramp from
 * there. `cancelAndHoldAtTime` is the exact primitive; browsers without it fall
 * back to anchoring on the current value.
 */
export function anchorParam(param: AudioParamLike, time: number): void {
	if (typeof param.cancelAndHoldAtTime === 'function') {
		try {
			param.cancelAndHoldAtTime(time);
			return;
		} catch {
			// WebKit/Safari can throw RangeError if cancelTime is in the past.
			// Fall through to cancelScheduledValues + setValueAtTime.
		}
	}

	const held = param.value;
	try {
		param.cancelScheduledValues(time);
		param.setValueAtTime(held, time);
	} catch {
		// Non-fatal parameter anchor fallback
	}
}

/**
 * Pure timing maths. Guarantees a monotonic timeline:
 * `time <= attackEnd <= decayEnd <= releaseStart <= releaseEnd`.
 *
 * When the gate is shorter than attack + decay (the normal case for a 16th note)
 * the decay is squeezed to finish exactly at note off, so short notes simply get
 * a snappier decay instead of an out-of-order ramp.
 */
export function computeAdsrTiming(
	time: number,
	holdSeconds: number,
	envelope: AmpEnvelope
): AdsrTiming {
	const attack = Math.max(envelope.attack, MIN_ATTACK_SECONDS);
	const attackEnd = time + attack;
	const noteOff = time + Math.max(holdSeconds, 0);

	let decayEnd = attackEnd + Math.max(envelope.decay, 0);
	if (noteOff < decayEnd) {
		decayEnd = Math.max(attackEnd, noteOff);
	}

	const releaseStart = Math.max(decayEnd, noteOff);
	const releaseEnd = releaseStart + Math.max(envelope.release, 0);

	return {
		attackEnd,
		decayEnd,
		releaseStart,
		releaseEnd,
		silentAt: releaseEnd + FADE_TAIL_SECONDS
	};
}

/**
 * Writes a full attack/decay/sustain/release shape onto `param`, starting at
 * absolute time `time`. `holdSeconds` is the gate length (how long the key is
 * held); the release begins right after it.
 */
export function scheduleAdsr(
	param: AudioParamLike,
	time: number,
	peak: number,
	holdSeconds: number,
	envelope: AmpEnvelope
): AdsrTiming {
	const timing = computeAdsrTiming(time, holdSeconds, envelope);
	const sustainLevel = Math.max(peak * clamp01(envelope.sustain), SILENCE_FLOOR);

	anchorParam(param, time);

	// Linear attack: musical and cheap, and it starts from whatever the voice
	// was doing, so retriggers never click.
	param.linearRampToValueAtTime(peak, timing.attackEnd);
	if (timing.decayEnd > timing.attackEnd) {
		param.linearRampToValueAtTime(sustainLevel, timing.decayEnd);
	}

	// Pin the sustain level so a note held longer than attack+decay stays flat.
	if (timing.releaseStart > timing.decayEnd) {
		param.setValueAtTime(sustainLevel, timing.releaseStart);
	}

	param.linearRampToValueAtTime(SILENCE_FLOOR, timing.releaseEnd);
	param.linearRampToValueAtTime(0, timing.silentAt);

	return timing;
}

/**
 * Percussive envelope: instant attack, exponential decay to silence. Used by the
 * kick and the hi-hat, where a sustain stage makes no sense.
 *
 * @returns the time at which the voice is silent again.
 */
export function schedulePercussiveEnvelope(
	param: AudioParamLike,
	time: number,
	peak: number,
	decaySeconds: number
): number {
	const decayEnd = time + Math.max(decaySeconds, MIN_ATTACK_SECONDS);

	anchorParam(param, time);
	param.setValueAtTime(Math.max(peak, SILENCE_FLOOR), time);
	param.exponentialRampToValueAtTime(SILENCE_FLOOR, decayEnd);
	param.linearRampToValueAtTime(0, decayEnd + FADE_TAIL_SECONDS);

	return decayEnd + FADE_TAIL_SECONDS;
}

/**
 * Pitch automation. With `glideSeconds = 0` the frequency snaps at `time`;
 * otherwise it approaches `frequency` exponentially (time constant = glide/3,
 * so roughly 95% of the distance is covered within `glideSeconds`).
 */
export function schedulePitch(
	frequency: AudioParamLike,
	time: number,
	hertz: number,
	glideSeconds: number
): void {
	if (glideSeconds > 0 && typeof frequency.setTargetAtTime === 'function') {
		try {
			// A new target replaces the previous one; no cancel needed.
			frequency.setTargetAtTime(hertz, time, glideSeconds / 3);
			return;
		} catch {
			// Fall back to setValueAtTime if setTargetAtTime throws
		}
	}

	try {
		frequency.cancelScheduledValues(time);
		frequency.setValueAtTime(hertz, time);
	} catch {
		// Non-fatal parameter fallback
	}
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
