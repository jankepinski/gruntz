import * as THREE from 'three';

/**
 * "Clay" material: a matte standard material with a subtle procedural surface detail
 * (thumb-print like undulations) computed in world space, so every model looks hand
 * sculpted from the same clay without needing unique textures.
 */
export function clayMaterial(
  color: number,
  opts: { rough?: number; metal?: number; detail?: number } = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.88,
    metalness: opts.metal ?? 0,
  });
  return applyClay(material, opts.detail ?? 1);
}

/** Colour of the soft rim light every clay surface picks up (set per world by the renderer). */
export const clayRim = { value: new THREE.Color(0xe4ecff) };

/**
 * Add the clay surface detail to an existing standard material (e.g. from a GLB). rim is the
 * strength of a soft fresnel rim light, a touch of subsurface glow that makes models pop.
 */
export function applyClay<M extends THREE.MeshStandardMaterial>(material: M, detail = 1, rim = 0.3): M {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
  material.onBeforeCompile = shader => {
    shader.uniforms.uClayDetail = { value: detail };
    shader.uniforms.uClayRim = clayRim;
    shader.uniforms.uClayRimAmount = { value: rim };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vClayWorld;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 clayWp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          clayWp = instanceMatrix * clayWp;
        #endif
        vClayWorld = ( modelMatrix * clayWp ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vClayWorld;
        uniform float uClayDetail;
        uniform vec3 uClayRim;
        uniform float uClayRimAmount;
        float clayHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
        float clayNoise( vec3 x ) {
          vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( clayHash( i ), clayHash( i + vec3( 1, 0, 0 ) ), f.x ),
                           mix( clayHash( i + vec3( 0, 1, 0 ) ), clayHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( clayHash( i + vec3( 0, 0, 1 ) ), clayHash( i + vec3( 1, 0, 1 ) ), f.x ),
                           mix( clayHash( i + vec3( 0, 1, 1 ) ), clayHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 p = vClayWorld * 9.0;
          float e = 0.08;
          float n0 = clayNoise( p ) + 0.5 * clayNoise( p * 2.3 );
          vec3 g = vec3( clayNoise( p + vec3( e, 0, 0 ) ) + 0.5 * clayNoise( ( p + vec3( e, 0, 0 ) ) * 2.3 ) - n0,
                         clayNoise( p + vec3( 0, e, 0 ) ) + 0.5 * clayNoise( ( p + vec3( 0, e, 0 ) ) * 2.3 ) - n0,
                         clayNoise( p + vec3( 0, 0, e ) ) + 0.5 * clayNoise( ( p + vec3( 0, 0, e ) ) * 2.3 ) - n0 ) / e;
          vec3 gv = ( viewMatrix * vec4( g, 0.0 ) ).xyz;
          normal = normalize( normal - gv * 0.035 * uClayDetail );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 0.94 + 0.12 * clayNoise( vClayWorld * 3.1 );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float ndv = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
          totalEmissiveRadiance += uClayRim * diffuseColor.rgb * pow( 1.0 - ndv, 3.0 ) * uClayRimAmount;
        }`,
      );
  };
  material.customProgramCacheKey = () => `clay-${detail}-${rim}`;
  material.needsUpdate = true;
  return material;
}

/**
 * A seamless, smooth noise texture (fractal value noise with smooth interpolation,
 * computed once on the CPU). Sampling a filtered texture can never show the hard
 * edges that thresholded shader noise produces.
 */
let noiseTexture: THREE.DataTexture | null = null;
function groundNoise(): THREE.DataTexture {
  if (noiseTexture) return noiseTexture;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  // Random lattices for a few octaves, each tiling over the whole texture.
  let seed = 1234567;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const octave = (cells: number) => {
    const grid = new Float32Array(cells * cells).map(() => rand());
    return (u: number, v: number) => {
      const x = u * cells;
      const y = v * cells;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) =>
        grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  // Channels: R big patches, G medium detail, B a separate field for dirt spots.
  const r1 = octave(4),
    r2 = octave(9),
    r3 = octave(19);
  const b1 = octave(5),
    b2 = octave(11);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = Math.round((r1(u, v) * 0.6 + r2(u, v) * 0.3 + r3(u, v) * 0.1) * 255);
      data[i + 1] = Math.round(r3(u + 0.37, v + 0.61) * 255);
      data[i + 2] = Math.round((b1(u, v) * 0.7 + b2(u, v) * 0.3) * 255);
      data[i + 3] = 255;
    }
  }
  noiseTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTexture.generateMipmaps = true;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

/** Surface pattern painted into the ground of a world. */
export type GroundPattern = 'grass' | 'sand' | 'snow' | 'icing' | 'felt' | 'wood' | 'moon';
const PATTERN_ID: Record<GroundPattern, number> = { grass: 0, sand: 1, snow: 2, icing: 3, felt: 4, wood: 5, moon: 6 };

/**
 * Velvet grass, baked once: a tileable height map of little leaf rosettes (period VELVET_PERIOD
 * tiles). R = height of the topmost leaf surface (0..1 of the grass height), G = how far along
 * that leaf we are (0 root .. 1 tip, for the colour ramp), B = a random number per leaf.
 * Each rosette has a few leaves growing out of one root, rising and opening outwards.
 */
const VELVET_PERIOD = 4;
let velvetTex: THREE.DataTexture | null = null;
function velvetTexture(): THREE.DataTexture {
  if (velvetTex) return velvetTex;
  const size = 256;
  const top = new Float32Array(size * size);
  const along = new Float32Array(size * size);
  const ids = new Float32Array(size * size);
  const hash = (x: number, y: number, s: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const layers = [
    { dens: 3, gap: 0.4, tall: 1, leaves: 3, seed: 1 },
    { dens: 5, gap: 0.58, tall: 0.6, leaves: 2, seed: 2 },
  ];
  for (const layer of layers) {
    const n = layer.dens * VELVET_PERIOD;
    const texPerCell = size / n;
    for (let cy = 0; cy < n; cy++)
      for (let cx = 0; cx < n; cx++) {
        const r = (k: number) => hash(cx, cy, layer.seed * 97 + k);
        if (r(0) < layer.gap) continue;
        const rootX = 0.5 + (r(1) - 0.5) * 0.4;
        const rootY = 0.5 + (r(2) - 0.5) * 0.4;
        const h = (0.55 + 0.45 * r(3)) * layer.tall;
        const turn = r(4) * Math.PI * 2;
        for (let k = 0; k < layer.leaves; k++) {
          const ang = turn + (k * Math.PI * 2) / layer.leaves + (r(5 + k) - 0.5) * 0.8;
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          const id = r(10 + k);
          // rasterise the leaf's cross-sections from the root up, keeping the highest
          for (let step = 0; step <= 16; step++) {
            const rel = step / 16;
            const L = rel * h;
            const len = 0.27 * (1 - rel * 0.8);
            const wid = len * 0.45;
            const ccx = cx + rootX + dx * (0.05 + 0.3 * rel);
            const ccy = cy + rootY + dy * (0.05 + 0.3 * rel);
            const x0 = Math.floor((ccx - len) * texPerCell);
            const x1 = Math.ceil((ccx + len) * texPerCell);
            const y0 = Math.floor((ccy - len) * texPerCell);
            const y1 = Math.ceil((ccy + len) * texPerCell);
            for (let ty = y0; ty <= y1; ty++)
              for (let tx = x0; tx <= x1; tx++) {
                const px = (tx + 0.5) / texPerCell - ccx;
                const py = (ty + 0.5) / texPerCell - ccy;
                const ea = (px * dx + py * dy) / len;
                const eb = (-px * dy + py * dx) / wid;
                if (ea * ea + eb * eb > 1) continue;
                const i = (((ty % size) + size) % size) * size + (((tx % size) + size) % size);
                if (L > top[i]!) {
                  top[i] = L;
                  along[i] = rel;
                  ids[i] = id;
                }
              }
          }
        }
      }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(top[i]! * 255);
    data[i * 4 + 1] = Math.round(along[i]! * 255);
    data[i * 4 + 2] = Math.round(ids[i]! * 255);
    data[i * 4 + 3] = 255;
  }
  velvetTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  velvetTex.wrapS = velvetTex.wrapT = THREE.RepeatWrapping;
  velvetTex.magFilter = THREE.LinearFilter;
  velvetTex.minFilter = THREE.LinearMipmapLinearFilter;
  velvetTex.generateMipmaps = true;
  velvetTex.needsUpdate = true;
  return velvetTex;
}

/**
 * Ground: large soft patches of two tones plus bare-earth patches (all in world space, so
 * tiles blend seamlessly), fine speckled texture up close, and a surface pattern that
 * belongs to the world: wind ripples in sand, sparkling snow, sprinkles on icing, craters...
 */
export function groundMaterial(
  a: number,
  b: number,
  dirt: number,
  pattern: GroundPattern = 'grass',
  velvet = false,
): THREE.MeshStandardMaterial & { userData: { time: { value: number } } } {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
  }) as THREE.MeshStandardMaterial & { userData: { time: { value: number } } };
  applyClay(material, 0.6, 0);
  const clay = material.onBeforeCompile;
  const noise = groundNoise();
  const time = { value: 0 };
  material.userData.time = time;
  material.onBeforeCompile = (shader, renderer) => {
    clay(shader, renderer);
    shader.uniforms.uGroundA = { value: new THREE.Color(a) };
    shader.uniforms.uGroundB = { value: new THREE.Color(b) };
    shader.uniforms.uGroundDirt = { value: new THREE.Color(dirt) };
    shader.uniforms.uGroundNoise = { value: noise };
    shader.uniforms.uTime = time;
    if (velvet) shader.uniforms.uVelvet = { value: velvetTexture() };
    shader.defines = {
      ...shader.defines,
      GROUND_PATTERN: PATTERN_ID[pattern],
      ...(velvet ? { VELVET: 1, VELVET_PERIOD: `${VELVET_PERIOD}.0` } : {}),
    };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'uniform float uClayDetail;',
        `uniform float uClayDetail;
        uniform vec3 uGroundA;
        uniform vec3 uGroundB;
        uniform vec3 uGroundDirt;
        uniform sampler2D uGroundNoise;
        uniform float uTime;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        #ifdef VELVET
        uniform sampler2D uVelvet;
        #endif
        vec2 gHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float groundBump = 0.0;
        {
          vec2 w = vClayWorld.xz;
          // One texture period covers 48 tiles; a rotated second lookup hides the repeat.
          vec2 p = w / 48.0;
          vec4 n1 = texture2D(uGroundNoise, p);
          vec4 n2 = texture2D(uGroundNoise, mat2(0.8, -0.6, 0.6, 0.8) * p * 1.7 + 0.31);
          float n = n1.r * 0.7 + n2.r * 0.3;
          vec3 g = mix(uGroundA, uGroundB, smoothstep(0.34, 0.7, n));
          // broad lighter / darker swathes
          float big = texture2D(uGroundNoise, w / 110.0 + 0.5).r;
          g *= 0.88 + 0.24 * big;
          float d = smoothstep(0.6, 0.78, n1.b * 0.75 + n2.g * 0.25);
          g = mix(g, uGroundDirt, d * 0.7);
          // fine speckle up close
          float fine = texture2D(uGroundNoise, w * 0.31).g;
          float soft = texture2D(uGroundNoise, w * 0.7 + 0.2).g;
          g *= 0.9 + 0.12 * fine + 0.05 * soft;
          #if GROUND_PATTERN == 0
            // grass: soft painted strokes and clover-dark clumps
            float strokes = texture2D(uGroundNoise, mat2(0.8, -0.6, 0.6, 0.8) * vec2(w.x * 1.1, w.y * 0.45)).g;
            g *= 0.93 + 0.12 * strokes;
            g = mix(g, g * vec3(0.78, 0.9, 0.72), smoothstep(0.62, 0.8, texture2D(uGroundNoise, w * 0.12 + 3.1).b) * 0.6);
          #elif GROUND_PATTERN == 1
            // sand: wind ripples bending around, darker in the troughs
            float warp = texture2D(uGroundNoise, w * 0.05).r * 7.0;
            float ripple = sin(dot(w, vec2(0.86, 0.5)) * 7.5 + warp);
            g *= 0.95 + 0.06 * ripple;
            groundBump = ripple;
            // scattered grit
            vec2 cell = floor(w * 9.0);
            float grit = step(0.93, gHash(cell)) * step(length(fract(w * 9.0) - 0.5), 0.18);
            g *= 1.0 - grit * 0.35;
          #elif GROUND_PATTERN == 2
            // snow: soft drifts, blue in the hollows
            float drift = texture2D(uGroundNoise, w * 0.08 + 1.7).r;
            g = mix(g * vec3(0.84, 0.9, 1.0), g, smoothstep(0.3, 0.7, drift));
            groundBump = drift * 2.0 - 1.0;
          #elif GROUND_PATTERN == 3
            // icing with sprinkles
            vec2 cw = w * 5.0;
            vec2 cell = floor(cw);
            vec2 h = gHash2(cell);
            if (h.x < 0.16) {
              vec2 f = fract(cw) - 0.5;
              float ang = h.y * 6.2831;
              vec2 dir = vec2(cos(ang), sin(ang));
              float along = clamp(dot(f, dir), -0.18, 0.18);
              float dist = length(f - dir * along);
              float k = 1.0 - smoothstep(0.05, 0.075, dist);
              vec3 sprinkle = h.x < 0.04 ? vec3(1.0, 0.95, 0.4) : h.x < 0.08 ? vec3(0.45, 0.8, 1.0) : h.x < 0.12 ? vec3(1.0, 1.0, 1.0) : vec3(0.55, 0.95, 0.5);
              g = mix(g, sprinkle, k);
            }
          #elif GROUND_PATTERN == 4
            // felt: fine fibres
            float fib = texture2D(uGroundNoise, w * 3.1).g * texture2D(uGroundNoise, w * 2.3 + 0.7).g;
            g *= 0.92 + 0.2 * fib;
          #elif GROUND_PATTERN == 5
            // wood: long grain with rings
            float grain = sin(w.x * 1.7 + texture2D(uGroundNoise, vec2(w.x * 0.05, w.y * 0.6)).r * 9.0);
            g *= 0.93 + 0.07 * grain;
            g *= 0.96 + 0.06 * texture2D(uGroundNoise, vec2(w.x * 0.2, w.y * 3.0)).g;
          #elif GROUND_PATTERN == 6
            // moon dust with craters
            vec2 cw = w * 0.45;
            vec2 cell = floor(cw);
            float crater = 0.0;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
              vec2 c = cell + vec2(float(x), float(y));
              vec2 h = gHash2(c);
              if (h.x > 0.55) continue;
              vec2 centre = c + 0.2 + 0.6 * gHash2(c + 9.0);
              float r = 0.18 + 0.3 * h.y;
              float dd = length(cw - centre) / r;
              crater += (1.0 - smoothstep(0.7, 1.0, dd)) * -0.22 + smoothstep(0.75, 0.95, dd) * (1.0 - smoothstep(0.95, 1.25, dd)) * 0.18;
            }
            g *= 1.0 + crater;
            groundBump = crater * 3.0;
          #endif
          #ifdef VELVET
          {
            // One pass over a baked height map instead of stacked shells: walk down the view
            // ray through the grass layer, stop at the first leaf, light the pixel once.
            vec3 nW = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            float upward = smoothstep(0.75, 0.95, nW.y);
            float bareV = smoothstep(0.55, 0.72, n1.b * 0.75 + n2.g * 0.25);
            if (upward > 0.0 && bareV < 0.98) {
              vec3 V = normalize(cameraPosition - vClayWorld);
              float grow = (0.55 + 0.5 * smoothstep(0.25, 0.75, texture2D(uGroundNoise, w / 9.0 + 0.17).g)) * (1.0 - bareV);
              vec2 wind = normalize(vec2(0.8, 0.45));
              float gust = 0.5 + 0.5 * sin(dot(w, wind) * 0.55 - uTime * 1.4);
              vec2 toSun = vec2(-0.6, 0.45);
              // contact shade: a blurred (lower mip) look at the leaves around this spot
              float crowd = smoothstep(0.04, 0.35, texture2D(uVelvet, w / VELVET_PERIOD, 2.5).r * grow);
              bool hit = false;
              for (int i = 0; i < 8; i++) {
                float L = 1.0 - float(i) / 7.0;
                vec2 pw = w + V.xz * (L * 0.1 / max(V.y, 0.25)) - wind * (0.02 + 0.05 * gust) * L * L;
                vec4 t = texture2D(uVelvet, pw / VELVET_PERIOD);
                float h = t.r * grow;
                if (h > 0.03 && h >= L - 0.07) {
                  float rel = t.g;
                  // a taller leaf between us and the sun shades this one
                  float over = texture2D(uVelvet, (pw + toSun * 0.05) / VELVET_PERIOD).r * grow;
                  float shade = mix(0.6, 1.22, rel) * (0.92 + 0.16 * t.b) * (over > h + 0.12 ? 0.84 : 1.0) * (1.0 - 0.22 * crowd * (1.0 - rel));
                  vec3 leaf = mix(g * 0.94, g * vec3(1.06, 1.15, 0.9), rel) * shade * (1.0 + 0.06 * gust * L);
                  g = mix(g, leaf, upward);
                  hit = true;
                  break;
                }
              }
              if (!hit) {
                // bare ground between the plants: soft little shadows of the leaves nearby
                float near = texture2D(uVelvet, (w + toSun * 0.06) / VELVET_PERIOD).r * grow;
                g *= (1.0 - 0.18 * smoothstep(0.15, 0.5, near) * upward) * (1.0 - 0.3 * crowd * upward);
              }
            }
          }
          #endif
          diffuseColor.rgb *= g;
        }`,
      );
  };
  material.customProgramCacheKey = () => `ground-${a}-${b}-${dirt}-${pattern}-${velvet}`;
  return material;
}

/**
 * Instanced grass: blades take the ground colour under their root (the same patches as the
 * ground shader) so the grass grows out of the ground, darker at the root and sun-bleached at
 * the tips. Meadows grow in patches of taller grass, thin out on bare earth, and gusts of wind
 * roll across them.
 */
export function grassMaterial(
  a: number,
  b: number,
  dirt: number,
): THREE.MeshStandardMaterial & { userData: { time: { value: number } } } {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    vertexColors: false,
  }) as THREE.MeshStandardMaterial & {
    userData: { time: { value: number } };
  };
  const time = { value: 0 };
  material.userData.time = time;
  const noise = groundNoise();
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.uniforms.uGroundA = { value: new THREE.Color(a) };
    shader.uniforms.uGroundB = { value: new THREE.Color(b) };
    shader.uniforms.uGroundDirt = { value: new THREE.Color(dirt) };
    shader.uniforms.uGroundNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 color;
        uniform float uTime;
        uniform sampler2D uGroundNoise;
        uniform vec3 uGroundA;
        uniform vec3 uGroundB;
        uniform vec3 uGroundDirt;
        varying vec3 vGrassTint;
        varying float vGrassT;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec2 p = root.xz / 48.0;
          vec4 n1 = texture2D(uGroundNoise, p);
          vec4 n2 = texture2D(uGroundNoise, mat2(0.8, -0.6, 0.6, 0.8) * p * 1.7 + 0.31);
          float n = n1.r * 0.7 + n2.r * 0.3;
          vec3 g = mix(uGroundA, uGroundB, smoothstep(0.34, 0.7, n));
          g *= 0.88 + 0.24 * texture2D(uGroundNoise, root.xz / 110.0 + 0.5).r;
          float bare = smoothstep(0.55, 0.72, n1.b * 0.75 + n2.g * 0.25);
          // patches of taller grass
          float meadow = smoothstep(0.3, 0.75, texture2D(uGroundNoise, root.xz / 9.0 + 0.17).g);
          float grow = (0.55 + 0.9 * meadow) * (1.0 - bare);
          float t = color.r;
          float tint = color.g;
          vec3 base = g * 0.95;
          vec3 tip = mix(g * 1.4, vec3(0.95, 0.92, 0.5) * dot(g, vec3(0.45)) * 2.2, 0.08 + 0.1 * meadow);
          vGrassTint = mix(base, tip, t) * (0.9 + 0.2 * tint);
          vGrassT = t;
          transformed.y *= grow;
          transformed.xz *= mix(1.0, grow, 0.5);
          // gusts roll across the field; blades bend more towards their tips
          vec2 wind = normalize(vec2(0.8, 0.45));
          float gust = 0.5 + 0.5 * sin(dot(root.xz, wind) * 0.55 - uTime * 1.4);
          float flutter = sin(uTime * 3.1 + root.x * 2.3 + root.z * 1.7 + tint * 6.0);
          float bendAmt = pow(t, 2.0) * transformed.y * (0.08 + 0.22 * gust + 0.05 * flutter);
          transformed.xz += wind * bendAmt;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassTint;\nvarying float vGrassT;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassTint;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // light glowing through the tips
        totalEmissiveRadiance += vGrassTint * vGrassT * vGrassT * 0.08;`,
      );
  };
  material.customProgramCacheKey = () => `grass3-${a}-${b}`;
  return material;
}

/**
 * Map-wide mask shared by the liquid shaders: R = water, G = molten chasm, blurred so it
 * gives a soft distance to the shore (1 deep inside, 0 on land). Set by the terrain.
 */
export interface LiquidMask {
  texture: { value: THREE.Texture | null };
  size: { value: THREE.Vector2 };
  /** Main direction the lava rivers run in (unit vector in the xz plane). */
  flow: { value: THREE.Vector2 };
}

export function createLiquidMask(): LiquidMask {
  return {
    texture: { value: null },
    size: { value: new THREE.Vector2(1, 1) },
    flow: { value: new THREE.Vector2(0, 1) },
  };
}

const NOISE_GLSL = `
  float lqHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 lqHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float lqNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lqHash(i), lqHash(i + vec2(1, 0)), f.x), mix(lqHash(i + vec2(0, 1)), lqHash(i + vec2(1, 1)), f.x), f.y);
  }
`;

/** Sum of directional waves: x = height (-1..1 ish), yz = gradient. */
const WAVES_GLSL = `
  vec3 waterWaves(vec2 p, float t) {
    vec3 r = vec3(0.0);
    vec2 d; float k; float a; float ph;
    d = vec2(0.8, 0.6);   k = 1.9; a = 0.45; ph = dot(d, p) * k + t * 1.2;  r += vec3(a * sin(ph), a * k * cos(ph) * d);
    d = vec2(-0.45, 0.89); k = 2.7; a = 0.3; ph = dot(d, p) * k + t * 1.5;  r += vec3(a * sin(ph), a * k * cos(ph) * d);
    d = vec2(0.28, -0.96); k = 4.6; a = 0.16; ph = dot(d, p) * k + t * 2.1; r += vec3(a * sin(ph), a * k * cos(ph) * d);
    d = vec2(-0.93, -0.36); k = 7.3; a = 0.09; ph = dot(d, p) * k + t * 2.8; r += vec3(a * sin(ph), a * k * cos(ph) * d);
    return r;
  }
`;

/**
 * Water surface: rolling waves (vertices move, normals follow the analytic slope), deep
 * colour in the middle and clear shallows at the banks, animated foam lapping at the shore,
 * white crests and twinkling sun glints.
 */
export function waterMaterial(
  shallow: number,
  deep: number,
  mask: LiquidMask,
): THREE.MeshStandardMaterial & { userData: { time: { value: number } } } {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  }) as THREE.MeshStandardMaterial & { userData: { time: { value: number } } };
  const time = { value: 0 };
  material.userData.time = time;
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.uniforms.uShallow = { value: new THREE.Color(shallow) };
    shader.uniforms.uDeep = { value: new THREE.Color(deep) };
    shader.uniforms.uMask = mask.texture;
    shader.uniforms.uMapSize = mask.size;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vWaterWorld;\n${WAVES_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          transformed.y += waterWaves(wp.xz, uTime).x * 0.035;
          vWaterWorld = wp.xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWaterWorld;
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform sampler2D uMask;
        uniform vec2 uMapSize;
        float waterMaskAt(vec2 p) { return texture2D(uMask, p / uMapSize).r; }
        ${NOISE_GLSL}
        ${WAVES_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wave = waterWaves(vWaterWorld.xz, uTime);
        float m = waterMaskAt(vWaterWorld.xz);
        float deepness = smoothstep(0.5, 0.97, m);
        vec3 wcol = mix(uShallow * 1.08, uDeep, deepness * 0.9);
        // foam: lines lapping towards the shore, broken up by noise
        float shore = 1.0 - smoothstep(0.5, 0.74, m);
        float n1 = lqNoise(vWaterWorld.xz * 5.0 + vec2(uTime * 0.3, -uTime * 0.2));
        float lap = sin(m * 38.0 + uTime * 2.2 + n1 * 3.0) * 0.5 + 0.5;
        float n2 = lqNoise(vWaterWorld.xz * 2.2 - vec2(uTime * 0.15, uTime * 0.1));
        float foam = shore * smoothstep(0.62, 0.9, lap * 0.55 + n1 * 0.45) * (0.4 + 0.6 * n2) + (1.0 - smoothstep(0.5, 0.57, m)) * (0.35 + 0.4 * n1);
        foam = clamp(foam, 0.0, 1.0);
        // white caps on the tallest crests
        float crest = smoothstep(0.62, 0.95, wave.x) * smoothstep(0.4, 0.8, lqNoise(vWaterWorld.xz * 3.0 - uTime * 0.4)) * 0.55;
        float white = clamp(foam + crest, 0.0, 1.0);
        diffuseColor.rgb = mix(wcol, vec3(1.0), white * 0.85);
        diffuseColor.a = clamp(mix(0.62, 0.9, deepness) + white * 0.3, 0.0, 1.0);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.8, white);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 fine = vec2(lqNoise(vWaterWorld.xz * 9.0 + uTime * 0.6), lqNoise(vWaterWorld.xz * 9.0 - uTime * 0.5 + 17.0)) - 0.5;
          vec3 wn = normalize(vec3(-wave.y * 0.16 + fine.x * 0.18, 1.0, -wave.z * 0.16 + fine.y * 0.18));
          normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // twinkling glints of sunlight
          float g = lqNoise(vWaterWorld.xz * 7.0 + vec2(uTime * 0.8, uTime * 0.5));
          float g2 = lqNoise(vWaterWorld.xz * 6.0 - vec2(uTime * 0.6, -uTime * 0.7));
          float glint = smoothstep(0.86, 0.98, g * g2 * 1.25) * smoothstep(0.3, 0.9, wave.x + 0.5);
          totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * glint * 1.6 * (1.0 - white) * smoothstep(0.55, 0.7, m);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'water2';
  return material;
}

