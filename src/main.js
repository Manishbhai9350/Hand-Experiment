import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createHandMaterial } from "./material/hand.material";
import { Pane } from "tweakpane";

const canvas = document.querySelector("canvas");

const pane = new Pane();

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// ---------- Camera ----------
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 1, 4);

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

const HandMaterial = createHandMaterial({}, pane);

const loader = new GLTFLoader();
loader.load(
  "/models/hand/scene.gltf",
  (gltf) => {
    hand = gltf.scene;

    hand.traverse((child) => {
      if (child.isMesh) child.material = HandMaterial;
    });

    const box = new THREE.Box3().setFromObject(hand);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    hand.position.sub(center);
    hand.position.sub(new THREE.Vector3(0, size.y / 4, 0));

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 3 / maxDim;
    hand.scale.setScalar(scale);
    hand.position.multiplyScalar(scale);

    scene.add(hand);

    // Pass the hand's real bottom/top to the material
    hand.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(hand);
    HandMaterial.uniforms.uGradientMin.value = worldBox.min.y;
    HandMaterial.uniforms.uGradientMax.value = worldBox.max.y;
    pane.refresh();

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

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ---------- Loop ----------
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  controls.update();
  renderer.render(scene, camera);
}
animate();
