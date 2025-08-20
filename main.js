// ===== Imports (ESM) =====
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
const statusEl = document.getElementById("status");
function info(msg){ statusEl.style.display='block'; statusEl.textContent = msg; }
function ok(){ statusEl.style.display='none'; }
// ===== DOM =====
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

// ===== Three.js scene =====
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
threeRoot.appendChild(renderer.domElement);

// Камера під відео 16:9 (перераховуємо на resize)
let camera = new THREE.PerspectiveCamera(50, 16/9, 0.01, 100);
camera.position.set(0, 0, 1.2);
scene.add(camera);

// Світло
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(-0.5, 1, 1.5);
scene.add(dir);

// Група зачіски
const hairGroup = new THREE.Group();
scene.add(hairGroup);

// Вбудована “шапка волосся” — поки як заміна GLB
let builtinHair = null;
function buildBuiltinHair() {
  if (builtinHair) hairGroup.remove(builtinHair);
  const capGeo = new THREE.SphereGeometry(0.55, 64, 48, 0, Math.PI*2, 0, Math.PI/2);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hairColorEl.value),
    metalness: 0.1, roughness: 0.85, transparent: true, opacity: parseFloat(hairOpacityEl.value)
  });
  const cap = new THREE.Mesh(capGeo, mat);
  cap.castShadow = false; cap.receiveShadow = false;
  // невеликий “чуб” для вигляду
  const fringeGeo = new THREE.CapsuleGeometry(0.45, 0.12, 1, 16);
  const fringe = new THREE.Mesh(fringeGeo, mat);
  fringe.position.set(0, 0.25, 0.35);
  const g = new THREE.Group(); g.add(cap); g.add(fringe);
  builtinHair = g; hairGroup.add(g);
}
buildBuiltinHair();

// Завантаження GLB (коли зʼявляться реальні моделі)
const loader = new GLTFLoader();
let glbHair = null;
async function loadHairModel(url) {
  try {
    const { scene: glb } = await loader.loadAsync(url);
    if (glbHair) { hairGroup.remove(glbHair); glbHair.traverse(o=>o.geometry&&o.geometry.dispose());}
    glbHair = glb;
    // Нормалізація масштабу
    const box = new THREE.Box3().setFromObject(glb);
    const size = new THREE.Vector3(); box.getSize(size);
    const scale = 1.2 / Math.max(size.x, size.y, size.z);
    glb.scale.setScalar(scale);
    hairGroup.add(glbHair);
  } catch (e) {
    console.warn("Не вдалось завантажити GLB, лишаю вбудовану шапку:", e);
    if (!builtinHair) buildBuiltinHair();
  }
}

// Перемикач стилю
styleSelect.addEventListener("change", () => {
  const val = styleSelect.value;
  if (val === "builtin") {
    if (!builtinHair) buildBuiltinHair();
    if (glbHair) { hairGroup.remove(glbHair); glbHair = null; }
  } else {
    if (builtinHair) { hairGroup.remove(builtinHair); builtinHair = null; }
    loadHairModel(val);
  }
});

// Оновлення матеріалу/параметрів
function updateHairMaterial() {
  hairGroup.traverse(obj => {
    if (obj.isMesh && obj.material) {
      obj.material.color.set(hairColorEl.value);
      obj.material.opacity = parseFloat(hairOpacityEl.value);
      obj.material.needsUpdate = true;
    }
  });
}
[hairColorEl, hairOpacityEl].forEach(el => el.addEventListener("input", updateHairMaterial));

// Масштаб/зсуви
function updateOffsets() {
  const s = parseFloat(hairScaleEl.value);
  hairGroup.scale.setScalar(s);
  hairGroup.position.y = parseFloat(hairYOffsetEl.value);
  hairGroup.position.z = parseFloat(hairZOffsetEl.value);
}
[hairScaleEl, hairYOffsetEl, hairZOffsetEl].forEach(el => el.addEventListener("input", updateOffsets));

// Дзеркалення відео (для селфі)
let mirrored = false;
btnFlip.addEventListener("click", () => {
  mirrored = !mirrored;
  video.style.transform = `scaleX(${mirrored?-1:1})`;
});

// ===== MediaPipe Face Landmarker =====
const vision = window.vision;
let faceLandmarker = null;
let runningMode = "VIDEO";

async function initFace() {
  const fileset = await vision.FilesetResolver.forVisionTasks(
    // CDN; можеш покласти .task локально і змінити URL
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
  );
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      // Модель — з офіційного хосту Google:
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    },
    runningMode,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true
  });
}
initFace();

