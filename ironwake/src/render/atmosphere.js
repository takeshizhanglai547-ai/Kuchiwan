// src/render/atmosphere.js — shared atmosphere model + global shader-chunk patches
// (owner: render engineer).
//
// ONE atmosphere model for every material in the game, so fog, sky and particles agree:
//
//  * EXPONENTIAL HEIGHT FOG (two layers: dense ground ash haze + thin high haze) with sun
//    in-scattering (Henyey-Greenstein lobe around the sun) and distance-graded colour
//    (near #6E6660 -> far #8A7A6C) = aerial perspective. Implemented by patching the
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
    azimuthDeg: -150,      // atan2(x, z) of the direction TOWARDS the sun (behind the spawn, title backlight)
    elevationDeg: 17,      // low dusk sun smothered behind ash
    light: '#FFC39A',      // key light colour (warm, ash-filtered)
    intensity: 8.0,
    disc: '#D98A4E',       // visible disc / glow colour
  },
  ambient: { sky: '#6D7F95', ground: '#3B332C', intensity: 0.6 }, // cool sky fill + warm bounce
  envIntensity: 0.7,
  fog: {
    density: 0.0022,       // ground-level extinction (1/m)  -> contrast halves every ~320 m
    falloff: 1 / 60,       // dense layer height falloff (1/m)
    highFrac: 0.3,         // fraction of the density in the thin high layer
    highFalloff: 1 / 900,
    start: 4.0,            // metres of clear air around the camera
    near: '#6E6660',       // near haze (cooler, darker)
    far: '#8A7A6C',        // far haze (warm grey ash)
    anti: [0.74, 0.84, 1.0], // linear multiplier looking away from the sun (cool)
    scatter: '#E0874A',    // hot sun lobe tint
    scatterStrength: 1.6,
    scatterG: 0.82,        // HG anisotropy (forward-scattering ash)
    wash: '#C9A07E',       // broad warm wash toward the sun (desaturated)
    washStrength: 0.9,
    skyHaze: 0.3,          // sky dome haze scale (horizon still converges to the fog colour)
    patch: 0.5,            // patchy haze amplitude (0 = uniform)
  },
  sky: {
    zenith: '#2B2F36',
    mid: '#5A5550',
    horizon: '#6E6660',
    glow: '#B0643A',
    glowHot: '#D98A4E',
    ground: '#2A2622',
    cloudDark: '#1E1C1B',
    cloudLit: '#7A6E64',
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
  const n = C(F.near), fa = C(F.far);
  const ratio = { x: n.r / Math.max(1e-4, fa.r), y: n.g / Math.max(1e-4, fa.g), z: n.b / Math.max(1e-4, fa.b) };
  return /* glsl */`
#ifndef IW_ATMOS
#define IW_ATMOS
#define IW_SUN_DIR ${v3(sd)}
#define IW_FOG_K1 ${f(F.falloff)}
#define IW_FOG_K2 ${f(F.highFalloff)}
#define IW_FOG_HI ${f(F.highFrac)}
#define IW_FOG_START ${f(F.start)}
#define IW_FOG_NEAR_RATIO ${v3(ratio)}
#define IW_FOG_ANTI ${v3({ x: F.anti[0], y: F.anti[1], z: F.anti[2] })}
#define IW_FOG_SCATTER ${v3(C(F.scatter).multiplyScalar(F.scatterStrength))}
#define IW_FOG_WASH ${v3(C(F.wash).multiplyScalar(F.washStrength))}
#define IW_FOG_G ${f(F.scatterG)}
#define IW_SKY_HAZE ${f(F.skyHaze)}
#define IW_FOG_PATCH ${f(F.patch)}
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
// Optical depth between the camera and a point; density(y) = d0*((1-h)e^{-k1 y} + h e^{-k2 y}).
float iwFogOD(vec3 cam, vec3 pos, float d0) {
  vec3 v = pos - cam;
  float L = length(v);
  float Ls = max(L - IW_FOG_START, 0.0);
  float h = max(cam.y, -50.0);
  float a1 = (1.0 - IW_FOG_HI) * exp(-IW_FOG_K1 * h) * iwExpInt(IW_FOG_K1, v.y);
  float a2 = IW_FOG_HI * exp(-IW_FOG_K2 * h) * iwExpInt(IW_FOG_K2, v.y);
  return d0 * (a1 + a2) * Ls * iwFogPatch(cam, v, L);
}
// Optical depth to infinity along a unit direction (sky dome).
float iwFogODRay(vec3 cam, vec3 dir, float d0) {
  float h = max(cam.y, -50.0);
  float dy = max(dir.y, 0.0);
  float L1 = 1.0 / max(IW_FOG_K1 * dy, 1e-4);
  float L2 = 1.0 / max(IW_FOG_K2 * dy, 1e-4);
  return d0 * ((1.0 - IW_FOG_HI) * exp(-IW_FOG_K1 * h) * min(L1, 2.0e5) + IW_FOG_HI * exp(-IW_FOG_K2 * h) * min(L2, 2.0e5));
}
float iwHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
// Haze radiance along dir at distance d; base = far haze colour (linear).
vec3 iwFogInscatter(vec3 dir, float d, vec3 base) {
  float mu = dot(dir, IW_SUN_DIR);
  vec3 c = base * mix(IW_FOG_NEAR_RATIO, vec3(1.0), 1.0 - exp(-d * 0.0035));
  c *= mix(IW_FOG_ANTI, vec3(1.0), smoothstep(-0.6, 0.7, mu));
  // forward-scattering lobe (hot sun glow in the ash) + a broad, less saturated warm wash
  float ph = min(iwHG(mu, IW_FOG_G) * 12.566371, 40.0);
  float wash = pow(max(mu, 0.0), 3.0);
  c += base * (IW_FOG_SCATTER * ph * 0.11 + IW_FOG_WASH * wash);
  return c;
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
			return 1.0 - exp( - iwFogOD( cameraPosition, vIwFogPos, fogDensity ) );
		}
		vec3 iwFogColorAt() {
			vec3 v = vIwFogPos - cameraPosition;
			float d = length( v );
			return iwFogInscatter( v / max( d, 1e-3 ), d, fogColor );
		}
		// Equivalent exp2 depth: fogDensity^2 * D^2 == optical depth (see header).
		float iwFogEqDepth() {
			return sqrt( max( iwFogOD( cameraPosition, vIwFogPos, fogDensity ), 0.0 ) ) / max( fogDensity, 1e-6 );
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