/**
 * Lava river (or bubbling acid): drifting plates of dark crust with white-hot cracks between
 * them, hot spots that swell and pop, hotter and thinner-crusted away from the banks.
 * Emissive, so it glows and blooms.
 */
export function lavaMaterial(
  hot: number,
  crust: number,
  mask: LiquidMask,
): THREE.MeshStandardMaterial & { userData: { time: { value: number } } } {
  const material = new THREE.MeshStandardMaterial({
    color: crust,
    roughness: 0.85,
    emissive: hot,
    emissiveIntensity: 1,
  }) as THREE.MeshStandardMaterial & {
    userData: { time: { value: number } };
  };
  const time = { value: 0 };
  material.userData.time = time;
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.uniforms.uMask = mask.texture;
    shader.uniforms.uMapSize = mask.size;
    shader.uniforms.uHot = { value: new THREE.Color(hot) };
    shader.uniforms.uFlow = mask.flow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vLavaWorld;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          transformed.y += (sin(wp.x * 1.3 + uTime * 0.7) * sin(wp.z * 1.1 - uTime * 0.5)) * 0.03;
          vLavaWorld = wp.xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLavaWorld;
        uniform float uTime;
        uniform sampler2D uMask;
        uniform vec2 uMapSize;
        uniform vec3 uHot;
        uniform vec2 uFlow;
        ${NOISE_GLSL}
        // distance to the nearest plate border (x) and the plate's id (y)
        vec2 lavaCells(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0; float id = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 h = lqHash2(i + g);
            vec2 o = 0.5 + 0.38 * sin(uTime * 0.25 + 6.2831 * h);
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) { d2 = d; }
          }
          return vec2(d2 - d1, id);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 p = vLavaWorld.xz;
          float m = texture2D(uMask, p / uMapSize).g;
          // work in the river's frame: plates drift downstream and stretch along the flow
          vec2 fr = vec2(dot(p, uFlow), dot(p, vec2(-uFlow.y, uFlow.x)));
          vec2 warp = vec2(lqNoise(fr * 0.9 - vec2(uTime * 0.08, 0.0)), lqNoise(fr * 0.9 - vec2(uTime * 0.08, 0.0) + 7.0)) - 0.5;
          vec2 q = vec2(fr.x * 0.85, fr.y * 1.35) * 1.25 + warp * 0.9 - vec2(uTime * 0.1, 0.0);
          vec2 c = lavaCells(q);
          float border = c.x;
          float crack = 1.0 - smoothstep(0.02, 0.11 + 0.08 * m, border);
          float core = 1.0 - smoothstep(0.0, 0.04, border);
          float edgeGlow = 1.0 - smoothstep(0.0, 0.42, border);
          float pulse = 0.7 + 0.3 * sin(uTime * 1.4 + c.y * 40.0);
          // bubbles swelling in the middle of plates now and then
          float bubbleT = fract(uTime * 0.18 + c.y * 7.0);
          float bubble = smoothstep(0.28, 0.5, border) * smoothstep(0.8, 0.95, bubbleT) * (1.0 - bubbleT) * 8.0;
          // away from the banks the crust thins out
          float thin = smoothstep(0.6, 0.98, m);
          // slow hot streaks where the flow tears the crust open
          float streak = smoothstep(0.55, 0.85, lqNoise(vec2(fr.x * 0.25, fr.y * 0.8) - vec2(uTime * 0.12, 0.0)));
          // finer cracks inside the plates, and now and then a plate that is still molten
          vec2 c2 = lavaCells(q * 2.3 + 11.0);
          float fine = (1.0 - smoothstep(0.012, 0.045, c2.x)) * (1.0 - edgeGlow) * 0.22;
          float molten = step(0.9, fract(c.y * 7.13)) * (0.5 + 0.25 * sin(uTime * 0.9 + c.y * 20.0));
          float heat = crack * pulse * (0.85 + 0.4 * streak) + edgeGlow * edgeGlow * (0.04 + 0.14 * streak) + thin * streak * 0.08 + bubble + fine * pulse + molten;
          heat = clamp(heat, 0.0, 1.6);
          vec3 whiteHot = mix(uHot, vec3(1.0, 0.92, 0.55), 0.75);
          totalEmissiveRadiance = mix(uHot * heat * 1.5, whiteHot * 2.4, core * 0.85);
          // dark cooled crust with a faint red heat from below
          diffuseColor.rgb *= 0.35 + 0.3 * lqNoise(p * 4.0);
          totalEmissiveRadiance += uHot * 0.035;
        }`,
      );
  };
  material.customProgramCacheKey = () => `lava2-${hot}-${crust}`;
  return material;
}

/** World position varying for custom terrain shaders (works with instancing). */
function withWorldPos(shader: THREE.WebGLProgramParametersWithUniforms, name: string): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 ${name};`)
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
    {
      vec4 wp = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
      #endif
      ${name} = ( modelMatrix * wp ).xyz;
    }`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>\nvarying vec3 ${name};`,
  );
}

