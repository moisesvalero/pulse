/**
 * GLSL sources for the visual modes.
 *
 * All fragment shaders share the same uniform contract, so the renderer can swap
 * modes without touching uniform plumbing:
 *
 *   u_resolution  vec2   drawing buffer size in pixels
 *   u_time        float  seconds since the renderer started
 *   u_bands       vec3   bass / mid / treble energy, each 0..1
 *   u_level       float  overall loudness, 0..1
 *   u_intensity   float  1.0 normally; lower when the user asked for reduced motion
 */

/** Shared header: precision, uniform contract and a value-noise function. */
const COMMON = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_bands;
uniform float u_level;
uniform float u_intensity;

// Palette shared by every mode, mirrored from the CSS custom properties in
// src/app.css so the visuals and the UI cannot drift apart.
const vec3 COLOR_VOID = vec3(0.016, 0.020, 0.039);
const vec3 COLOR_BASS = vec3(0.486, 0.361, 1.000);
const vec3 COLOR_LEAD = vec3(0.133, 0.827, 0.933);
const vec3 COLOR_PAD  = vec3(0.957, 0.447, 0.714);
const vec3 COLOR_HAT  = vec3(0.639, 0.902, 0.212);

// Classic hash-based 3D value noise (Inigo Quilez). Cheap enough to call a
// handful of times per pixel at 60 fps on integrated graphics.
float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);

	return mix(
		mix(mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
		    mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
		mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
		    mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
		f.z);
}

// Two octaves are enough: extra octaves cost real frame time and the visual
// difference disappears once the tunnel is moving.
float fbm(vec3 p) {
	return valueNoise(p) * 0.65 + valueNoise(p * 2.17 + 11.3) * 0.35;
}

