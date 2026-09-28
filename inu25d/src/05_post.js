// 05_post.js — やわらかい光のにじみ（ブルーム）と色の仕上げ。three の中核だけで組む（addons は使わない）。
// シーンを HDR（半精度）の描画先へ描き、明るい所だけを縮小してぼかし、合成時に ACES トーンマップ・sRGB・
// ほんのりビネットを掛ける。品質 tier 2 と、WebGL2 でない端末では使わない（素の描画に戻る）。
(function(){ 'use strict';
const G = window.G; const THREE = window.THREE;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BRIGHT = `
  uniform sampler2D tSrc; uniform float uThresh; uniform vec2 uTexel; varying vec2 vUv;
  void main(){
    // 4-tap box downsample, then soft threshold on luminance
    vec3 c = texture2D(tSrc, vUv + uTexel*vec2(-1.0,-1.0)).rgb + texture2D(tSrc, vUv + uTexel*vec2(1.0,-1.0)).rgb
           + texture2D(tSrc, vUv + uTexel*vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel*vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = smoothstep(uThresh, uThresh + 0.6, l);
    gl_FragColor = vec4(c * k, 1.0);
  }`;
const BLUR = `
  uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
  void main(){
    vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
    s += texture2D(tSrc, vUv + uDir*1.3846).rgb * 0.316216; s += texture2D(tSrc, vUv - uDir*1.3846).rgb * 0.316216;
    s += texture2D(tSrc, vUv + uDir*3.2308).rgb * 0.070270; s += texture2D(tSrc, vUv - uDir*3.2308).rgb * 0.070270;
    gl_FragColor = vec4(s, 1.0);
  }`;
const COMP = `
  uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBloom2; uniform float uBloom; uniform float uExposure;
  uniform float uSat; uniform float uVig; uniform vec3 uLift; varying vec2 vUv;
  vec3 aces(vec3 x){ // same fit three.js uses for ACESFilmicToneMapping
    const mat3 ACESInputMat = mat3( vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777) );
    const mat3 ACESOutputMat = mat3( vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602) );
    x *= uExposure / 0.6; x = ACESInputMat * x;
    vec3 a = x * (x + 0.0245786) - 0.000090537; vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081; x = a / b;
    x = ACESOutputMat * x; return clamp(x, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  void main(){
    vec3 c = texture2D(tScene, vUv).rgb;
    c += (texture2D(tBloom, vUv).rgb * 0.6 + texture2D(tBloom2, vUv).rgb * 0.4) * uBloom;
    c = aces(c);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c += uLift * (1.0 - c);
    vec2 d = vUv - 0.5; c *= 1.0 - uVig * dot(d, d) * 1.6;
    gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
  }`;

let rtScene=null, rtA=null, rtB=null, rtC=null, rtD=null, quad=null, qScene=null, qCam=null;
let mBright=null, mBlur=null, mComp=null, w=0, h=0;

function supported(){ const r = G.renderer; return r && r.capabilities && r.capabilities.isWebGL2; }
function make(){
  const r = G.renderer;
  const opts = { type: THREE.HalfFloatType, depthBuffer:true, stencilBuffer:false };
  rtScene = new THREE.WebGLRenderTarget(4, 4, Object.assign({ samples: G.quality.tier===0 ? 4 : 2 }, opts));
  const small = { type: THREE.HalfFloatType, depthBuffer:false, stencilBuffer:false };
  rtA = new THREE.WebGLRenderTarget(4, 4, small); rtB = new THREE.WebGLRenderTarget(4, 4, small);
  rtC = new THREE.WebGLRenderTarget(4, 4, small); rtD = new THREE.WebGLRenderTarget(4, 4, small);
  mBright = new THREE.ShaderMaterial({ vertexShader:VERT, fragmentShader:BRIGHT, depthTest:false, depthWrite:false,
    uniforms:{ tSrc:{value:null}, uThresh:{value:1.0}, uTexel:{value:new THREE.Vector2()} } });
  mBlur = new THREE.ShaderMaterial({ vertexShader:VERT, fragmentShader:BLUR, depthTest:false, depthWrite:false,
    uniforms:{ tSrc:{value:null}, uDir:{value:new THREE.Vector2()} } });
  mComp = new THREE.ShaderMaterial({ vertexShader:VERT, fragmentShader:COMP, depthTest:false, depthWrite:false,
    uniforms:{ tScene:{value:null}, tBloom:{value:null}, tBloom2:{value:null}, uBloom:{value:0.55}, uExposure:{value:1.08},
      uSat:{value:1.08}, uVig:{value:0.28}, uLift:{value:new THREE.Color(0.012,0.008,0.02)} } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 2,0, 0,2]), 2));
  quad = new THREE.Mesh(g, mComp); quad.frustumCulled = false;
  qScene = new THREE.Scene(); qScene.add(quad);
  qCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
}
function size(){
  const r = G.renderer; const v = new THREE.Vector2(); r.getDrawingBufferSize(v);
  if(v.x===w && v.y===h) return; w = v.x; h = v.y;
  rtScene.setSize(w, h);
  const hw = Math.max(1, w>>2), hh = Math.max(1, h>>2);
  rtA.setSize(hw, hh); rtB.setSize(hw, hh);
  rtC.setSize(Math.max(1, hw>>1), Math.max(1, hh>>1)); rtD.setSize(Math.max(1, hw>>1), Math.max(1, hh>>1));
}
function pass(mat, target){ quad.material = mat; G.renderer.setRenderTarget(target); G.renderer.render(qScene, qCam); }

