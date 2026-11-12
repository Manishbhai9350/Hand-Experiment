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

const pane = new Pane();

pane.hidden = true;

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

// ---------- Model ----------
let hand = null;
let mixer = null;
let revealAction = null;
let unfoldAction = null;
const clock = new THREE.Clock();

const handMaterial = createHandMaterial({}, pane);

const loader = new GLTFLoader();
loader.load(
  "/models/hand.glb",
  (gltf) => {
    hand = gltf.scene;

    console.log(gltf);

    hand.traverse((child) => {
      if (child.isMesh) child.material = handMaterial;
      if (child.isSkinnedMesh) child.frustumCulled = false;
    });

    scene.add(hand);

    // ---------- Copy GLB camera to yours ----------
    let glbCamera = gltf.cameras[0];

    if (glbCamera) {
      camera.position.copy(glbCamera.position);
      camera.quaternion.copy(glbCamera.quaternion);
      if (glbCamera.isPerspectiveCamera) {
        camera.fov = glbCamera.fov;
        camera.near = glbCamera.near;
        camera.far = glbCamera.far;
        camera.updateProjectionMatrix();
      }

      // Point OrbitControls target at where the GLB camera is looking
      const lookTarget = new THREE.Vector3(0, 0, -1);
      lookTarget.applyQuaternion(glbCamera.quaternion);
      lookTarget.add(glbCamera.position);
      controls.target.copy(lookTarget);
      controls.update();
    }

    // ---------- Setup both actions ----------
    mixer = new THREE.AnimationMixer(hand);

    const revealClip = THREE.AnimationClip.findByName(
      gltf.animations,
      "hand_reveal",
    );
    const unfoldClip = THREE.AnimationClip.findByName(
      gltf.animations,
      "hand_unfold",
    );

    if (!revealClip)
      console.warn(
        "hand_reveal not found:",
        gltf.animations.map((c) => c.name),
      );
    if (!unfoldClip)
      console.warn(
        "hand_unfold not found:",
        gltf.animations.map((c) => c.name),
      );

    revealAction = mixer.clipAction(revealClip);
    revealAction.setLoop(THREE.LoopOnce);
    revealAction.clampWhenFinished = true;
    revealAction.play();
    revealAction.paused = true;

    unfoldAction = mixer.clipAction(unfoldClip);
    unfoldAction.setLoop(THREE.LoopOnce);
    unfoldAction.clampWhenFinished = true;
    unfoldAction.play();
    unfoldAction.paused = true;

    mixer.update(0);

    // ---------- Cinematic FX timeline ----------
    const tl = gsap.timeline();

    // Reveal plays
    tl.add(() => {
      revealAction.paused = false;
    }, 0.2);

    // Unfold triggers
    tl.add(() => {
      unfoldAction.paused = false;
    }, 2.0);

    tl.play();
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
  1.57, // strength
  1.19, // radius
  0, // threshold
);
composer.addPass(bloomPass);
bloomPass.highPassUniforms.smoothWidth.value = 0.74; // softness

composer.addPass(new OutputPass()); // tone mapping + sRGB conversion

composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight)); // anti-aliasing

const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);

// ---------- Post-processing controls ----------
const fx = pane.addFolder({ title: "Post Processing", expanded: false });
fx.addBinding(bloomPass, "strength", {
  label: "Bloom Strength",
  min: 0,
  max: 3,
  step: 0.01,
});
fx.addBinding(bloomPass, "radius", {
  label: "Bloom Radius",
  min: 0,
  max: 1.5,
  step: 0.01,
});
fx.addBinding(bloomPass, "threshold", {
  label: "Bloom Threshold",
  min: 0,
  max: 1,
  step: 0.01,
});
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
fx.addBinding(finalPass.uniforms.uGrain, "value", {
  label: "Grain",
  min: 0,
  max: 0.3,
  step: 0.001,
});
fx.addBinding(finalPass.uniforms.uVignette, "value", {
  label: "Vignette",
  min: 0,
  max: 1.5,
  step: 0.01,
});

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ---------- Loop ----------
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  finalPass.uniforms.uTime.value += delta;

  controls.update();

  composer.render();
}
animate();
