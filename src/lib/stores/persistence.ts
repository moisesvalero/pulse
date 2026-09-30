import { decodeShareState, encodeShareState, toHash, type ShareState } from '$lib/utils/share';

/**
 * Where the instrument state persists.
 *
 * Both layers use the same payload as the URL hash, so there is exactly one
 * format to keep working and one set of tests covering it. The URL wins over
 * local storage at startup: following somebody's link should show *their* patch,
 * not whatever was last open on this machine.
 */

export const STORAGE_KEY = 'pulse:state';

/** Structural subset of `Storage`, so tests can pass a plain object. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/**
 * `localStorage`, or `null` when it cannot be touched.
 *
 * Merely reading the property throws in some privacy modes, so this is a guarded
 * accessor rather than a `typeof` check.
 */
export function getLocalStorage(): StorageLike | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** State found in the URL hash, or `null`. */
export function readHashState(hash: string): ShareState | null {
	return decodeShareState(hash);
}

/** State saved on this device, or `null`. */
export function readStoredState(storage: StorageLike | null): ShareState | null {
	if (!storage) return null;

	let raw: string | null;
	try {
		raw = storage.getItem(STORAGE_KEY);
	} catch {
		// Storage can throw in private modes and when the quota is exhausted.
		return null;
	}

	return raw ? decodeShareState(raw) : null;
}

export function writeStoredState(storage: StorageLike | null, state: ShareState): void {
	if (!storage) return;

	try {
		storage.setItem(STORAGE_KEY, encodeShareState(state));
	} catch {
		// A full or blocked store must never break the instrument.
	}
}

export function clearStoredState(storage: StorageLike | null): void {
	if (!storage) return;

	try {
		storage.removeItem(STORAGE_KEY);
	} catch {
		// Nothing useful to do.
	}
}

/** URL that reproduces `state`, keeping any path and query intact. */
export function buildShareUrl(href: string, state: ShareState): string {
	const hash = toHash(state);

	try {
		const url = new URL(href);
		url.hash = hash;
		return url.toString();
	} catch {
		// Relative or malformed href: fall back to simple concatenation.
		return `${href.split('#')[0]}${hash}`;
	}
}

/**
 * Decides what to load at startup.
 *
 * @param hash current `location.hash`
 * @param storage persistent storage, or `null` when unavailable
 */
export function resolveInitialState(hash: string, storage: StorageLike | null): ShareState | null {
	return readHashState(hash) ?? (storage ? readStoredState(storage) : null);
}
