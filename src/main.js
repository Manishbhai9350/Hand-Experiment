import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { createHandMaterial } from "./material/hand.material";
import { Pane } from "tweakpane";
import gsap from "gsap";

const canvas = document.querySelector("canvas");

const pane = new Pane({
});
// pane.hidden = true;

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// ---------- Camera ----------
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(3, 0, 0);

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// ---------- Controls ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// ---------- Lights ----------
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

// ---------- Tunables ----------
const INTRO = {
  start: 0.3, // seconds before the hand starts moving
  revealDuration: 3.4,
  revealEase: "power3.out", // fast arrival, long soft landing
  unfoldOverlap: 0.5, // unfold starts at this fraction of the reveal (lower = more overlap)
  unfoldDuration: 2.2,
  unfoldEase: "power2.inOut",
  fingerStagger: 0.14, // seconds between fingers (set 0 if your clip already staggers them)
  fingerOrder: ["index", "middle", "ring", "pinky", "thumb"], // front finger first
};
const MOUSE = { range: 0.035, smoothing: 3.5 }; // range = fraction of hand size
const IDLE = { curl: 0.03, float: 0.004, speed: 0.7 }; // subtle "breathing"

// ---------- Model ----------
let hand = null;
let mixer = null;
let revealAction = null;
let fingerActions = [];
let handBase = new THREE.Vector3();
let handSize = 1;
const clock = new THREE.Clock();

const state = { introDone: false, mouseWeight: { value: 0 } };
const mouse = { target: 0, current: 0 };
const camUp = new THREE.Vector3();

// +1 when the mouse is at the top of the screen, -1 at the bottom
window.addEventListener("pointermove", (e) => {
  mouse.target = -((e.clientY / window.innerHeight) * 2 - 1);
});

// Splits a clip into one clip per finger, based on bone names in the track names
function splitByFinger(clip) {
  const groups = {};
  clip.tracks.forEach((track) => {
    const m = track.name
      .toLowerCase()
      .match(/thumb|index|middle|ring|pinky|pinkie|little/);
    let key = m ? m[0] : "other";
    if (key === "pinkie" || key === "little") key = "pinky";
    (groups[key] ||= []).push(track);
  });
  return groups;
}

const handMaterial = createHandMaterial({}, pane);