/**
 * Chasm walls: rock that sinks into darkness. The deeper a point, the more it fades into
 * the abyss colour, so a one tile wide crack reads as a bottomless drop. In worlds with a
 * molten floor the walls glow just above the liquid.
 */
export function chasmMaterial(
  color: number,
  abyss: number,
  glow?: { color: number; level: number },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, vertexColors: true });
  applyClay(material, 1, 0.1);
  const clay = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    clay(shader, renderer);
    withWorldPos(shader, 'vChasmWorld');
    shader.uniforms.uAbyss = { value: new THREE.Color(abyss) };
    shader.uniforms.uGlow = { value: new THREE.Color(glow?.color ?? 0) };
    shader.uniforms.uGlowLevel = { value: glow?.level ?? -99 };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uAbyss;\nuniform vec3 uGlow;\nuniform float uGlowLevel;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * pow(1.0 - smoothstep(uGlowLevel, uGlowLevel + 0.7, vChasmWorld.y), 2.0) * 1.6;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          float depth = 1.0 - smoothstep(-3.4, -0.1, vChasmWorld.y);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uAbyss, pow(depth, 0.8));
        }`,
      );
  };
  material.customProgramCacheKey = () => `chasm-${color}-${abyss}-${glow?.color ?? 0}`;
  return material;
}

/**
 * Sand under water: darker and bluer with depth, with dancing caustics (two layers of
 * animated cell borders) where light focuses through the waves.
 */
export function bedMaterial(
  sand: number,
  deep: number,
  waterLevel: number,
): THREE.MeshStandardMaterial & { userData: { time: { value: number } } } {
  const material = new THREE.MeshStandardMaterial({
    color: sand,
    roughness: 0.95,
    vertexColors: true,
  }) as THREE.MeshStandardMaterial & {
    userData: { time: { value: number } };
  };
  applyClay(material, 0.5, 0);
  const clay = material.onBeforeCompile;
  const time = { value: 0 };
  material.userData.time = time;
  material.onBeforeCompile = (shader, renderer) => {
    clay(shader, renderer);
    withWorldPos(shader, 'vBedWorld');
    shader.uniforms.uTime = time;
    shader.uniforms.uDeep = { value: new THREE.Color(deep) };
    shader.uniforms.uLevel = { value: waterLevel };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uDeep;
        uniform float uLevel;
        vec2 bedHash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float bedCells(vec2 p, float t) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * bedHash(i + g));
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
          return d2 - d1;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bedUnder = 1.0 - smoothstep(uLevel - 0.12, uLevel + 0.02, vBedWorld.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uDeep * 1.6, bedUnder * (1.0 - smoothstep(uLevel - 0.45, uLevel, vBedWorld.y)) * 0.8);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 p = vBedWorld.xz * 1.1;
          float c1 = 1.0 - smoothstep(0.0, 0.16, bedCells(p + vec2(uTime * 0.07, uTime * 0.03), uTime * 0.9));
          float c2 = 1.0 - smoothstep(0.0, 0.2, bedCells(p * 1.7 - vec2(uTime * 0.05, -uTime * 0.06), uTime * 0.7 + 2.0));
          float caustic = c1 * 0.65 + c2 * 0.45;
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.9) * caustic * caustic * bedUnder * 0.28;
        }`,
      );
  };
  material.customProgramCacheKey = () => `bed-${sand}-${deep}`;
  return material;
}

