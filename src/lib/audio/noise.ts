/**
 * Procedural noise. Pulse ships no sample files: every noise source in the app
 * is a buffer filled at runtime, which keeps the static build free of binaries.
 */

/**
 * Fills a mono buffer with white noise.
 *
 * @param seconds length of the buffer. Two seconds is plenty because the buffer
 *   is looped by the noise sources rather than re-created per hit.
 */
export function createNoiseBuffer(context: BaseAudioContext, seconds = 2): AudioBuffer {
	const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
	const buffer = context.createBuffer(1, frames, context.sampleRate);
	const channel = buffer.getChannelData(0);

	for (let frame = 0; frame < frames; frame += 1) {
		channel[frame] = Math.random() * 2 - 1;
	}

	return buffer;
}

/**
 * Creates a permanently running, looping noise source. It is meant to be gated
 * by an envelope downstream: starting/stopping `AudioBufferSourceNode`s per hit
 * would allocate on every step and can click at the loop boundary.
 */
export function createLoopingNoiseSource(
	context: BaseAudioContext,
	buffer: AudioBuffer
): AudioBufferSourceNode {
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.loop = true;
	source.start();
	return source;
}