const loader = new GLTFLoader();
loader.load(
  "/models/hand.glb",
  (gltf) => {
    hand = gltf.scene;

    hand.traverse((child) => {
      if (child.isMesh) child.material = handMaterial;
      if (child.isSkinnedMesh) child.frustumCulled = false;
    });

    scene.add(hand);

    // ---------- Copy GLB camera to yours ----------
    const glbCamera = gltf.cameras?.[0];

    if (glbCamera) {
      camera.position.copy(glbCamera.position);
      camera.quaternion.copy(glbCamera.quaternion);
      if (glbCamera.isPerspectiveCamera) {
        camera.fov = glbCamera.fov;
        camera.near = glbCamera.near;
        camera.far = glbCamera.far;
        camera.updateProjectionMatrix();
      }

      // Point OrbitControls at where the GLB camera is looking
      const lookTarget = new THREE.Vector3(0, 0, -1);
      lookTarget.applyQuaternion(glbCamera.quaternion);
      lookTarget.add(glbCamera.position);
      controls.target.copy(lookTarget);
      controls.update();
    }

    // ---------- Measure the hand (rest geometry, before any animation) ----------
    hand.updateMatrixWorld(true);
    const box = new THREE.Box3();
    hand.traverse((c) => {
      if (c.isMesh) {
        c.geometry.computeBoundingBox();
        box.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld));
      }
    });
    handSize = box.getSize(new THREE.Vector3()).length();
    handBase.copy(hand.position);
    const camDistance = camera.position.distanceTo(
      box.getCenter(new THREE.Vector3()),
    );

    // ---------- Clips ----------
    mixer = new THREE.AnimationMixer(hand);

    const revealClip = THREE.AnimationClip.findByName(
      gltf.animations,
      "hand_reveal",
    );
    const unfoldClip = THREE.AnimationClip.findByName(
      gltf.animations,
      "hand_unfold",
    );

    if (!revealClip || !unfoldClip) {
      console.warn(
        "Missing clip. Found:",
        gltf.animations.map((c) => c.name),
      );
      return;
    }

    // Both clips must animate different bones, or they blend into each other
    const revealTracks = new Set(revealClip.tracks.map((t) => t.name));
    const shared = unfoldClip.tracks
      .filter((t) => revealTracks.has(t.name))
      .map((t) => t.name);
    if (shared.length) {
      console.warn("hand_reveal and hand_unfold both animate:", shared);
    }

    // Actions are paused and scrubbed by GSAP (action.time) instead of playing at constant speed
    const makeAction = (clip) => {
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      a.paused = true;
      a.time = 0;
      return a;
    };

    revealAction = makeAction(revealClip);

    const groups = splitByFinger(unfoldClip);
    const presentFingers = INTRO.fingerOrder.filter((k) => groups[k]);
    console.log("unfold groups:", Object.keys(groups));
    if (!presentFingers.length) {
      console.warn("No finger bones matched by name; unfold plays as one block.");
    }

    const parts = Object.entries(groups).map(([name, tracks]) => {
      const clip = new THREE.AnimationClip(
        `unfold_${name}`,
        unfoldClip.duration,
        tracks,
      );
      return { name, action: makeAction(clip), duration: unfoldClip.duration };
    });
    fingerActions = parts.filter((p) => presentFingers.includes(p.name));

    mixer.update(0); // apply the first frames now so nothing flashes open

    // ---------- Cinematic state: start dark ----------
    const u = handMaterial.uniforms;
    const fu = finalPass.uniforms;
    const rest = {
      exposure: renderer.toneMappingExposure,
      bloom: bloomPass.strength,
      vignette: fu.uVignette.value,
      grain: fu.uGrain.value,
      aberration: fu.uAberration.value,
      fresnel: u.uFresnelIntensity.value,
      gradStart: u.uGradientStart.value,
      fov: camera.fov,
      camPos: camera.position.clone(),
    };

    renderer.toneMappingExposure = 0;
    bloomPass.strength = rest.bloom * 0.3;
    fu.uVignette.value = rest.vignette + 0.6;
    fu.uGrain.value = rest.grain * 2;
    u.uFresnelIntensity.value = 0;
    u.uGradientStart.value = 0.98; // light hasn't "ignited" yet

    // Camera starts slightly back, slightly above, and a bit wider
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    // camera.position
    //   .copy(rest.camPos)
    //   .addScaledVector(back, camDistance * 0.14)
    //   .addScaledVector(up, camDistance * 0.03);
    // camera.fov = rest.fov + 5;
    camera.updateProjectionMatrix();
    controls.enabled = false;

    // ---------- Intro timeline (plays once) ----------
    const T0 = INTRO.start;
    const unfoldStart = T0 + INTRO.revealDuration * INTRO.unfoldOverlap;

    const tl = gsap.timeline({
      onComplete: () => {
        controls.enabled = true;
      },
    });

    const scrub = (part, dur, ease, at) => {
      const p = { t: 0 };
      tl.to(
        p,
        {
          t: 1,
          duration: dur,
          ease,
          onUpdate: () => {
            part.action.time = p.t * part.duration;
          },
        },
        at,
      );
    };

    // Act 1: the hand glides in
    scrub(
      { action: revealAction, duration: revealClip.duration },
      INTRO.revealDuration,
      INTRO.revealEase,
      T0,
    );

    // Act 2: fingers unfold with a stagger, overlapping the end of the reveal
    let unfoldEnd = unfoldStart;
    parts.forEach((part) => {
      const idx = presentFingers.indexOf(part.name);
      const isFinger = idx !== -1;
      const delay = isFinger ? idx * INTRO.fingerStagger : 0;
      const dur = INTRO.unfoldDuration * (1 + (isFinger ? idx : 0) * 0.06);
      scrub(part, dur, INTRO.unfoldEase, unfoldStart + delay);
      unfoldEnd = Math.max(unfoldEnd, unfoldStart + delay + dur);
    });

    const total = unfoldEnd + 0.8;

    // Fade up from black
    tl.to(
      renderer,
      { toneMappingExposure: rest.exposure, duration: 2.0, ease: "power2.out" },
      0.1,
    );

    // Camera push-in and settle
    // tl.to(
    //   camera.position,
    //   {
    //     x: rest.camPos.x,
    //     y: rest.camPos.y,
    //     z: rest.camPos.z,
    //     duration: total,
    //     ease: "power2.inOut",
    //   },
    //   0,
    // );
    tl.to(
      camera,
      {
        fov: rest.fov,
        duration: total,
        ease: "power2.inOut",
        onUpdate: () => camera.updateProjectionMatrix(),
      },
      0,
    );

    // The rim appears first, as a ghostly outline
    tl.to(
      u.uFresnelIntensity,
      { value: rest.fresnel, duration: INTRO.revealDuration * 0.7, ease: "power2.out" },
      T0 + 0.2,
    );

    // Lens whip as the hand sweeps in
    // tl.to(fu.uAberration, { value: 0.007, duration: 0.5, ease: "power2.out" }, T0 + 0.1);
    tl.to(
      fu.uAberration,
      { value: rest.aberration, duration: 1.8, ease: "power2.inOut" },
      T0 + 0.6,
    );

    // Light ignites at the fingertips and floods back along the hand
    tl.to(
      u.uGradientStart,
      {
        value: rest.gradStart,
        duration: (unfoldEnd - unfoldStart) * 0.9,
        ease: "power2.inOut",
      },
      unfoldStart + 0.2,
    );

    // Bloom builds, flares as the last finger opens, then settles
    tl.to(
      bloomPass,
      { strength: rest.bloom * 0.6, duration: unfoldStart, ease: "power1.inOut" },
      0,
    );
    tl.to(
      bloomPass,
      {
        strength: rest.bloom * 1.55,
        duration: unfoldEnd - unfoldStart,
        ease: "power2.in",
      },
      unfoldStart,
    );
    tl.to(
      bloomPass,
      { strength: rest.bloom, duration: 1.8, ease: "power3.out" },
      unfoldEnd,
    );

    // Frame opens up, grain settles
    tl.to(fu.uVignette, { value: rest.vignette, duration: total, ease: "power2.inOut" }, 0.3);
    tl.to(fu.uGrain, { value: rest.grain, duration: total, ease: "power1.out" }, 0.3);

    // Mouse follow and idle breathing fade in as the intro finishes
    tl.to(state.mouseWeight, { value: 1, duration: 2.0, ease: "power2.inOut" }, unfoldEnd - 0.4);
    tl.add(() => {
      state.introDone = true;
    }, unfoldEnd);
  },
  (progress) => {
    if (progress.total)
      console.log(
        `Loading: ${((progress.loaded / progress.total) * 100).toFixed(0)}%`,
      );
  },
  (error) => console.error("Error loading model:", error),
);