// Aspect-correct coordinates centred on the canvas, where y spans about -1..1.
vec2 centredUv() {
	return (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
}

// Vignette. Every mode fades towards the void at the edges so the interface
// stays readable, but it has to leave enough of the frame alive to look
// deliberate rather than unlit.
vec3 vignette(vec3 color, vec2 uv) {
	float fade = smoothstep(2.15, 0.15, length(uv));
	return color * mix(0.38, 1.0, fade);
}
`;

/**
 * Mode: noise tunnel.
 *
 * Radial depth drives the noise coordinate, so the texture streams towards the
 * viewer. Bass widens the tunnel and pushes the camera forward, treble sharpens
 * the grain and tints it.
 */
export const TUNNEL_FRAGMENT = `${COMMON}
void main() {
	vec2 uv = centredUv();
	float radius = length(uv) + 0.0001;
	float angle = atan(uv.y, uv.x);

	// 1/radius turns the screen into a tunnel. Bass opens its mouth, which makes
	// every kick feel like the camera is pushed forward.
	float depth = 1.0 / (radius + 0.10 + u_bands.x * 0.14);

	// Bass also drives the travel speed, so the walls surge on the downbeat.
	float travel = u_time * (0.5 + u_bands.x * 2.6);

	// Sample the noise on (angle, depth) so the texture wraps around the tube.
	vec3 coord = vec3(cos(angle) * 1.7, sin(angle) * 1.7, depth * 1.25 + travel);
	float grain = fbm(coord);

	// Treble mixes in a finer octave: bright hats add sparkle, not brightness.
	float detail = fbm(coord * (3.0 + u_bands.z * 3.0) + travel * 0.5);
	float density = mix(grain, detail, 0.30 + u_bands.z * 0.40);

	// Two tones: a broad haze that is always visible (so the idle screen is not
	// a black rectangle) and sharper filaments riding on the noise ridges.
	float haze = 0.30 + 0.70 * density;
	float filaments = smoothstep(0.40, 0.85, density);

	// Mid band sets the overall energy; the constant keeps silence readable.
	float energy = 0.55 + u_level * 1.3;

	vec3 color = COLOR_VOID;
	color += COLOR_BASS * haze * 0.50 * energy;
	color += COLOR_LEAD * filaments * (0.70 + u_bands.y * 1.6) * energy;
	color += COLOR_PAD * pow(filaments, 2.2) * (0.40 + u_bands.z * 1.7);

	// Deeper parts of the tube cool down towards teal, which separates the walls
	// from the throat instead of leaving one flat wash of violet.
	color = mix(color, color * vec3(0.55, 1.05, 1.35), smoothstep(3.0, 11.0, depth) * 0.65);

	// The throat of the tunnel: dimly lit at rest, flaring on bass hits.
	color += COLOR_HAT * smoothstep(0.16, 0.0, radius) * (0.22 + u_bands.x * 1.6);

	gl_FragColor = vec4(vignette(color, uv), 1.0);
}
`;

/**
 * Vertex stage shared by every mode: emit the quad's clip-space position.
 * Attribute 0 is bound by name in `createProgram`, so no lookup is needed.
 */
export const FULLSCREEN_VERTEX = `
attribute vec2 a_position;

void main() {
	gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Mode: radial waves.
 *
 * Concentric wavefronts travelling outwards. Bass speeds them up and opens the
 * falloff, mid bends the wavefronts so they stop being perfect circles, and
 * treble overlays a fine ripple.
 */
export const RIPPLES_FRAGMENT = `${COMMON}
void main() {
	vec2 uv = centredUv();
	float radius = length(uv);

	// Bass makes the wavefronts travel further and faster.
	float speed = 1.2 + u_bands.x * 3.2;
	float spacing = 9.0 - u_bands.x * 3.0;
	float phase = radius * spacing - u_time * speed;

	// Mid band warps the rings through the noise field, which is what stops the
	// mode from looking like a plain target.
	float warp = valueNoise(vec3(uv * 1.6, u_time * 0.25)) * (0.30 + u_bands.y * 1.25);

	// Sharpen the crests: a sine would read as a soft blur, not as a wavefront.
	float wave = sin(phase + warp * 2.2);
	float crest = pow(max(wave, 0.0), 2.6);

	// Treble rides on top as fine concentric ripples.
	float ripple = 0.5 + 0.5 * sin(radius * 42.0 - u_time * 5.0);
	crest += ripple * u_bands.z * 0.30;

	// Waves fade with distance; a bass hit pushes the fade further out.
	float falloff = exp(-radius * (1.15 - u_bands.x * 0.25));

	vec3 color = COLOR_VOID;
	color += COLOR_LEAD * crest * falloff * (0.55 + u_level * 1.5);
	color += COLOR_BASS * pow(crest, 3.0) * falloff * (0.45 + u_bands.x * 1.6);
	color += COLOR_PAD * u_bands.y * falloff * 0.30;

	// Core flash: the origin of every wave, lit by the kick.
	color += COLOR_HAT * smoothstep(0.22, 0.0, radius) * (0.14 + u_bands.x * 1.2);

	// A dim core so the middle of the field is not a hole next to the other modes,
	// which are all brightest at the centre.
	color += COLOR_HAT * smoothstep(0.26, 0.0, radius) * (0.10 + u_bands.x * 1.0);

	gl_FragColor = vec4(vignette(color, uv), 1.0);
}
`;

/**
 * Mode: particle field.
 *
 * One point per cell of a hash-jittered polar grid, scrolled along the radial
 * axis so the field streams outwards. Three layers at different scales give a
 * sense of depth without any geometry.
 */
export const PARTICLES_FRAGMENT = `${COMMON}
/** Brightness of one layer of stars at a given polar coordinate. */
float starLayer(vec2 polar, float scale, float seed) {
	vec2 p = polar * scale + seed;
	vec2 cell = floor(p);
	vec2 local = fract(p) - 0.5;

	// One point per cell, jittered, so the field never looks like a grid.
	vec2 jitter = vec2(hash13(vec3(cell, seed)), hash13(vec3(cell, seed + 31.0))) - 0.5;
	float radius = length(local - jitter * 0.55);

	float size = 0.035 + hash13(vec3(cell, seed + 7.0)) * 0.075;
	// Per-star twinkle phase: the field shimmers instead of pulsing in unison.
	float twinkle = 0.55 + 0.45 * sin(u_time * (1.5 + hash13(vec3(cell, seed + 3.0)) * 4.0) + seed);

	return smoothstep(size, 0.0, radius) * twinkle;
}

void main() {
	vec2 uv = centredUv();
	float radius = length(uv);
	float angle = atan(uv.y, uv.x);

	// Bass accelerates the outward stream.
	float stream = u_time * (0.35 + u_bands.x * 1.9);
	vec2 polar = vec2(angle * 4.0, radius * 7.0 - stream * 2.2);

	float stars = 0.0;
	stars += starLayer(polar, 1.0, 0.0);
	stars += starLayer(polar, 1.9, 11.0) * 0.7;
	stars += starLayer(polar, 3.3, 23.0) * 0.45;

	// atan() wraps at +-PI, which would show as a seam of shifted stars along the
	// negative X axis. Tapering the field there hides it, and the vignette covers
	// what is left.
	stars *= smoothstep(3.1416, 2.35, abs(angle));

	// Treble makes the points sparkle; mid band sets the depth fade.
	float sparkle = 0.55 + u_bands.z * 1.7;
	float falloff = exp(-radius * (0.95 - u_bands.x * 0.22));

	vec3 color = COLOR_VOID;

	// A slow nebula behind the stars, so the frame is never empty.
	float nebula = fbm(vec3(uv * 1.35, u_time * 0.12));
	color += COLOR_BASS * nebula * (0.30 + u_bands.x * 0.75) * (0.35 + u_level * 1.1);

	color += COLOR_LEAD * stars * sparkle * falloff * (0.85 + u_level * 1.5);
	color += COLOR_PAD * pow(stars, 2.0) * falloff * (0.35 + u_bands.y * 1.4);

	gl_FragColor = vec4(vignette(color, uv), 1.0);
}
`;
