import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_PARAMS, TRACK_IDS } from '$lib/audio/constants';
import { createDefaultPattern, createEmptyPattern, randomizePattern } from '$lib/audio/pattern';
import type { ShareState } from './share';
import { decodeShareState, encodeShareState, extractPayload, toHash } from './share';

function sampleState(): ShareState {
	return {
		pattern: createDefaultPattern(),
		master: { ...DEFAULT_MASTER_PARAMS, bpm: 143, cutoff: 3200, resonance: 7.4 },
		swing: 0.42
	};
}

describe('encodeShareState', () => {
	it('produces a versioned, readable payload', () => {
		const encoded = encodeShareState(sampleState());

		expect(encoded.startsWith('p1.')).toBe(true);
		// The BPM is legible straight from the payload.
		expect(encoded.split('.')[1].startsWith('143-')).toBe(true);
	});

	it('keeps the payload short enough for a URL', () => {
		const encoded = encodeShareState(sampleState());

		expect(encoded.length).toBeLessThan(200);
	});

	it('uses only URL-safe characters', () => {
		for (let seed = 0; seed < 10; seed += 1) {
			const encoded = encodeShareState({
				pattern: randomizePattern(() => (seed * 0.37) % 1),
				master: DEFAULT_MASTER_PARAMS,
				swing: 0.5
			});

			expect(encoded).toMatch(/^[A-Za-z0-9.\-]+$/);
		}
	});
});

describe('round trip', () => {
	it('restores the exact pattern, params and swing', () => {
		const original = sampleState();
		const decoded = decodeShareState(encodeShareState(original));

		expect(decoded).not.toBeNull();
		expect(decoded?.pattern).toEqual(original.pattern);
		expect(decoded?.master.bpm).toBe(143);
		expect(decoded?.master.cutoff).toBe(3200);
		expect(decoded?.master.resonance).toBeCloseTo(7.4, 9);
		expect(decoded?.swing).toBeCloseTo(0.42, 9);
	});

	it('survives a full random pattern', () => {
		for (let seed = 1; seed <= 25; seed += 1) {
			const original: ShareState = {
				pattern: randomizePattern(mulberry32(seed)),
				master: DEFAULT_MASTER_PARAMS,
				swing: seed / 25
			};

			const decoded = decodeShareState(encodeShareState(original));
			expect(decoded?.pattern).toEqual(original.pattern);
		}
	});

	it('survives the extremes of every lane', () => {
		const pattern = createEmptyPattern();
		for (const track of TRACK_IDS) {
			pattern[track].gates = pattern[track].gates.map(() => true);
		}
		pattern.bass.notes = pattern.bass.notes.map(() => 0);
		pattern.lead.notes = pattern.lead.notes.map(() => 127);
		pattern.pad.notes = pattern.pad.notes.map(() => 60);

		const decoded = decodeShareState(
			encodeShareState({ pattern, master: DEFAULT_MASTER_PARAMS, swing: 1 })
		);

		expect(decoded?.pattern).toEqual(pattern);
	});

	it('round-trips an empty pattern', () => {
		const state: ShareState = {
			pattern: createEmptyPattern(),
			master: DEFAULT_MASTER_PARAMS,
			swing: 0
		};

		expect(decodeShareState(encodeShareState(state))?.pattern).toEqual(state.pattern);
	});
});

