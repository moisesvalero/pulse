import { describe, expect, it } from 'vitest';
import {
	anchorParam,
	computeAdsrTiming,
	FADE_TAIL_SECONDS,
	MIN_ATTACK_SECONDS,
	scheduleAdsr,
	schedulePercussiveEnvelope,
	schedulePitch,
	SILENCE_FLOOR,
	type AmpEnvelope,
	type AudioParamLike
} from './envelope';
import { midiToFrequency, midiToNoteName } from './pitch';

type AutomationKind = 'cancel' | 'hold' | 'set' | 'linear' | 'exp' | 'target';

interface Automation {
	kind: AutomationKind;
	time: number;
	value?: number;
	timeConstant?: number;
}

interface FakeParam extends AudioParamLike {
	readonly automation: Automation[];
}

/**
 * Records the automation timeline instead of writing to real hardware. This is
 * the whole reason `envelope.ts` targets a structural subset of `AudioParam`.
 *
 * `hold: false` simulates an implementation without `cancelAndHoldAtTime`, so
 * the legacy anchor path gets covered too.
 */
function createFakeParam(options: { hold?: boolean; value?: number } = {}): FakeParam {
	const automation: Automation[] = [];

	const param: FakeParam = {
		value: options.value ?? 0,
		automation,
		cancelScheduledValues(time) {
			automation.push({ kind: 'cancel', time });
		},
		setValueAtTime(value, time) {
			automation.push({ kind: 'set', time, value });
		},
		setTargetAtTime(target, time, timeConstant) {
			automation.push({ kind: 'target', time, value: target, timeConstant });
		},
		linearRampToValueAtTime(value, time) {
			automation.push({ kind: 'linear', time, value });
		},
		exponentialRampToValueAtTime(value, time) {
			automation.push({ kind: 'exp', time, value });
		}
	};

	if (options.hold !== false) {
		param.cancelAndHoldAtTime = (time) => {
			automation.push({ kind: 'hold', time });
		};
	}

	return param;
}

const AMP: AmpEnvelope = { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 };

describe('computeAdsrTiming', () => {
	it('keeps the timeline monotonic when the gate is shorter than attack+decay', () => {
		const timing = computeAdsrTiming(10, 0.125, AMP);

		expect(timing.attackEnd).toBeCloseTo(10.01, 6);
		// Decay is squeezed to finish exactly at note off.
		expect(timing.decayEnd).toBeCloseTo(10.125, 6);
		expect(timing.releaseStart).toBeCloseTo(10.125, 6);
		expect(timing.releaseEnd).toBeCloseTo(10.425, 6);
		expect(timing.silentAt).toBeCloseTo(10.425 + FADE_TAIL_SECONDS, 6);
	});

	it('holds the sustain level when the gate is longer than attack+decay', () => {
		const timing = computeAdsrTiming(2, 1.5, AMP);

		expect(timing.attackEnd).toBeCloseTo(2.01, 6);
		expect(timing.decayEnd).toBeCloseTo(2.21, 6);
		expect(timing.releaseStart).toBeCloseTo(3.5, 6);
	});

	it('never releases before the attack has finished', () => {
		const timing = computeAdsrTiming(0, 0, AMP);

		expect(timing.attackEnd).toBeGreaterThanOrEqual(MIN_ATTACK_SECONDS);
		expect(timing.releaseStart).toBeGreaterThanOrEqual(timing.attackEnd);
		expect(timing.decayEnd).toBeGreaterThanOrEqual(timing.attackEnd);
	});

	it('guarantees time <= attackEnd <= decayEnd <= releaseStart <= releaseEnd', () => {
		for (const gate of [0, 0.001, 0.05, 0.125, 0.5, 2, 10]) {
			const timing = computeAdsrTiming(5, gate, AMP);
			expect(timing.attackEnd).toBeGreaterThanOrEqual(5);
			expect(timing.decayEnd).toBeGreaterThanOrEqual(timing.attackEnd);
			expect(timing.releaseStart).toBeGreaterThanOrEqual(timing.decayEnd);
			expect(timing.releaseEnd).toBeGreaterThanOrEqual(timing.releaseStart);
			expect(timing.silentAt).toBeGreaterThan(timing.releaseEnd);
		}
	});

	it('treats a negative gate as an instant note off', () => {
		const timing = computeAdsrTiming(1, -5, AMP);

		expect(timing.releaseStart).toBeGreaterThanOrEqual(timing.attackEnd);
		expect(Number.isFinite(timing.silentAt)).toBe(true);
	});
});

describe('anchorParam', () => {
	it('uses cancelAndHoldAtTime when the implementation provides it', () => {
		const param = createFakeParam({ value: 0.4 });
		anchorParam(param, 3);

		expect(param.automation).toEqual([{ kind: 'hold', time: 3 }]);
	});

	it('falls back to cancelling and re-anchoring on the current value', () => {
		const param = createFakeParam({ hold: false, value: 0.4 });
		anchorParam(param, 3);

		expect(param.automation).toEqual([
			{ kind: 'cancel', time: 3 },
			{ kind: 'set', time: 3, value: 0.4 }
		]);
	});
});