// ---------- Post-processing ----------
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0 },
    uGrain: { value: 0.15 },
    uVignette: { value: 0.9 },
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
    uniform float uTime;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);

      // Chromatic aberration, stronger toward the edges
      vec2 offset = dir * dist * uAberration * 10.0;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      vec3 color = vec3(r, g, b);

      // Vignette
      color *= 1.0 - smoothstep(0.35, 0.95, dist) * uVignette;

      // Animated grain
      float n = hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
      color += n * uGrain;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);

composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.29, // strength
  1.19, // radius
  0, // threshold
);
composer.addPass(bloomPass);
bloomPass.highPassUniforms.smoothWidth.value = 0.1; // softness

composer.addPass(new OutputPass()); // tone mapping + sRGB conversion

composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight)); // anti-aliasing

const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);

// ---------- Post-processing controls ----------
const fx = pane.addFolder({ title: "Post Processing", expanded: false });
fx.addBinding(bloomPass, "strength", { label: "Bloom Strength", min: 0, max: 3, step: 0.01 });
fx.addBinding(bloomPass, "radius", { label: "Bloom Radius", min: 0, max: 1.5, step: 0.01 });
fx.addBinding(bloomPass, "threshold", { label: "Bloom Threshold", min: 0, max: 1, step: 0.01 });
fx.addBinding(bloomPass.highPassUniforms.smoothWidth, "value", {
  label: "Bloom Softness",
  min: 0.01,
  max: 1,
  step: 0.01,
});
fx.addBinding(finalPass.uniforms.uAberration, "value", {
  label: "Aberration",
  min: 0,
  max: 0.02,
  step: 0.0001,
});
fx.addBinding(finalPass.uniforms.uGrain, "value", { label: "Grain", min: 0, max: 0.3, step: 0.001 });
fx.addBinding(finalPass.uniforms.uVignette, "value", { label: "Vignette", min: 0, max: 1.5, step: 0.01 });

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ---------- Mouse follow + idle ----------
function updateHand(delta, elapsed) {
  if (!hand) return;

  // Frame-rate independent smoothing toward the mouse
  mouse.current +=
    (mouse.target - mouse.current) * (1 - Math.exp(-MOUSE.smoothing * delta));

  // Move along the camera's up axis, so "up" always means up on screen
  camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

  const w = state.mouseWeight.value * .01;
  const offset =
    (mouse.current * handSize * MOUSE.range +
      Math.sin(elapsed * IDLE.speed) * handSize * IDLE.float) *
    w;
  hand.position.copy(handBase).addScaledVector(camUp, offset);

  // Fingers gently breathe: curl back a few percent and release, out of phase
  if (state.introDone) {
    fingerActions.forEach((f, i) => {
      const breath = 0.5 + 0.5 * Math.sin(elapsed * IDLE.speed * 1.3 + i * 0.9);
      f.action.time = f.duration * (1 - IDLE.curl * breath * w);
    });
  }
}

// ---------- Loop ----------
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  updateHand(delta, clock.elapsedTime);
  if (mixer) mixer.update(delta);

  finalPass.uniforms.uTime.value += delta;

  controls.update();

  composer.render();
}
animate();