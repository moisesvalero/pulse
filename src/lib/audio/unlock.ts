/**
 * iOS Safari Web Audio Unlocking & Session Management.
 *
 * Safari on iOS has three strict restrictions that silence Web Audio:
 * 1. Physical Silent Switch: By default, Web Audio API is classified as "ambient"
 *    audio on iOS, so it is completely muted when the hardware silent switch or
 *    Focus Silent Mode is enabled. Setting `navigator.audioSession.type = 'playback'`
 *    and playing a silent HTML5 audio snippet routes the session to the "media" channel.
 * 2. Gesture / Autoplay policy: `AudioContext` starts suspended or interrupted.
 *    Resuming it and playing a 1-sample silent buffer directly to `destination`
 *    forces WebKit's CoreAudio output unit to spin up and connect to hardware.
 * 3. Interrupted state: Tab backgrounding or incoming notifications transition
 *    the context state to 'interrupted' rather than 'suspended'.
 */

let iosAudioUnlocked = false;

/** Minimal valid silent 44-byte WAV header (PCM, 1 channel, 8000 Hz, 8-bit). */
const SILENT_WAV_DATA_URI =
	'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/**
 * Triggers iOS Safari to switch audio category from "Ambient" (muted by physical silent switch)
 * to "Playback" (media channel that plays through speakers even in silent mode).
 * Must be invoked inside a user interaction (tap, click).
 */
export function triggerIosAudioUnlock(): void {
	// 1. Standard AudioSession API (Safari 16.4+, iOS 17+)
	if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
		try {
			(navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'playback';
		} catch {
			// Ignore if restricted or unsupported
		}
	}

	// 2. HTML5 Audio element trick for iOS Safari (all iOS versions)
	if (!iosAudioUnlocked && typeof Audio !== 'undefined') {
		try {
			const audio = new Audio(SILENT_WAV_DATA_URI);
			audio.volume = 0.01;
			const playPromise = audio.play();
			if (playPromise !== undefined) {
				playPromise
					.then(() => {
						iosAudioUnlocked = true;
					})
					.catch(() => {
						// Ignored: browser may require subsequent gesture
					});
			}
		} catch {
			// Ignore DOM exceptions
		}
	}
}

/**
 * Ensures the AudioContext is resumed and the hardware audio pipeline is spun up.
 */
export async function unlockAudioContext(context: AudioContext): Promise<void> {
	triggerIosAudioUnlock();

	if (context.state !== 'running') {
		try {
			await context.resume();
		} catch {
			// AudioContext resume might fail if gesture context expired
		}
	}

	// WebKit / iOS Safari hardware warm-up: playing an empty 1-sample buffer
	// forces CoreAudio to connect to the physical speaker.
	try {
		const sampleRate = context.sampleRate || 22050;
		const buffer = context.createBuffer(1, 1, sampleRate);
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		source.start(0);
	} catch {
		// Non-fatal if buffer cannot be created
	}
}
