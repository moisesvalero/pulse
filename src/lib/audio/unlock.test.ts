import { describe, expect, it, vi } from 'vitest';
import { triggerIosAudioUnlock, unlockAudioContext } from './unlock';

describe('triggerIosAudioUnlock', () => {
	it('sets audioSession.type to playback when audioSession is supported', () => {
		const mockAudioSession = { type: 'ambient' };
		const origNavigator = globalThis.navigator;

		Object.defineProperty(globalThis, 'navigator', {
			value: { ...origNavigator, audioSession: mockAudioSession },
			configurable: true,
			writable: true
		});

		try {
			triggerIosAudioUnlock();
			expect(mockAudioSession.type).toBe('playback');
		} finally {
			Object.defineProperty(globalThis, 'navigator', {
				value: origNavigator,
				configurable: true,
				writable: true
			});
		}
	});

	it('does not throw when audioSession is not available', () => {
		expect(() => triggerIosAudioUnlock()).not.toThrow();
	});
});

describe('unlockAudioContext', () => {
	it('resumes suspended or interrupted AudioContext', async () => {
		let resumed = false;
		let sourceStarted = false;

		const mockContext = {
			state: 'suspended',
			sampleRate: 44100,
			destination: {},
			resume: vi.fn(async () => {
				resumed = true;
			}),
			createBuffer: vi.fn(() => ({})),
			createBufferSource: vi.fn(() => ({
				buffer: null,
				connect: vi.fn(),
				start: vi.fn(() => {
					sourceStarted = true;
				})
			}))
		} as unknown as AudioContext;

		await unlockAudioContext(mockContext);

		expect(mockContext.resume).toHaveBeenCalled();
		expect(resumed).toBe(true);
		expect(sourceStarted).toBe(true);
	});

	it('resumes interrupted context as well', async () => {
		const mockContext = {
			state: 'interrupted',
			sampleRate: 48000,
			destination: {},
			resume: vi.fn(async () => {}),
			createBuffer: vi.fn(() => ({})),
			createBufferSource: vi.fn(() => ({
				buffer: null,
				connect: vi.fn(),
				start: vi.fn()
			}))
		} as unknown as AudioContext;

		await unlockAudioContext(mockContext);
		expect(mockContext.resume).toHaveBeenCalled();
	});

	it('skips resume if context is already running', async () => {
		const mockContext = {
			state: 'running',
			sampleRate: 44100,
			destination: {},
			resume: vi.fn(async () => {}),
			createBuffer: vi.fn(() => ({})),
			createBufferSource: vi.fn(() => ({
				buffer: null,
				connect: vi.fn(),
				start: vi.fn()
			}))
		} as unknown as AudioContext;

		await unlockAudioContext(mockContext);
		expect(mockContext.resume).not.toHaveBeenCalled();
	});
});