// ===== Відео/фото =====
btnStart.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = stream;
    await video.play();
    resizeAll();
    startLoop();
  } catch (e) {
    alert("Камеру не вдалося увімкнути. Спробуй дозволити доступ або використовуй фото.");
  }
});

btnPhoto.addEventListener("click", ()=> photoInput.click());
photoInput.addEventListener("change", e => {
  const f = e.target.files?.[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  // Малюємо фото у <video> через <img> -> <canvas> бекенд
  const img = new Image();
  img.onload = () => {
    // Підміняємо відео кадром із фото
    const off = document.createElement("canvas");
    off.width = img.width; off.height = img.height;
    off.getContext("2d").drawImage(img,0,0);
    // Используємо HTMLVideoElement з MediaStreamTrackGenerator? — складно.
    // Простий шлях: показати фото як фон у video і гнати трекер по <canvas>.
    // Для простоти тут просто вставимо фото на місце відео:
    video.srcObject = null;
    video.src = off.toDataURL();
    video.loop = true; // щоб не зупинявся
    video.play();
    resizeAll();
  };
  img.src = url;
});

// ===== Розміри =====
function resizeAll() {
  const rect = threeRoot.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  debugCanvas.width = rect.width;
  debugCanvas.height = rect.height;
}
addEventListener("resize", resizeAll);

// ===== Трекінг і привʼязка =====
const dbg = debugCanvas.getContext("2d");

function drawDebug(landmarks) {
  if (!debugCanvas.classList.contains("show") || !landmarks) return;
  dbg.clearRect(0,0,debugCanvas.width,debugCanvas.height);
  dbg.fillStyle = "rgba(0,0,0,0.6)";
  for (const lm of landmarks) {
    dbg.beginPath();
    dbg.arc(lm.x*debugCanvas.width, lm.y*debugCanvas.height, 2, 0, Math.PI*2);
    dbg.fill();
  }
}
btnDebug.addEventListener("click", ()=>{
  debugCanvas.classList.toggle("show");
  debugCanvas.style.display = debugCanvas.classList.contains("show") ? "block" : "none";
});

function ndcToWorld(xNdc, yNdc, z=0.5) {
  const v = new THREE.Vector3(xNdc, yNdc, z);
  v.unproject(camera);
  return v;
}

function placeHair(landmarks, matrixN = null) {
  // 1) Центр/орієнтир голови — беремо лоб (10) і середину між щоками (234, 454)
  const L = landmarks;
  const idxLeft = 234, idxRight = 454, idxForehead = 10; // індекси з FaceMesh
  const a = L[idxLeft], b = L[idxRight], f = L[idxForehead];
  if (!a || !b || !f) return;

  // Рахуємо yaw з вектора між щоками; pitch — з лоб/центр
  const yaw = Math.atan2((b.y - a.y), (b.x - a.x));      // приблизний нахил по осі Z
  const pitch = (0.5 - f.y) * 0.8;                        // дуже грубо: вище лоб — дивиться вниз/вгору
  const roll = 0;                                         // можна додати за бажання

  // 2D -> NDC -> world: беремо точку лоба як якір
  const xNdc = (f.x * 2 - 1) * (mirrored ? -1 : 1);
  const yNdc = - (f.y * 2 - 1);
  const world = ndcToWorld(xNdc, yNdc, 0.5);

  // Встановлюємо позицію/орієнтацію
  hairGroup.position.lerp(world, 0.6);  // згладжуємо
  hairGroup.rotation.set(pitch, -yaw, roll);

  // Масштаб залежно від ширини голови (відстань між щоками)
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const targetScale = THREE.MathUtils.clamp(1.8 * d, 0.7, 1.6) * parseFloat(hairScaleEl.value);
  hairGroup.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.6);

  // Додаткові ручні зсуви
  hairGroup.position.y += parseFloat(hairYOffsetEl.value);
  hairGroup.position.z += parseFloat(hairZOffsetEl.value);
}

let rafId = null;
async function startLoop() {
  if (!faceLandmarker) await initFace();
  cancelAnimationFrame(rafId);

  const process = async () => {
    const ts = performance.now();
    if (video.readyState >= 2) {
      const res = await faceLandmarker.detectForVideo(video, ts);
      const lms = res?.faceLandmarks?.[0];
      drawDebug(lms);
      if (lms) {
        // Якщо є матриця поза (у tasks-vision буває), можна використати matrixN для більш стабільного оберту
        const M = res?.facialTransformationMatrixes?.[0];
        placeHair(lms, M || null);
      }
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(process);
  };
  process();
}

// Старт: якщо користувач одразу дав дозвіл — спробуємо
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  // Нічого не робимо поки — чекаємо натискання кнопки старту
}
