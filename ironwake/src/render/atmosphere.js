// src/render/atmosphere.js — shared atmosphere model + global shader-chunk patches
// (owner: render engineer).
//
// ONE atmosphere model for every material in the game, so fog, sky and particles agree:
//
//  * EXPONENTIAL HEIGHT FOG (two layers: dense ground ash haze + thin high haze) with sun
//    in-scattering (Henyey-Greenstein lobe around the sun) and distance-graded colour
//    (near #6E6660 -> far #8A7A6C) = aerial perspective. The sky-lit part is azimuth-dependent:
//    warm grey in the sun sector, cool slate #4E555C on the storm side (§5 muted blues). Implemented by patching the
//    THREE.ShaderChunk fog chunks, so every built-in material AND every ShaderMaterial with
//    `fog: true` that includes <fog_pars_fragment> gets it automatically.
//    Custom fog code in other lanes keeps working unchanged: inside fog-enabled fragment
//    shaders `fogColor` resolves to the in-scattered colour for the current fragment and
//    `vFogDepth` to an "equivalent exp2 depth", so the stock formula
//    `1 - exp(-fogDensity^2 * vFogDepth^2)` returns the height-fog factor.
//    scene.fog (FogExp2) stays the runtime knob: .density = ground density (1/m),
//    .color = far haze colour (linear).
//
//  * SUN SHADOW CASCADES: directional light #0 = near cascade (dynamic, follows the camera
//    focus), directional light #1 = far cascade (static arena bake, colour 0 — it only lends
//    its shadow map). lights_fragment_begin is patched to light the sun ONCE with a
//    blended two-cascade shadow term (9-tap bilinear PCF each; no noise pattern).
//
// Everything here is constant after boot (baked as #defines) except scene.fog.
import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex); // sRGB hex -> linear working space

