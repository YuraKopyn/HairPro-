// ===== Imports (ESM) =====
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

// ===== Helpers: статус-стікер =====
const statusEl = document.getElementById("status");
function info(msg){ if(statusEl){ statusEl.style.display='block'; statusEl.textContent = msg; } }
function ok(){ if(statusEl){ statusEl.style.display='none'; } }
if (!navigator.mediaDevices?.getUserMedia) {
  info("Браузер не підтримує камеру. Використай Фото або онови iOS.");
}

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

// Група зачіски (і майбутніх об'єктів)
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

  // невеликий “чуб”
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
    if (glbHair) { hairGroup.remove(glbHair); glbHair.traverse(o=>o.geometry&&o.geometry.dispose()); }
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
styleSelect?.addEventListener("change", () => {
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
[hairColorEl, hairOpacityEl].forEach(el => el?.addEventListener("input", updateHairMaterial));

// Масштаб/зсуви
function updateOffsets() {
  const s = parseFloat(hairScaleEl.value);
  hairGroup.scale.setScalar(s);
  hairGroup.position.y = parseFloat(hairYOffsetEl.value);
  hairGroup.position.z = parseFloat(hairZOffsetEl.value);
}
[hairScaleEl, hairYOffsetEl, hairZOffsetEl].forEach(el => el?.addEventListener("input", updateOffsets));

// Дзеркалення відео (для селфі)
let mirrored = false;
btnFlip?.addEventListener("click", () => {
  mirrored = !mirrored;
  video.style.transform = `scaleX(${mirrored?-1:1})`;
});

// ===== MediaPipe Face Landmarker =====
const vision = window.vision;
let faceLandmarker = null;
let runningMode = "VIDEO";

async function initFace() {
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
  );
  faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
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
btnStart?.addEventListener("click", startCamera);

async function startCamera(){
  try {
    info("Запит доступу до камери…");
    // iOS must:
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");
    video.muted = true;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{ facingMode:"user", width:{ideal:1280}, height:{ideal:720} }
      });
    } catch(e1) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:"user" } });
      } catch(e2) {
        stream = await navigator.mediaDevices.getUserMedia({ audio:false, video:true });
      }
    }

    info("Камеру дозволено. Запускаю відео…");
    video.srcObject = stream;
    await video.play().catch(()=>{});
    if (video.readyState < 2) {
      await new Promise(res => {
        const onCanPlay = () => { video.removeEventListener("canplay", onCanPlay); res(); };
        video.addEventListener("canplay", onCanPlay, { once:true });
      });
    }
    ok();
    resizeAll();
    startLoop();
  } catch (e) {
    info("Камера не запустилась: " + (e?.message || e));
  }
}

btnPhoto?.addEventListener("click", ()=> photoInput.click());
photoInput?.addEventListener("change", e => {
  const f = e.target.files?.[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    const off = document.createElement("canvas");
    off.width = img.width; off.height = img.height;
    off.getContext("2d").drawImage(img,0,0);
    video.srcObject = null;
    video.src = off.toDataURL();
    video.loop = true;
    video.play();
    resizeAll();
    startLoop();
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
btnDebug?.addEventListener("click", ()=>{
  debugCanvas.classList.toggle("show");
  debugCanvas.style.display = debugCanvas.classList.contains("show") ? "block" : "none";
});

function ndcToWorld(xNdc, yNdc, z=0.5) {
  const v = new THREE.Vector3(xNdc, yNdc, z);
  v.unproject(camera);
  return v;
}

// Заглушка під додатковий рендер (стікер/декор)
function placeSticker(lms, M) {
  // TODO: коли захочеш — додамо сюди ще один 3D-об'єкт/декаль/текстуру.
}

function placeHair(landmarks, matrixN = null) {
  // 1) Центр/орієнтир голови — беремо лоб (10) і середину між щоками (234, 454)
  const L = landmarks;
  const idxLeft = 234, idxRight = 454, idxForehead = 10; // індекси з FaceMesh
  const a = L[idxLeft], b = L[idxRight], f = L[idxForehead];
  if (!a || !b || !f) return;

  // Рахуємо yaw з вектора між щоками; pitch — з лоб/центр
  const yaw = Math.atan2((b.y - a.y), (b.x - a.x));  // приблизний нахил по осі Z
  const pitch = (0.5 - f.y) * 0.8;
  const roll = 0;

  // 2D -> NDC -> world: якір у точці лоба
  const xNdc = (f.x * 2 - 1) * (mirrored ? -1 : 1);
  const yNdc = - (f.y * 2 - 1);
  const world = ndcToWorld(xNdc, yNdc, 0.5);

  // Встановлюємо позицію/орієнтацію
  hairGroup.position.lerp(world, 0.6);
  hairGroup.rotation.set(pitch, -yaw, roll);

  // Масштаб залежно від ширини голови
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const targetScale = THREE.MathUtils.clamp(1.8 * d, 0.7, 1.6) * parseFloat(hairScaleEl.value);
  hairGroup.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.6);

  // Ручні зсуви
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
        const M = res?.facialTransformationMatrixes?.[0];
        placeHair(lms, M || null);
        placeSticker(lms, M || null); // ← твій додатковий рендер
      }
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(process);
  };

  process();
}

// Авто-старт не робимо — чекаємо кнопку, бо iOS вимагає взаємодію користувача