describe('scheduleAdsr', () => {
	it('writes ramps in non-decreasing time order', () => {
		const param = createFakeParam();
		scheduleAdsr(param, 10, 0.8, 0.125, AMP);

		const times = param.automation.map((event) => event.time);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});

	it('reaches exactly zero at the end so the voice is truly silent', () => {
		const param = createFakeParam();
		const timing = scheduleAdsr(param, 0, 0.8, 0.125, AMP);

		expect(param.automation.at(-1)).toEqual({
			kind: 'linear',
			time: timing.silentAt,
			value: 0
		});
	});

	it('scales the peak by the note velocity', () => {
		const quiet = createFakeParam();
		const loud = createFakeParam();

		scheduleAdsr(quiet, 0, 0.8 * 0.25, 0.125, AMP);
		scheduleAdsr(loud, 0, 0.8, 0.125, AMP);

		expect(quiet.automation[1].value).toBeCloseTo(0.2, 6);
		expect(loud.automation[1].value).toBeCloseTo(0.8, 6);
	});

	it('never targets zero with an exponential ramp, which Web Audio rejects', () => {
		const param = createFakeParam();
		scheduleAdsr(param, 0, 1, 0.125, { attack: 0, decay: 0, sustain: 0, release: 0 });

		for (const event of param.automation) {
			if (event.kind === 'exp') expect(event.value).toBeGreaterThan(0);
			if (event.kind === 'linear') expect(event.value).toBeGreaterThanOrEqual(0);
		}
	});

	it('keeps the sustain plateau when the note is held longer than the decay', () => {
		const param = createFakeParam();
		scheduleAdsr(param, 0, 1, 2, AMP);

		const plateau = param.automation.find((event) => event.kind === 'set' && event.time === 2);
		expect(plateau?.value).toBeCloseTo(0.5, 6);
	});
});

describe('schedulePercussiveEnvelope', () => {
	it('decays exponentially to the silence floor and then fades to zero', () => {
		const param = createFakeParam();
		const silentAt = schedulePercussiveEnvelope(param, 4, 0.9, 0.3);

		expect(param.automation).toEqual([
			{ kind: 'hold', time: 4 },
			{ kind: 'set', time: 4, value: 0.9 },
			{ kind: 'exp', time: 4.3, value: SILENCE_FLOOR },
			{ kind: 'linear', time: 4.3 + FADE_TAIL_SECONDS, value: 0 }
		]);
		expect(silentAt).toBeCloseTo(4.3 + FADE_TAIL_SECONDS, 6);
	});

	it('clamps a zero or negative decay to a minimum length', () => {
		const param = createFakeParam();
		const silentAt = schedulePercussiveEnvelope(param, 0, 1, 0);

		expect(silentAt).toBeGreaterThan(0);
	});

	it('ignores a zero peak, which would make the exponential ramp invalid', () => {
		const param = createFakeParam();
		schedulePercussiveEnvelope(param, 0, 0, 0.2);

		const setEvent = param.automation.find((event) => event.kind === 'set');
		expect(setEvent?.value).toBe(SILENCE_FLOOR);
	});
});

describe('schedulePitch', () => {
	it('snaps the frequency when glide is zero', () => {
		const param = createFakeParam();
		schedulePitch(param, 1, 220, 0);

		expect(param.automation).toEqual([
			{ kind: 'cancel', time: 1 },
			{ kind: 'set', time: 1, value: 220 }
		]);
	});

	it('uses an exponential approach with a third of the glide as time constant', () => {
		const param = createFakeParam();
		schedulePitch(param, 1, 330, 0.09);

		expect(param.automation).toEqual([
			{ kind: 'target', time: 1, value: 330, timeConstant: 0.03 }
		]);
	});

	it('snaps when the implementation lacks setTargetAtTime', () => {
		const param = createFakeParam();
		param.setTargetAtTime = undefined;
		schedulePitch(param, 1, 440, 0.09);

		expect(param.automation).toContainEqual({ kind: 'set', time: 1, value: 440 });
	});
});

describe('pitch helpers', () => {
	it('maps A4 to 440 Hz and the octaves around it', () => {
		expect(midiToFrequency(69)).toBeCloseTo(440, 9);
		expect(midiToFrequency(57)).toBeCloseTo(220, 9);
		expect(midiToFrequency(81)).toBeCloseTo(880, 9);
	});

	it('maps middle C to roughly 261.63 Hz', () => {
		expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
	});

	it('names notes with the scientific octave convention', () => {
		expect(midiToNoteName(60)).toBe('C4');
		expect(midiToNoteName(40)).toBe('E2');
		expect(midiToNoteName(61)).toBe('C#4');
	});
});