/** Art-direction data (AC6_BENCHMARK §5 colour script). */
export const ATMOS = {
  sun: {
    // atan2(x, z) of the direction TOWARDS the sun. The mission is played facing +Z (spawn ->
    // squad -> relays), so a sun 68° to the player's RIGHT and slightly ahead gives raking
    // 3/4 back light in gameplay: long shadows across the yard toward the camera, warm rims,
    // a glowing sun side of every wide frame and a cool storm side (AC6_BENCHMARK §3.3).
    azimuthDeg: -68,
    elevationDeg: 13,      // low dusk sun smothered behind ash
    light: '#FFBE8C',      // key light colour (warm, ash-filtered)
    intensity: 16.0,
    disc: '#D98A4E',       // visible disc / glow colour
  },
  ambient: { sky: '#5C6E84', ground: '#3B3530', intensity: 0.8 }, // cool sky fill + warm bounce
  envIntensity: 1.15,    // IBL (sky dome PMREM): shadow sides read at ~sRGB 45-60, never crushed
  fog: {
    density: 0.0019,       // ground-level extinction (1/m)  -> contrast halves every ~370 m
    falloff: 1 / 60,       // dense layer height falloff (1/m)
    highFrac: 0.3,         // fraction of the density in the thin high layer
    highFalloff: 1 / 900,
    start: 4.0,            // metres of clear air around the camera
    near: '#6E6660',       // near haze (cooler, darker)
    far: '#8A7A6C',        // far haze in the SUN sector (warm grey ash)
    // STORM SIDE: away from the sun azimuth the sky-lit haze is a cool slate grey (§5 colour
    // script: muted blues). The warm grey only survives within ~60 deg of the sun azimuth.
    cool: '#4E555C',
    sector: [-0.25, 0.92], // smoothstep range on cos(azimuth to the sun) for the warm sector
    // the ash storm is THICKER on the storm side (extinction multiplier away from the sun azimuth):
    // the far kit there layers into slate haze instead of standing crisp against a clear horizon
    stormDensity: 1.25,
    // ... and THINNER toward the sun (r4): light breaks through where the deck thins, and the
    // into-sun silhouettes at 100-500 m must layer (dark near, lighter far) instead of washing
    // into the glow within 200 m. Extinction multiplier inside the warm sector.
    sunDensity: 0.58,
    // light leaking under the storm deck: a burnt-orange band along the horizon of the sun
    // sector (silhouettes on the sun side stand against it)
    horizonGlow: '#D98A4E',
    horizonGlowStrength: 1.5,
    horizonGlowSector: [0.35, 1.0], // narrower than the warm sector: the burnt-orange band hugs the sun azimuth
    scatter: '#E0874A',    // hot sun lobe tint
    scatterStrength: 1.4,
    scatterG: 0.8,         // HG anisotropy (forward-scattering ash)
    wash: '#C9906A',       // broad warm wash toward the sun (desaturated)
    washStrength: 0.9,
    ambient: 0.62,         // share of the base haze colour lit by the sky (sun sector)
    sunIso: '#FFBE8C',     // near-isotropic sun scattering in the ash (lit at every angle) ...
    sunIsoStrength: 0.14,  // ... so shadow volumes carve visible shafts (volumetric pass)
    skyHaze: 0.2,          // sky dome haze scale above the horizon band (horizon = fog colour)
    patch: 0.5,            // patchy haze amplitude (0 = uniform)
    farFade: [2600, 3900], // geometry fully dissolves into the sky haze before the far plane
    // SUN IN-SCATTER START DISTANCE (cf. UE 'directional inscattering start distance'): the
    // sun-lit share of the haze only builds up with distance, i.e. each metre of fog along the
    // ray scatters sunlight with weight sunFloor + (1 - sunFloor)(1 - e^{-t/sunStart}). The
    // analytic fog uses the ray average of that weight, the VOLUME pass integrates it per step,
    // so both agree. Fog within ~400 m adds <= ~30 % of the old sun wash: sun-side structures
    // at 100-300 m keep their lit/shadow separation instead of merging into one peach band,
    // while the horizon / sky glow (normalised at 4 km) is unchanged.
    sunStart: 1400,        // (r4: 700 -> 1400, floor 0.12 -> 0.05: sun-side structures at 150-300 m keep their contrast)
    sunFloor: 0.05,
    // SUN TRANSMITTANCE INTO THE GROUND LAYER: the low sun reaches the dense ash layer through a
    // long slant path, so the haze hugging the ground is less sun-lit than the haze aloft
    // (x art scale). Far tower bases sit in a darker ground band instead of a uniform glowing bank.
    sunGroundShadow: 1.6,
    // opacity cap of the height fog below ~2 km: tower bases and the far shore line survive
    // as a faint silhouette instead of dissolving into a uniform bank (sky haze takes over at farFade)
    cap: 0.8,
    capRange: [1700, 2600],
    // WATER (materials that define IW_FOG_WATER, i.e. the sea): the in-scatter over the sea is
    // clamped toward the cool storm haze x water (the warm sun wash would turn the dark sea into
    // beige 'sand dunes'); it blends back to the normal haze toward the horizon (no seam with the sky)
    water: 0.8,
    waterRange: [1000, 3000],
  },
  sky: {
    zenith: '#2B2F36',     // §5: slate zenith
    mid: '#40454C',
    horizon: '#575C61',    // storm side horizon (cool grey)
    horizonSun: '#8E6A52', // sun side horizon under the deck
    glow: '#B0643A',
    glowHot: '#D98A4E',
    ground: '#2A2622',
    bounce: '#4F4A46',     // IBL lower hemisphere: sun-lit yard bounce (only slightly warm)
    cloudDark: '#17191D',
    cloudLit: '#585A5C',   // storm-side deck underside (cool); warmed toward the sun in sky.js
    cloudWarm: '#5E5046',  // sun-side deck underside
  },
};

/** Renderer string when WebGL runs on a CPU rasterizer (SwiftShader, llvmpipe, WARP), else ''. */
export function softwareRendererName(renderer) {
  try {
    const gl = renderer && renderer.getContext();
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) ? name : '';
  } catch (e) { return ''; }
}

