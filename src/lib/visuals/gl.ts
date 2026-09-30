/**
 * Minimal WebGL helpers.
 *
 * Pulse uses raw WebGL on purpose: the visuals are a single full-screen quad and
 * a handwritten fragment shader, so OGL or Three.js would add six figures of
 * kilobytes for features that never get used.
 *
 * WebGL 1 (GLSL ES 1.00) is the target, which keeps the shaders portable to
 * every browser including older mobile ones. Note the 1.00 conventions used
 * throughout: `attribute` / `varying` instead of `in` / `out`, and a mandatory
 * `precision` statement in fragment shaders.
 */

export type Gl = WebGLRenderingContext;

/** Compiles one shader stage, throwing the driver's log on failure. */
export function compileShader(context: Gl, type: number, source: string): WebGLShader {
	const shader = context.createShader(type);
	if (!shader) {
		throw new Error('WebGL could not create a shader object.');
	}

	context.shaderSource(shader, source);
	context.compileShader(shader);

	if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
		const log = context.getShaderInfoLog(shader) ?? 'unknown error';
		context.deleteShader(shader);
		const stage = type === context.VERTEX_SHADER ? 'vertex' : 'fragment';
		throw new Error(`Failed to compile the ${stage} shader: ${log}`);
	}

	return shader;
}

/** Links a vertex and a fragment shader into a program. */
export function createProgram(context: Gl, vertexSource: string, fragmentSource: string): WebGLProgram {
	const vertex = compileShader(context, context.VERTEX_SHADER, vertexSource);
	const fragment = compileShader(context, context.FRAGMENT_SHADER, fragmentSource);

	const program = context.createProgram();
	if (!program) {
		throw new Error('WebGL could not create a program object.');
	}

	context.attachShader(program, vertex);
	context.attachShader(program, fragment);
	context.bindAttribLocation(program, 0, 'a_position');
	context.linkProgram(program);

	// The stages are reference-counted by the program once linked.
	context.deleteShader(vertex);
	context.deleteShader(fragment);

	if (!context.getProgramParameter(program, context.LINK_STATUS)) {
		const log = context.getProgramInfoLog(program) ?? 'unknown error';
		context.deleteProgram(program);
		throw new Error(`Failed to link the shader program: ${log}`);
	}

	return program;
}

/**
 * Builds a two-triangle quad covering clip space.
 *
 * A single oversized triangle would be marginally cheaper, but a quad keeps the
 * vertex shader trivial to reason about and the cost is irrelevant at this size.
 */
export function createFullscreenQuad(context: Gl): WebGLBuffer {
	const buffer = context.createBuffer();
	if (!buffer) {
		throw new Error('WebGL could not create a vertex buffer.');
	}

	const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

	context.bindBuffer(context.ARRAY_BUFFER, buffer);
	context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);

	return buffer;
}

/**
 * Resizes the drawing buffer to match the CSS size.
 *
 * @param scale multiplier for the internal resolution (task C4 lowers it when the
 *   frame rate drops, trading sharpness for smoothness).
 * @returns `true` when the size actually changed, which is also when the caller
 *   must re-issue `gl.viewport`.
 */
export function resizeCanvasToDisplaySize(
	canvas: HTMLCanvasElement,
	scale = 1,
	maxDpr = 2
): boolean {
	const dpr = Math.min(globalThis.devicePixelRatio || 1, maxDpr);
	const width = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
	const height = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));

	if (canvas.width === width && canvas.height === height) return false;

	canvas.width = width;
	canvas.height = height;
	return true;
}

/**
 * Creates a WebGL context, preferring the low-power hint because the visuals run
 * permanently in the background and should not drain a laptop battery.
 */
export function createGlContext(canvas: HTMLCanvasElement): Gl | null {
	const attributes: WebGLContextAttributes = {
		alpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		powerPreference: 'low-power',
		preserveDrawingBuffer: false,
		premultipliedAlpha: true
	};

	const context = canvas.getContext('webgl', attributes);
	return (context as Gl | null) ?? null;
}
