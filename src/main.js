import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { createHandMaterial } from "./material/hand.material";
import { Pane } from "tweakpane";

const canvas = document.querySelector("canvas");

const pane = new Pane();

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
const clock = new THREE.Clock();

const handMaterial = createHandMaterial({}, pane);

const loader = new GLTFLoader();
loader.load(
  // "/models/hand/scene.gltf",
  "/models/hand.glb",
  (gltf) => {
    hand = gltf.scene;

    hand.traverse((child) => {
      if (child.isMesh) child.material = handMaterial;
    });

    // Center the model and scale it to a consistent size
    const box = new THREE.Box3().setFromObject(hand);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    hand.position.sub(center);
    hand.position.sub(new THREE.Vector3(0, size.y / 4, 0));

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 3 / maxDim;
    hand.scale.setScalar(scale);

    // Re-center after scaling
    hand.position.multiplyScalar(scale);

    hand.position.add(new THREE.Vector3(0, 1, -1.2));

    scene.add(hand);

    // Play animations if the model has any
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(hand);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    }
  },
  (progress) => {
    if (progress.total) {
      console.log(
        `Loading: ${((progress.loaded / progress.total) * 100).toFixed(0)}%`,
      );
    }
  },
  (error) => {
    console.error("Error loading model:", error);
  },
);

// ---------- Post-processing ----------
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.003 },
    uGrain: { value: 0.07 },
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
  0.9, // strength
  0.8, // radius
  0.15, // threshold
);
composer.addPass(bloomPass);
bloomPass.highPassUniforms.smoothWidth.value = 1; // softness

composer.addPass(new OutputPass()); // tone mapping + sRGB conversion

const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);

// ---------- Post-processing controls ----------
const fx = pane.addFolder({ title: "Post Processing", expanded:false });
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