/** Unit vector TOWARDS the sun from ATMOS.sun. */
export function sunDirection(out = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(ATMOS.sun.azimuthDeg);
  const el = THREE.MathUtils.degToRad(ATMOS.sun.elevationDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

const f = (x) => (Number.isFinite(x) ? x : 0).toFixed(6);
/** 1 - (1 - e^-x)/x : ray average of (1 - e^{-t/D}) over [0, d], x = d/D. */
function sunRampRaw(x) { return x > 1e-3 ? 1 - (1 - Math.exp(-x)) / x : 0.5 * x; }
const v3 = (v) => `vec3(${f(v.x ?? v.r)}, ${f(v.y ?? v.g)}, ${f(v.z ?? v.b)})`;

/**
 * GLSL shared by the fog chunks, the sky and the weather particles. Needs `cameraPosition`.
 * iwFogOD(cam, pos)        optical depth along the segment (metres, 1/m density)
 * iwFogODRay(cam, dir)     optical depth to infinity (sky)
 * iwFogInscatter(dir, d, base)  haze colour seen along dir at distance d (linear HDR)
 */
export function atmosGLSL() {
  const F = ATMOS.fog;
  const sd = sunDirection();
  const n = C(F.near), fa = C(F.far), co = C(F.cool);
  const ratio = { x: n.r / Math.max(1e-4, fa.r), y: n.g / Math.max(1e-4, fa.g), z: n.b / Math.max(1e-4, fa.b) };
  // storm-side haze as a multiplier of the base (far) colour, so scene.fog.color stays the knob
  const cool = { x: co.r / Math.max(1e-4, fa.r), y: co.g / Math.max(1e-4, fa.g), z: co.b / Math.max(1e-4, fa.b) };
  return /* glsl */`
#ifndef IW_ATMOS
#define IW_ATMOS
#define IW_SUN_DIR ${v3(sd)}
#define IW_FOG_K1 ${f(F.falloff)}
#define IW_FOG_K2 ${f(F.highFalloff)}
#define IW_FOG_HI ${f(F.highFrac)}
#define IW_FOG_START ${f(F.start)}
#define IW_FOG_NEAR_RATIO ${v3(ratio)}
#define IW_FOG_COOL ${v3(cool)}
#define IW_FOG_SECTOR vec2(${f(F.sector[0])}, ${f(F.sector[1])})
#define IW_FOG_FARFADE vec2(${f(F.farFade[0])}, ${f(F.farFade[1])})
#define IW_FOG_HGLOW ${v3(C(F.horizonGlow).multiplyScalar(F.horizonGlowStrength))}
#define IW_FOG_HGSECTOR vec2(${f(F.horizonGlowSector[0])}, ${f(F.horizonGlowSector[1])})
#define IW_FOG_SCATTER ${v3(C(F.scatter).multiplyScalar(F.scatterStrength))}
#define IW_FOG_WASH ${v3(C(F.wash).multiplyScalar(F.washStrength))}
#define IW_FOG_G ${f(F.scatterG)}
#define IW_FOG_AMB ${f(F.ambient)}
#define IW_FOG_ISO ${v3(C(F.sunIso).multiplyScalar(F.sunIsoStrength))}
#define IW_SKY_HAZE ${f(F.skyHaze)}
#define IW_FOG_PATCH ${f(F.patch)}
#define IW_FOG_STORM ${f(F.stormDensity)}
#define IW_FOG_SUNDENS ${f(F.sunDensity)}
#define IW_FOG_SUNK ${f(1 / F.sunStart)}
#define IW_FOG_SUNN ${f(1 / sunRampRaw(4000 / F.sunStart))}
#define IW_FOG_SUNFLOOR ${f(F.sunFloor)}
#define IW_FOG_SUNGT ${f(F.sunGroundShadow * (1 - F.highFrac) / (F.falloff * Math.max(0.05, Math.sin(ATMOS.sun.elevationDeg * Math.PI / 180))))}
#define IW_FOG_CAP vec3(${f(F.cap)}, ${f(F.capRange[0])}, ${f(F.capRange[1])})
#define IW_FOG_WATER_K vec3(${f(F.water)}, ${f(F.waterRange[0])}, ${f(F.waterRange[1])})
float iwExpInt(float k, float dy) {
  float x = k * dy;
  return abs(x) > 1e-3 ? (1.0 - exp(-x)) / x : 1.0 - 0.5 * x;
}
float iwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float iwVNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(iwHash(i), iwHash(i + vec2(1.0, 0.0)), f.x), mix(iwHash(i + vec2(0.0, 1.0)), iwHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Patchy ash haze: density multiplier averaged at 3 points along the view ray (volumetric
// parallax, no surface-locked blotches); fades out with distance so the horizon still matches
// the sky dome's analytic haze.
float iwFogPatch(vec3 cam, vec3 v, float L) {
  float n = 0.0;
  for (int k = 1; k <= 3; k++) {
    vec2 q = cam.xz + v.xz * (float(k) * 0.3);
    n += iwVNoise(q * (1.0 / 150.0)) * 0.65 + iwVNoise(q * (1.0 / 48.0) + 7.3) * 0.35;
  }
  n *= 1.0 / 3.0;
  return 1.0 + IW_FOG_PATCH * (n - 0.5) * 2.0 * (1.0 - smoothstep(500.0, 1500.0, L));
}
// Extinction multiplier of a view direction: IW_FOG_STORM on the storm side, IW_FOG_SUNDENS in
// the sun sector (same azimuth weight as iwSunSector, without its vertical-ray blend).
float iwStormMul(vec3 v) {
  float lh = length(v.xz);
  float az = dot(v.xz, normalize(IW_SUN_DIR.xz)) / max(lh, 1e-4);
  float s = smoothstep(IW_FOG_SECTOR.x, IW_FOG_SECTOR.y, az);
  return mix(IW_FOG_STORM, IW_FOG_SUNDENS, s * s);
}
// Optical depth between the camera and a point; density(y) = d0*((1-h)e^{-k1 y} + h e^{-k2 y}).
float iwFogOD(vec3 cam, vec3 pos, float d0) {
  vec3 v = pos - cam;
  float L = length(v);
  float Ls = max(L - IW_FOG_START, 0.0);
  float h = max(cam.y, -50.0);
  float a1 = (1.0 - IW_FOG_HI) * exp(-IW_FOG_K1 * h) * iwExpInt(IW_FOG_K1, v.y);
  float a2 = IW_FOG_HI * exp(-IW_FOG_K2 * h) * iwExpInt(IW_FOG_K2, v.y);
  return d0 * (a1 + a2) * Ls * iwFogPatch(cam, v, L) * iwStormMul(v);
}
// Optical depth to infinity along a unit direction (sky dome).
float iwFogODRay(vec3 cam, vec3 dir, float d0) {
  float h = max(cam.y, -50.0);
  float dy = max(dir.y, 0.0);
  float L1 = 1.0 / max(IW_FOG_K1 * dy, 1e-4);
  float L2 = 1.0 / max(IW_FOG_K2 * dy, 1e-4);
  return d0 * ((1.0 - IW_FOG_HI) * exp(-IW_FOG_K1 * h) * min(L1, 2.0e5) + IW_FOG_HI * exp(-IW_FOG_K2 * h) * min(L2, 2.0e5));
}
// Ray-average of the sun in-scatter weight over [0, d] (see ATMOS.fog.sunStart); 1 at 4 km.
float iwSunRamp(float d) {
  float x = IW_FOG_SUNK * d;
  float r = x > 1e-3 ? 1.0 - (1.0 - exp(-x)) / x : 0.5 * x;
  return IW_FOG_SUNFLOOR + (1.0 - IW_FOG_SUNFLOOR) * min(r * IW_FOG_SUNN, 1.0);
}
// Per-metre weight at distance t (the VOLUME pass integrates it; its ray average = iwSunRamp).
float iwSunWeight(float t) {
  return IW_FOG_SUNFLOOR + (1.0 - IW_FOG_SUNFLOOR) * min((1.0 - exp(-IW_FOG_SUNK * t)) * IW_FOG_SUNN, 1.0);
}
// Sun transmittance through the dense ground layer down to height y (d0 = ground extinction):
// exp(-d0 (1-h) e^{-k1 y} / (k1 sin(el))) x art scale. ~0.6 at the ground, ~1 above 150 m.
float iwSunT(float y, float d0) {
  return exp(-d0 * IW_FOG_SUNGT * exp(-IW_FOG_K1 * max(y, 0.0)));
}
float iwHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
// Warm-sector weight of a view direction: 1 within ~45 deg of the sun azimuth, 0 beyond ~105
// deg (the storm side). Near-vertical rays (aerial views straight down) take a neutral 0.35.
float iwSunSector(vec3 dir) {
  float lh = length(dir.xz);
  float az = dot(dir.xz, normalize(IW_SUN_DIR.xz)) / max(lh, 1e-4);
  float s = smoothstep(IW_FOG_SECTOR.x, IW_FOG_SECTOR.y, az);
  return mix(0.35, s * s, smoothstep(0.05, 0.4, lh));
}
// The SUN-LIT part of the haze radiance along dir (forward-scattering lobe = hot sun glow in
// the ash + a broad, less saturated warm wash). The volumetric pass (postfx.js) removes it
// where the sun is shadowed along the ray.
vec3 iwFogSunPart(vec3 dir, vec3 base) {
  float mu = dot(dir, IW_SUN_DIR);
  float ph = min(iwHG(mu, IW_FOG_G) * 12.566371, 40.0);
  float wash = pow(max(mu, 0.0), 6.0);
  // near-isotropic term: strong toward the sun, a faint warm veil on the storm side
  float iso = smoothstep(-0.35, 1.0, mu);
  iso = 0.06 + 0.94 * iso * iso;
  return base * (IW_FOG_SCATTER * ph * 0.11 + IW_FOG_WASH * wash + IW_FOG_ISO * iso);
}
// Haze radiance along dir at distance d; base = far haze colour (linear). Ambient (sky-lit)
// part: warm grey in the sun sector, cool slate on the storm side; plus the sun-lit part.
vec3 iwFogInscatter(vec3 dir, float d, vec3 base) {
  float sec = iwSunSector(dir);
  vec3 amb = base * mix(IW_FOG_COOL, vec3(IW_FOG_AMB), sec);
  // horizon glow band around the sun azimuth (grows with distance: it is light from far away)
  float hz = exp(-abs(dir.y) * 9.0);
  float lh = length(dir.xz);
  float hg = smoothstep(IW_FOG_HGSECTOR.x, IW_FOG_HGSECTOR.y, dot(dir.xz, normalize(IW_SUN_DIR.xz)) / max(lh, 1e-4));
  amb += base * IW_FOG_HGLOW * (hg * hg * hz * (1.0 - exp(-d * 0.0012)));
  amb *= mix(IW_FOG_NEAR_RATIO, vec3(1.0), 1.0 - exp(-d * 0.0035));
  return amb + iwFogSunPart(dir, base) * iwSunRamp(d);
}
#endif
`;
}

// ------------------------------------------------------------------ chunk patches
const FOG_PARS_VERTEX = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vIwFogPos;
#endif
`;
const FOG_VERTEX = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vIwFogPos = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif
`;
function fogParsFragment() {
  return /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vIwFogPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	${atmosGLSL()}
	#ifdef FOG_EXP2
		float iwFogFactor() {
			// geometry dissolves completely into the sky haze before the far plane (no horizon step);
			// below ~2 km the height fog is capped so far silhouettes keep a faint ground contact
			float L = length( vIwFogPos - cameraPosition );
			float cap = mix( IW_FOG_CAP.x, 1.0, smoothstep( IW_FOG_CAP.y, IW_FOG_CAP.z, L ) );
			return max( min( 1.0 - exp( - iwFogOD( cameraPosition, vIwFogPos, fogDensity ) ), cap ), smoothstep( IW_FOG_FARFADE.x, IW_FOG_FARFADE.y, L ) );
		}
		vec3 iwFogColorAt() {
			vec3 v = vIwFogPos - cameraPosition;
			float d = length( v );
			vec3 dir = v / max( d, 1e-3 );
			// the sun-lit share is weighted by the sun's transmittance into the layer the ray crosses
			// (its lower end dominates the dense ground layer's in-scatter)
			float yEff = min( cameraPosition.y, vIwFogPos.y ) + 8.0;
			// (faded out toward farFade so the far geometry still meets the sky haze with no horizon step)
			float gs = ( 1.0 - iwSunT( yEff, fogDensity ) ) * ( 1.0 - smoothstep( IW_FOG_FARFADE.x * 0.55, IW_FOG_FARFADE.x, d ) );
			vec3 c = iwFogInscatter( dir, d, fogColor ) - iwFogSunPart( dir, fogColor ) * iwSunRamp( d ) * gs;
			#ifdef IW_FOG_WATER
			// sea: cool slate haze near the pier (no warm sun wash over the water), normal haze at the horizon
			vec3 cw = fogColor * IW_FOG_COOL * IW_FOG_WATER_K.x;
			c = mix( min( c, cw * ( 1.0 + 0.35 * iwSunRamp( d ) ) ), c, smoothstep( IW_FOG_WATER_K.y, IW_FOG_WATER_K.z, d ) );
			#endif
			return c;
		}
		// Equivalent exp2 depth: fogDensity^2 * D^2 == optical depth (see header).
		float iwFogEqDepth() {
			return sqrt( max( - log( max( 1.0 - iwFogFactor(), 1e-6 ) ), 0.0 ) ) / max( fogDensity, 1e-6 );
		}
		#define fogColor iwFogColorAt()
		#define vFogDepth iwFogEqDepth()
	#endif
#endif
`;
}
const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = iwFogFactor();
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

// Sun cascades: see header. 9 bilinear-compare taps on a 3x3 grid (= smooth 4x4 tent).
const SUN_SHADOW_FNS = /* glsl */`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && defined( SHADOWMAP_TYPE_PCF )
float iwPCF9( sampler2DShadow map, vec2 size, float radius, vec3 c ) {
	vec2 t = radius / size;
	float s = 0.0;
	s += texture( map, vec3( c.xy + vec2( -t.x, -t.y ), c.z ) );
	s += texture( map, vec3( c.xy + vec2( 0.0, -t.y ), c.z ) );
	s += texture( map, vec3( c.xy + vec2( t.x, -t.y ), c.z ) );
	s += texture( map, vec3( c.xy + vec2( -t.x, 0.0 ), c.z ) );
	s += texture( map, vec3( c.xy, c.z ) ) * 2.0;
	s += texture( map, vec3( c.xy + vec2( t.x, 0.0 ), c.z ) );
	s += texture( map, vec3( c.xy + vec2( -t.x, t.y ), c.z ) );
	s += texture( map, vec3( c.xy + vec2( 0.0, t.y ), c.z ) );
	s += texture( map, vec3( c.xy + vec2( t.x, t.y ), c.z ) );
	return s * 0.1;
}
float iwSunShadow() {
	DirectionalLightShadow s0 = directionalLightShadows[ 0 ];
	DirectionalLightShadow s1 = directionalLightShadows[ 1 ];
	vec3 p0 = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
	vec3 p1 = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
	p0.z += s0.shadowBias;
	p1.z += s1.shadowBias;
	vec2 e0 = abs( p0.xy - 0.5 ) * 2.0;
	float wFar = smoothstep( 0.80, 0.96, max( e0.x, e0.y ) );
	if ( p0.z > 1.0 || p0.z < 0.0 ) wFar = 1.0;
	float sh = 1.0;
	if ( wFar < 1.0 ) sh = iwPCF9( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowRadius, p0 );
	if ( wFar > 0.0 ) {
		vec2 e1 = abs( p1.xy - 0.5 ) * 2.0;
		float out1 = smoothstep( 0.90, 0.995, max( e1.x, e1.y ) );
		if ( p1.z > 1.0 || p1.z < 0.0 ) out1 = 1.0;
		float far = out1 < 1.0 ? iwPCF9( directionalShadowMap[ 1 ], s1.shadowMapSize, s1.shadowRadius, p1 ) : 1.0;
		far = mix( far, 1.0, out1 );
		sh = mix( sh, far, wFar );
	}
	return mix( 1.0, sh, s0.shadowIntensity );
}
#endif
`;

const DIR_BLOCK_STOCK = `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif`;

const DIR_BLOCK_IW = `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && defined( SHADOWMAP_TYPE_PCF )
		// IRONWAKE: lights 0+1 are the two sun cascades -> one light, blended shadow.
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= ( directLight.visible && receiveShadow ) ? iwSunShadow() : 1.0;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
			#if ( UNROLLED_LOOP_INDEX >= 2 )
			directionalLight = directionalLights[ i ];
			getDirectionalLightInfo( directionalLight, directLight );
			#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			directionalLightShadow = directionalLightShadows[ i ];
			directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			#endif
			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
			#endif
		}
		#pragma unroll_loop_end
	#else
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
	#endif
#endif`;

let installed = null;
/**
 * Patch THREE.ShaderChunk once (before any material compiles). Returns
 * { fog: bool, cascades: bool } telling which patches applied.
 */
export function installAtmosphereChunks() {
  if (installed) return installed;
  const SC = THREE.ShaderChunk;
  SC.fog_pars_vertex = FOG_PARS_VERTEX;
  SC.fog_vertex = FOG_VERTEX;
  SC.fog_pars_fragment = fogParsFragment();
  SC.fog_fragment = FOG_FRAGMENT;
  let cascades = false;
  if (SC.lights_fragment_begin.includes(DIR_BLOCK_STOCK)) {
    SC.lights_fragment_begin = SC.lights_fragment_begin.replace(DIR_BLOCK_STOCK, DIR_BLOCK_IW);
    SC.shadowmap_pars_fragment = SC.shadowmap_pars_fragment + '\n' + SUN_SHADOW_FNS;
    cascades = true;
  } else {
    console.warn('[atmosphere] lights_fragment_begin changed upstream; sun cascades disabled (single shadow map).');
  }
  installed = { fog: true, cascades };
  return installed;
}