describe('decodeShareState validation', () => {
	it('accepts a hash, a bare payload and a whole URL', () => {
		const encoded = encodeShareState(sampleState());

		expect(decodeShareState(encoded)).not.toBeNull();
		expect(decodeShareState(`#${encoded}`)).not.toBeNull();
		expect(decodeShareState(`https://pulse.example/#${encoded}`)).not.toBeNull();
		expect(decodeShareState(`https://pulse.example/?a=1#${encoded}`)).not.toBeNull();
	});

	it('rejects an unknown version instead of guessing', () => {
		const encoded = encodeShareState(sampleState()).replace(/^p1\./, 'p9.');

		expect(decodeShareState(encoded)).toBeNull();
	});

	it('rejects a wrong number of fields', () => {
		expect(decodeShareState('#p1.110-75-6200-12-22-28-16.8421')).toBeNull();
		expect(decodeShareState('#p1.110-75-6200-12-22-28-16')).toBeNull();
	});

	it('rejects out-of-range parameters', () => {
		const base = encodeShareState(sampleState());
		const withBpm = (bpm: string) => base.replace(/^(p1\.)\d+-/, `$1${bpm}-`);

		expect(decodeShareState(withBpm('0'))).toBeNull();
		expect(decodeShareState(withBpm('99999'))).toBeNull();

		// Swing is the last parameter, so it is rebuilt by index rather than by a
		// textual replace that would depend on what follows it.
		const withSwing = (swing: string) => {
			const [version, params, gates, notes] = base.split('.');
			const parts = params.split('-');
			parts[6] = swing;
			return [version, parts.join('-'), gates, notes].join('.');
		};

		expect(decodeShareState(withSwing('400'))).toBeNull();
		expect(decodeShareState(withSwing('100'))).not.toBeNull();
	});

	it('rejects a parameter list with an empty or non-numeric part', () => {
		const base = encodeShareState(sampleState());
		const [version, , gates, notes] = base.split('.');

		expect(decodeShareState([version, '110--6200-12-22-28-16', gates, notes].join('.'))).toBeNull();
		expect(decodeShareState([version, 'abc-75-6200-12-22-28-16', gates, notes].join('.'))).toBeNull();
		expect(decodeShareState([version, '-75-6200-12-22-28-16', gates, notes].join('.'))).toBeNull();
	});

	it('rejects a truncated or oversized gate field', () => {
		const [version, params, gates, notes] = encodeShareState(sampleState()).split('.');

		expect(decodeShareState([version, params, gates.slice(0, -2), notes].join('.'))).toBeNull();
		expect(decodeShareState([version, params, `${gates}ff`, notes].join('.'))).toBeNull();
	});

	it('rejects a gate field with characters outside hex', () => {
		const [version, params, gates, notes] = encodeShareState(sampleState()).split('.');

		expect(
			decodeShareState([version, params, `zz${gates.slice(2)}`, notes].join('.'))
		).toBeNull();
	});

	it('rejects a truncated note field', () => {
		const [version, params, gates, notes] = encodeShareState(sampleState()).split('.');

		expect(decodeShareState([version, params, gates, notes.slice(0, -8)].join('.'))).toBeNull();
	});

	it('rejects a note outside the MIDI range', () => {
		const [version, params, gates, notes] = encodeShareState(sampleState()).split('.');
		// '3z' is base36 for 143, above MIDI 127.
		const broken = `3z${notes.slice(2)}`;

		expect(decodeShareState([version, params, gates, broken].join('.'))).toBeNull();
	});

	it('never throws, whatever it is fed', () => {
		const garbage = [
			'',
			'#',
			'#p1',
			'#p1.',
			'#p1....',
			'#p2.110-75-6200-12-22-28-16.8421.00',
			'#',
			'p1',
			'#p1.' + 'x'.repeat(5000),
			'💥',
			'#p1.💥.💥.💥'
		];

		for (const input of garbage) {
			expect(() => decodeShareState(input)).not.toThrow();
			expect(decodeShareState(input)).toBeNull();
		}
	});

	it('rejects an absurdly long payload before parsing it', () => {
		const huge = `#p1.${'1'.repeat(4000)}`;

		expect(extractPayload(huge)).toBeNull();
		expect(decodeShareState(huge)).toBeNull();
	});

	it('ignores trailing content after the payload', () => {
		const encoded = encodeShareState(sampleState());
		const decoded = decodeShareState(`#${encoded}`);

		expect(decoded).not.toBeNull();
	});
});

describe('toHash', () => {
	it('always prefixes with a single hash', () => {
		const hash = toHash(sampleState());

		expect(hash.startsWith('#p1.')).toBe(true);
		expect(hash.slice(1)).not.toContain('#');
	});

	it('is stable: the same state always encodes identically', () => {
		expect(encodeShareState(sampleState())).toBe(encodeShareState(sampleState()));
	});
});

/** Seeded PRNG so the pattern round-trip test is reproducible. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
