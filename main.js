// ===== Imports =====
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

// ===== DOM =====
const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const debugCanvas = document.getElementById("debug");
const threeRoot = document.getElementById("three-root");

const btnStart = document.getElementById("btnStart");
const btnPhoto = document.getElementById("btnPhoto");
const photoInput = document.getElementById("photoInput");
const btnFlip = document.getElementById("btnFlip");
const btnDebug = document.getElementById("btnDebug");

const hairColorEl = document.getElementById("hairColor");
const hairOpacityEl = document.getElementById("hairOpacity");
const hairScaleEl = document.getElementById("hairScale");
const hairYOffsetEl = document.getElementById("hairYOffset");
const hairZOffsetEl = document.getElementById("hairZOffset");
const styleSelect = document.getElementById("styleSelect");

function info(msg){ statusEl.style.display='block'; statusEl.textContent = msg; }
function ok(){ statusEl.style.display='none'; }

// ===== Three.js scene =====
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
threeRoot.appendChild(renderer.domElement);

let camera = new THREE.PerspectiveCamera(50, 16/9, 0.01, 100);
camera.position.set(0, 0, 1.2);
scene.add(camera);

scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(-0.5, 1, 1.5);
scene.add(dir);

// ===== Hair =====
const hairGroup = new THREE.Group();
scene.add(hairGroup);

let builtinHair = null;
function buildBuiltinHair() {
  if (builtinHair) hairGroup.remove(builtinHair);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hairColorEl.value),
    metalness: 0.1, roughness: 0.85,
    transparent: true, opacity: parseFloat(hairOpacityEl.value)
  });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 64, 48, 0, Math.PI*2, 0, Math.PI/2), mat);
  const fringe = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.12, 1, 16), mat);
  fringe.position.set(0, 0.25, 0.35);

  const g = new THREE.Group(); g.add(cap); g.add(fringe);
  builtinHair = g; hairGroup.add(g);
}
buildBuiltinHair();

// ===== MediaPipe =====
const vision = window.vision;
let faceLandmarker = null;
async function initFace() {
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
  );
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFacialTransformationMatrixes: true
  });
}
initFace();

// ===== Camera =====
btnStart.addEventListener("click", startCamera);
async function startCamera() {
  try {
    info("Запит доступу до камери…");
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");
    video.muted = true;

    let stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"user", width:{ideal:1280}, height:{ideal:720} }, audio:false });
    video.srcObject = stream;
    await video.play();
    ok();
    resizeAll();
    startLoop();
  } catch (e) {
    info("Камера не запустилась: " + e.message);
  }
}

// ===== Фото =====
btnPhoto.addEventListener("click", ()=> photoInput.click());
photoInput.addEventListener("change", e => {
  const f = e.target.files?.[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    debugCanvas.style.display = "block";
    debugCanvas.width = img.width;
    debugCanvas.height = img.height;
    debugCanvas.getContext("2d").drawImage(img,0,0);
    ok();
  };
  img.src = url;
});

// ===== Resize =====
function resizeAll() {
  const rect = threeRoot.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  debugCanvas.width = rect.width;
  debugCanvas.height = rect.height;
}
addEventListener("resize", resizeAll);

// ===== Loop =====
let rafId = null;
async function startLoop() {
  if (!faceLandmarker) await initFace();
  cancelAnimationFrame(rafId);

  const process = async () => {
    const ts = performance.now();
    if (video.readyState >= 2) {
      const res = await faceLandmarker.detectForVideo(video, ts);
      const lms = res?.faceLandmarks?.[0];
      if (lms) {
        // тут буде placeHair(lms)
      }
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(process);
  };
  process();
}
