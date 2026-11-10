import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

const GodRayShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLightPos: { value: new THREE.Vector2(0.5, 0.5) },
    uRayColor: { value: new THREE.Color("#e8f0ff") },
    uIntensity: { value: 2.5 },
    uDecay: { value: 0.96 },
    uDensity: { value: 0.95 },
    uThreshold: { value: 0.35 },
    uSoftness: { value: 0.4 },
    uBeamMix: { value: 0.8 },
    uBeamScale: { value: 6.0 },
    uBeamSharp: { value: 2.0 },
    uBeamSpeed: { value: 0.15 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uLightPos;
    uniform vec3 uRayColor;
    uniform float uIntensity;
    uniform float uDecay;
    uniform float uDensity;
    uniform float uThreshold;
    uniform float uSoftness;
    uniform float uBeamMix;
    uniform float uBeamScale;
    uniform float uBeamSharp;
    uniform float uBeamSpeed;
    uniform float uAspect;
    uniform float uTime;
    varying vec2 vUv;

    #define SAMPLES 80

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    // Streaks: noise sampled by the direction away from the source
    float beams(vec2 d) {
      vec2 dir = d / max(length(d), 0.0001);
      vec2 p = dir * uBeamScale + vec2(uTime * uBeamSpeed, 0.0);
      float n = 0.65 * noise(p) + 0.35 * noise(p * 2.7 + 5.2);
      n = smoothstep(0.25, 0.85, n);
      return pow(n, uBeamSharp);
    }

    // The hand emits light wherever it is bright
    float emitter(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return smoothstep(uThreshold, uThreshold + uSoftness, lum);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);

      vec2 delta = (vUv - uLightPos) * uDensity / float(SAMPLES);
      vec2 coord = vUv - delta * hash(vUv * 1000.0 + uTime); // jitter hides banding
      float illum = 1.0;
      float acc = 0.0;

      for (int i = 0; i < SAMPLES; i++) {
        coord -= delta;
        acc += emitter(coord) * illum;
        illum *= uDecay;
      }
      acc /= float(SAMPLES);

      // Every sample on this ray shares one direction, so one lookup gives streaks
      vec2 d = vUv - uLightPos;
      d.x *= uAspect;
      float streak = mix(1.0, beams(d), uBeamMix);

      gl_FragColor = vec4(base.rgb + uRayColor * acc * streak * uIntensity, base.a);
    }
  `,
};

export function createGodRays({ renderer, camera, pane = null }) {
  const pass = new ShaderPass(GodRayShader);

  const box = new THREE.Box3();
  const anchorWorld = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const viewPos = new THREE.Vector3();
  let subject = null;

  // Rays originate from a point inside the subject's bounding box (0..1 per axis)
  const params = {
    enabled: true,
    rayColor: "#e8f0ff",
    anchor: { x: 0.5, y: 0.5, z: 0.5 },
  };

  function setSize(width, height) {
    pass.uniforms.uAspect.value = width / height;
  }

  // Call once the hand is loaded (and again if it moves or animates a lot)
  function setSubject(object) {
    subject = object;
    refresh();
  }

  function refresh() {
    if (!subject) return;
    subject.updateMatrixWorld(true);
    box.setFromObject(subject);
  }

  // Call once per frame, after controls.update()
  function update(time) {
    pass.uniforms.uTime.value = time;

    if (!subject) {
      pass.enabled = false;
      return;
    }

    anchorWorld.set(
      THREE.MathUtils.lerp(box.min.x, box.max.x, params.anchor.x),
      THREE.MathUtils.lerp(box.min.y, box.max.y, params.anchor.y),
      THREE.MathUtils.lerp(box.min.z, box.max.z, params.anchor.z),
    );

    camera.updateMatrixWorld();
    ndc.copy(anchorWorld).project(camera);
    pass.uniforms.uLightPos.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);

    // Skip if the source is behind the camera
    viewPos.copy(anchorWorld).applyMatrix4(camera.matrixWorldInverse);
    pass.enabled = params.enabled && viewPos.z < 0;
  }

  if (pane) {
    const u = pass.uniforms;
    const folder = pane.addFolder({ title: "God Rays", expanded: false });
    const slider = (uniform, label, min, max, step = 0.01) =>
      folder.addBinding(uniform, "value", { label, min, max, step });

    folder.addBinding(params, "enabled", { label: "Enabled" });
    folder
      .addBinding(params, "rayColor", { label: "Color" })
      .on("change", (ev) => u.uRayColor.value.set(ev.value));
    folder.addBinding(params, "anchor", {
      label: "Origin (in hand)",
      x: { min: 0, max: 1 },
      y: { min: 0, max: 1 },
      z: { min: 0, max: 1 },
    });
    slider(u.uIntensity, "Intensity", 0, 8);
    slider(u.uThreshold, "Emit Threshold", 0, 1.5);
    slider(u.uSoftness, "Emit Softness", 0.01, 1.5);
    slider(u.uDensity, "Length", 0.2, 1.2);
    slider(u.uDecay, "Decay", 0.9, 1.0, 0.001);
    slider(u.uBeamMix, "Streakiness", 0, 1);
    slider(u.uBeamScale, "Beam Scale", 1, 30, 0.1);
    slider(u.uBeamSharp, "Beam Sharpness", 0.5, 8);
    slider(u.uBeamSpeed, "Beam Speed", 0, 1);
  }

  return { pass, setSize, setSubject, refresh, update };
}