/**
 * Lava in a volcano vent that charges up between eruptions: a cooled black crust right after
 * one, cracks that start to glow red, then orange, until the whole pool is a bubbling
 * yellow-white just before it blows. uCharge (0..1) is driven by the hazard's timing.
 */
export function ventLavaMaterial(
  hot: number,
  crust: number,
): THREE.MeshStandardMaterial & { userData: { time: { value: number }; charge: { value: number } } } {
  const material = new THREE.MeshStandardMaterial({
    color: crust,
    roughness: 0.75,
    emissive: 0xffffff,
  }) as THREE.MeshStandardMaterial & {
    userData: { time: { value: number }; charge: { value: number } };
  };
  const time = { value: 0 };
  const charge = { value: 0 };
  material.userData.time = time;
  material.userData.charge = charge;
  material.onBeforeCompile = shader => {
    withWorldPos(shader, 'vVentWorld');
    shader.uniforms.uTime = time;
    shader.uniforms.uCharge = charge;
    shader.uniforms.uHot = { value: new THREE.Color(hot) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uCharge;
        uniform vec3 uHot;
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 p = vVentWorld.xz * 9.0;
          // slowly churning surface
          vec2 swirl = vec2(lqNoise(p * 0.5 + uTime * 0.25), lqNoise(p * 0.5 - uTime * 0.2 + 5.0)) - 0.5;
          float n = lqNoise(p + swirl * 2.5) * 0.65 + lqNoise(p * 2.3 - swirl * 3.0) * 0.35;
          float c = clamp(uCharge, 0.0, 1.0);
          // the crust breaks up as the charge rises; cracks glow first
          // molten where the noise sits below the charge: a few cracks at first, all of it at the end
          float open = smoothstep(n - 0.07, n + 0.07, c * 1.2 - 0.12);
          float toLine = 0.5 - abs(fract(n * 3.0) - 0.5);
          float crack = (1.0 - smoothstep(0.0, 0.03 + c * 0.05, toLine)) * smoothstep(0.02, 0.2, c);
          vec3 dark = uHot * vec3(0.5, 0.25, 0.2);
          vec3 orange = uHot * 1.3;
          vec3 white = mix(uHot, vec3(1.0, 0.85, 0.45), 0.65) * 2.2;
          vec3 ramp = c < 0.6 ? mix(dark, orange, c / 0.6) : mix(orange, white, (c - 0.6) / 0.4);
          float bubbles = smoothstep(0.75, 1.0, c) * smoothstep(0.8, 0.95, lqNoise(p * 1.7 + vec2(0.0, uTime * 1.5)));
          float glow = max(open, crack * 0.6) + bubbles;
          float flicker = 0.9 + 0.1 * sin(uTime * 7.0 + n * 12.0);
          totalEmissiveRadiance = ramp * glow * flicker + uHot * 0.02;
          diffuseColor.rgb *= 1.0 - open * 0.85;
        }`,
      );
  };
  material.customProgramCacheKey = () => `vent-${hot}-${crust}`;
  return material;
}