G.post = {
  enabled: false,          // turned on by the game after integration checks
  get active(){ return this.enabled && G.quality.tier < 2 && supported(); },
  settings(o){ if(!mComp) return; const u = mComp.uniforms;
    if(o.bloom!=null) u.uBloom.value = o.bloom; if(o.exposure!=null) u.uExposure.value = o.exposure;
    if(o.sat!=null) u.uSat.value = o.sat; if(o.vig!=null) u.uVig.value = o.vig; if(o.thresh!=null) mBright.uniforms.uThresh.value = o.thresh; },
  // replaces renderer.render(scene, camera) when active
  render(scene, camera){
    const r = G.renderer;
    if(!rtScene) make();
    size();
    const tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;          // we tone-map in the composite
    r.setRenderTarget(rtScene); r.clear(); r.render(scene, camera);
    mBright.uniforms.tSrc.value = rtScene.texture; mBright.uniforms.uTexel.value.set(1/w, 1/h);
    pass(mBright, rtA);
    mBlur.uniforms.tSrc.value = rtA.texture; mBlur.uniforms.uDir.value.set(1/rtA.width, 0); pass(mBlur, rtB);
    mBlur.uniforms.tSrc.value = rtB.texture; mBlur.uniforms.uDir.value.set(0, 1/rtA.height); pass(mBlur, rtA);
    mBlur.uniforms.tSrc.value = rtA.texture; mBlur.uniforms.uDir.value.set(1/rtC.width, 0); pass(mBlur, rtC);
    mBlur.uniforms.tSrc.value = rtC.texture; mBlur.uniforms.uDir.value.set(0, 1/rtC.height); pass(mBlur, rtD);
    mComp.uniforms.tScene.value = rtScene.texture; mComp.uniforms.tBloom.value = rtA.texture; mComp.uniforms.tBloom2.value = rtD.texture;
    mComp.uniforms.uExposure.value = r.toneMappingExposure;
    pass(mComp, null);
    r.toneMapping = tm;
  },
  dispose(){ for(const t of [rtScene, rtA, rtB, rtC, rtD]) if(t) t.dispose(); rtScene = null; w = h = 0; },
};
G.bus.on('quality', ()=>{ if(G.post && G.quality.tier>=2) G.post.dispose(); });
})();
