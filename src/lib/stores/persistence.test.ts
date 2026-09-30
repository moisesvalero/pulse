import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_PARAMS } from '$lib/audio/constants';
import { createDefaultPattern, randomizePattern } from '$lib/audio/pattern';
import type { ShareState } from '$lib/utils/share';
import { encodeShareState } from '$lib/utils/share';
import {
	buildShareUrl,
	clearStoredState,
	readHashState,
	readStoredState,
	resolveInitialState,
	STORAGE_KEY,
	writeStoredState,
	type StorageLike
} from './persistence';

/** In-memory `StorageLike` with an optional failure mode. */
function createStorage(options: { throwOnWrite?: boolean; throwOnRead?: boolean } = {}) {
	const data = new Map<string, string>();

	const storage: StorageLike = {
		getItem(key) {
			if (options.throwOnRead) throw new Error('read blocked');
			return data.get(key) ?? null;
		},
		setItem(key, value) {
			if (options.throwOnWrite) throw new Error('quota exceeded');
			data.set(key, value);
		},
		removeItem(key) {
			data.delete(key);
		}
	};

	return { storage, data };
}

function sampleState(): ShareState {
	return {
		pattern: createDefaultPattern(),
		master: { ...DEFAULT_MASTER_PARAMS, bpm: 128 },
		swing: 0.3
	};
}

describe('readHashState', () => {
	it('decodes a valid hash', () => {
		const state = sampleState();

		expect(readHashState(`#${encodeShareState(state)}`)?.master.bpm).toBe(128);
	});

	it('returns null for an unrelated hash', () => {
		expect(readHashState('#section-2')).toBeNull();
		expect(readHashState('')).toBeNull();
	});
});

describe('storage', () => {
	it('round-trips through the same payload format as the URL', () => {
		const { storage, data } = createStorage();
		const state = sampleState();

		writeStoredState(storage, state);

		expect(data.get(STORAGE_KEY)).toBe(encodeShareState(state));
		expect(readStoredState(storage)?.master.bpm).toBe(128);
	});

	it('returns null when nothing is stored', () => {
		const { storage } = createStorage();

		expect(readStoredState(storage)).toBeNull();
	});

	it('returns null for corrupt stored data instead of throwing', () => {
		const { storage, data } = createStorage();
		data.set(STORAGE_KEY, 'not-a-payload');

		expect(readStoredState(storage)).toBeNull();
	});

	it('survives a storage that refuses to write', () => {
		const { storage } = createStorage({ throwOnWrite: true });

		expect(() => writeStoredState(storage, sampleState())).not.toThrow();
	});

	it('survives a storage that refuses to read', () => {
		const { storage } = createStorage({ throwOnRead: true });

		expect(readStoredState(storage)).toBeNull();
	});

	it('does nothing, instead of throwing, when storage is unavailable', () => {
		expect(readStoredState(null)).toBeNull();
		expect(() => writeStoredState(null, sampleState())).not.toThrow();
		expect(() => clearStoredState(null)).not.toThrow();
	});

	it('clears the stored state', () => {
		const { storage, data } = createStorage();

		writeStoredState(storage, sampleState());
		clearStoredState(storage);

		expect(data.has(STORAGE_KEY)).toBe(false);
		expect(readStoredState(storage)).toBeNull();
	});
});

describe('buildShareUrl', () => {
	it('replaces an existing hash, keeping path and query', () => {
		const url = buildShareUrl('https://pulse.example/studio?ref=portfolio#old', sampleState());

		expect(url.startsWith('https://pulse.example/studio?ref=portfolio#p1.')).toBe(true);
		expect(url).not.toContain('old');
	});

	it('adds a hash to a URL that has none', () => {
		const url = buildShareUrl('https://pulse.example/', sampleState());

		expect(url).toMatch(/#p1\./);
	});

	it('is reversible: the built URL decodes back to the same state', () => {
		const state: ShareState = {
			pattern: randomizePattern(() => 0.42),
			master: { ...DEFAULT_MASTER_PARAMS, bpm: 92, cutoff: 1200 },
			swing: 0.75
		};

		const url = buildShareUrl('https://pulse.example/', state);
		const decoded = readHashState(new URL(url).hash);

		expect(decoded?.pattern).toEqual(state.pattern);
		expect(decoded?.master.bpm).toBe(92);
		expect(decoded?.master.cutoff).toBe(1200);
		expect(decoded?.swing).toBeCloseTo(0.75, 9);
	});

	it('falls back to concatenation for a malformed href', () => {
		expect(buildShareUrl('not a url', sampleState())).toMatch(/^not a url#p1\./);
	});
});

describe('resolveInitialState', () => {
	it('prefers the URL over this device, so a shared link shows what was shared', () => {
		const { storage } = createStorage();
		writeStoredState(storage, { ...sampleState(), master: { ...DEFAULT_MASTER_PARAMS, bpm: 70 } });

		const fromUrl = resolveInitialState(
			`#${encodeShareState({ ...sampleState(), master: { ...DEFAULT_MASTER_PARAMS, bpm: 160 } })}`,
			storage
		);

		expect(fromUrl?.master.bpm).toBe(160);
	});

	it('falls back to storage when the hash is absent or invalid', () => {
		const { storage } = createStorage();
		writeStoredState(storage, { ...sampleState(), master: { ...DEFAULT_MASTER_PARAMS, bpm: 70 } });

		expect(resolveInitialState('', storage)?.master.bpm).toBe(70);
		expect(resolveInitialState('#nope', storage)?.master.bpm).toBe(70);
	});

	it('returns null when there is nothing to restore anywhere', () => {
		expect(resolveInitialState('', null)).toBeNull();
		expect(resolveInitialState('#nope', createStorage().storage)).toBeNull();
	});

	it('works without storage at all', () => {
		const state = { ...sampleState(), master: { ...DEFAULT_MASTER_PARAMS, bpm: 101 } };

		expect(resolveInitialState(`#${encodeShareState(state)}`, null)?.master.bpm).toBe(101);
	});
});
