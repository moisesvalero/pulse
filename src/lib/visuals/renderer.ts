import {
	createFullscreenQuad,
	createGlContext,
	createProgram,
	resizeCanvasToDisplaySize,
	type Gl
} from './gl';
import { findVisualMode, type VisualModeId } from './modes';
import { FULLSCREEN_VERTEX } from './shaders';

/**
 * Owns the WebGL context and the render loop.
 *
 * Everything that can leak is created here and released in `dispose()`: the
 * context, the vertex buffer, every linked program and the animation frame.
 * `Visualizer.svelte` calls `dispose()` from an `$effect` cleanup, so the whole
 * GPU side is torn down when the component unmounts.
 */

/** Uniforms every mode declares. Locations are resolved once per program. */
const UNIFORM_NAMES = ['u_resolution', 'u_time', 'u_bands', 'u_level', 'u_intensity'] as const;

/** Audio bands fed to the shaders, each 0..1. */
export interface VisualBands {
	bass: number;
	mid: number;
	treble: number;
	level: number;
}

export const SILENT_BANDS: VisualBands = { bass: 0, mid: 0, treble: 0, level: 0 };

export interface RendererStats {
	fps: number;
	/** Internal resolution multiplier currently in use. */
	scale: number;
}

export interface VisualRendererOptions {
	canvas: HTMLCanvasElement;
	getMode: () => VisualModeId;
	/** Visual intensity multiplier; lowered for `prefers-reduced-motion`. */
	getIntensity: () => number;
	getBands: () => VisualBands;
	/** Reports the measured frame rate roughly twice per second. */
	onStats?: (stats: RendererStats) => void;
	/**
	 * Reports the current bands at ~20 Hz. Deliberately slower than the frame
	 * rate: the UI only needs to render a meter, not every audio frame.
	 */
	onBands?: (bands: VisualBands) => void;
	/** Internal resolution multiplier. Task C4 lowers it when frames get slow. */
	scale?: number;
}

interface CompiledMode {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation | null>;
}

/** Time delta is clamped so a backgrounded tab cannot fast-forward the shader. */
const MAX_FRAME_DELTA_SECONDS = 0.1;
/** Frames are averaged over this window before reporting an fps figure. */
const FPS_WINDOW_SECONDS = 0.5;
/** Bands are pushed to the UI this often, whatever the frame rate is. */
const BANDS_REPORT_INTERVAL_SECONDS = 0.05;

export class VisualRenderer {
	private readonly canvas: HTMLCanvasElement;
	private readonly options: VisualRendererOptions;
	private readonly gl: Gl;
	private readonly quad: WebGLBuffer;
	private readonly compiled = new Map<VisualModeId, CompiledMode>();

	private raf: number | null = null;
	private elapsed = 0;
	private lastFrameTime = 0;
	private framesSinceReport = 0;
	private windowSeconds = 0;
	private bandsWindowSeconds = 0;
	private latestBands: VisualBands = SILENT_BANDS;
	private disposed = false;

	/** Internal resolution multiplier; 1 = full device pixel ratio. */
	scale: number;

	private constructor(canvas: HTMLCanvasElement, gl: Gl, options: VisualRendererOptions) {
		this.canvas = canvas;
		this.gl = gl;
		this.options = options;
		this.scale = options.scale ?? 1;
		this.quad = createFullscreenQuad(gl);

		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);
	}

	/** @returns `null` when the browser has no usable WebGL context. */
	static create(options: VisualRendererOptions): VisualRenderer | null {
		const gl = createGlContext(options.canvas);
		if (!gl) return null;
		return new VisualRenderer(options.canvas, gl, options);
	}

	start(): void {
		if (this.raf !== null || this.disposed) return;
		this.lastFrameTime = performance.now();
		this.raf = requestAnimationFrame(this.frame);
	}

	stop(): void {
		if (this.raf === null) return;
		cancelAnimationFrame(this.raf);
		this.raf = null;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		this.stop();

		for (const mode of this.compiled.values()) {
			this.gl.deleteProgram(mode.program);
		}
		this.compiled.clear();

		this.gl.deleteBuffer(this.quad);

		// Hand the GPU memory back immediately instead of waiting for the
		// garbage collector to notice the canvas is gone.
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}

	private frame = (now: number): void => {
		if (this.disposed) return;
		this.raf = requestAnimationFrame(this.frame);

		// Clamped so a long pause (background tab, breakpoint) cannot teleport
		// the animation forward by seconds.
		const delta = Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_DELTA_SECONDS);
		this.lastFrameTime = now;
		this.elapsed += delta;

		this.draw();
		this.measure(delta);
	};

	private draw(): void {
		const gl = this.gl;
		const mode = this.resolveMode(this.options.getMode());
		if (!mode) return;

		if (resizeCanvasToDisplaySize(this.canvas, this.scale)) {
			gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		}

		gl.useProgram(mode.program);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		const bands = this.options.getBands();
		this.latestBands = bands;

		gl.uniform2f(mode.uniforms.u_resolution, this.canvas.width, this.canvas.height);
		gl.uniform1f(mode.uniforms.u_time, this.elapsed);
		gl.uniform3f(mode.uniforms.u_bands, bands.bass, bands.mid, bands.treble);
		gl.uniform1f(mode.uniforms.u_level, bands.level);
		gl.uniform1f(mode.uniforms.u_intensity, this.options.getIntensity());

		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	/** Frame accounting. The two reports are independent so disabling one does
	 *  not silence the other. */
	private measure(delta: number): void {
		if (this.options.onBands) {
			this.bandsWindowSeconds += delta;
			if (this.bandsWindowSeconds >= BANDS_REPORT_INTERVAL_SECONDS) {
				this.options.onBands(this.latestBands);
				this.bandsWindowSeconds = 0;
			}
		}

		if (!this.options.onStats) return;

		this.framesSinceReport += 1;
		this.windowSeconds += delta;

		if (this.windowSeconds < FPS_WINDOW_SECONDS) return;

		this.options.onStats({
			fps: this.framesSinceReport / this.windowSeconds,
			scale: this.scale
		});

		this.framesSinceReport = 0;
		this.windowSeconds = 0;
	}

	/** Compiles a mode on first use and keeps it for later switches. */
	private resolveMode(id: VisualModeId): CompiledMode | null {
		const cached = this.compiled.get(id);
		if (cached) return cached;

		try {
			const program = createProgram(this.gl, FULLSCREEN_VERTEX, findVisualMode(id).fragment);
			const uniforms: Record<string, WebGLUniformLocation | null> = {};
			for (const name of UNIFORM_NAMES) {
				uniforms[name] = this.gl.getUniformLocation(program, name);
			}

			const compiled: CompiledMode = { program, uniforms };
			this.compiled.set(id, compiled);
			return compiled;
		} catch (error) {
			// A broken shader must not take the page down: report once and keep
			// whatever was already on screen.
			console.error('[pulse] visual mode failed to compile', error);
			return null;
		}
	}
}
