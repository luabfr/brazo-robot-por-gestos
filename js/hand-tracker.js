// Seguimiento de manos con MediaPipe: cámara, detección, gestos y datos de control (X/Y, dedos, gesto).
// Lo usan hand-tracking.html (versión local por USB) y emisor.html (versión remota por MQTT).
// Cada cambio en los datos se publica como evento "handcontrol" en window: la página decide adónde enviarlo.

import { OUTPUT_MAX, NO_HAND_MESSAGE, GESTURE_LABELS, formatMessage } from "./protocol.js";

// ================= Configuración =================

// Versión fijada: una versión nueva de la librería podría cambiar la API sin aviso
var MEDIAPIPE_VERSION = "1.1.1";
var MEDIAPIPE_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + MEDIAPIPE_VERSION;
// Modelo oficial de Google (~7,8 MB); el navegador lo guarda en caché tras la primera descarga
var MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

var MAX_HANDS = 2;
// Umbrales de confianza (0 a 1). 0.5 es el valor por defecto; súbelos si aparecen manos "fantasma"
var MIN_DETECTION_CONFIDENCE = 0.5;
var MIN_PRESENCE_CONFIDENCE = 0.5;
var MIN_TRACKING_CONFIDENCE = 0.5;

var CAMERA_TIMEOUT_MS = 10000; // Tiempo máximo para que la cámara entregue su primer cuadro
var STATS_INTERVAL_MS = 250;   // Los indicadores no necesitan refrescarse en cada cuadro
var HAVE_CURRENT_DATA = 2;     // video.readyState mínimo para que haya un cuadro disponible

// El modelo informa la lateralidad según el cuadro que recibe, que es el de la webcam sin espejar
// (la vista espejo es solo visual). Probado con right_hands.jpg de MediaPipe: devuelve "Right".
// Si con tu cámara las manos aparecen al revés, pon true para invertir "Left"/"Right".
var SWAP_HANDEDNESS = false;
var HAND_NAMES = { Left: "Izquierda", Right: "Derecha" };

// Conexiones entre los 21 nodos, agrupadas para pintar cada dedo de un color.
// Numeración del modelo: 0 muñeca · 1-4 pulgar · 5-8 índice · 9-12 medio · 13-16 anular · 17-20 meñique
var HAND_PARTS = [
  { color: "#e9edf4", connections: [[0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17]] }, // palma
  { color: "#ff6b6b", connections: [[1, 2], [2, 3], [3, 4]] },                             // pulgar
  { color: "#ffc233", connections: [[5, 6], [6, 7], [7, 8]] },                             // índice
  { color: "#5fd38a", connections: [[9, 10], [10, 11], [11, 12]] },                        // medio
  { color: "#5cc8e6", connections: [[13, 14], [14, 15], [15, 16]] },                       // anular
  { color: "#b99bf0", connections: [[17, 18], [18, 19], [19, 20]] }                        // meñique
];
var FINGERTIPS = [4, 8, 12, 16, 20];
var INDEX_FINGERTIP = 8;
var OUTLINE_COLOR = "rgba(0, 0, 0, 0.6)"; // Contorno oscuro: el dibujo se ve sobre fondos claros y oscuros
var LABEL_COLOR = "#ffffff";
var CONTROL_AREA_COLOR = "rgba(255, 255, 255, 0.35)";
var CONTROL_MARKER_COLOR = "#ffffff";
var CONTROL_MARKER_FILL = "rgba(255, 194, 51, 0.6)"; // Relleno amarillo mientras hay una pinza

// ================= Datos de control (lo que se enviará al Arduino) =================

// Nodos que se promedian para obtener el punto que mueve X/Y.
// El centro de la palma es más estable: casi no se mueve al cerrar la mano o hacer una pinza.
var CONTROL_POINT_NODES = {
  palm: [0, 5, 9, 13, 17],
  index: [INDEX_FINGERTIP]
};
var LANDMARK_COUNT = 21;
var CONTROL_MARGIN = 0.1;    // Se descarta un 10 % de cada borde: así se llega cómodo a 0 y al máximo
var SMOOTHING_FACTOR = 0.4;  // Peso de cada medición nueva: 1 = sin suavizado (tiembla), más bajo = más suave pero con retraso
var POSITION_DEADBAND = 2;   // Zona muerta: cambios menores a esto no generan mensaje (evita que un servo vibre)
var MIN_SEND_INTERVAL_MS = 50; // Límite inferior para initHandTracker(): más rápido no aporta y satura el puerto
var sendIntervalMs = 100;      // Mínimo entre mensajes: 10 por segundo por USB; la versión remota lo sube con initHandTracker()
var HAND_LOST_MS = 300;      // Si el detector pierde la mano por menos tiempo (un parpadeo), no se avisa
var GESTURE_HOLD_MS = 150;   // Un gesto nuevo tiene que mantenerse este tiempo para aceptarse (evita parpadeos)

// Umbrales de los gestos. Se comparan proporciones y no distancias, así funcionan con la mano cerca o lejos
var FINGER_EXTENDED_RATIO = 1.1; // Dedo extendido: la punta está más de un 10 % más lejos de la muñeca que la articulación media
var FINGER_CURLED_RATIO = 0.85;  // Dedo cerrado del todo: la punta queda más cerca de la muñeca que la articulación media
var THUMB_EXTENDED_RATIO = 1.2;  // Pulgar extendido: la punta se aleja del centro de la palma bastante más que su nudillo
var PINCH_ON_RATIO = 0.35;       // Pinza: puntas de pulgar e índice a menos del 35 % del largo de la palma...
var PINCH_OFF_RATIO = 0.5;       // ...y se suelta recién al pasar el 50 % (histéresis: no parpadea en el límite)

// Nodos usados para medir. Dedos largos: articulación media (PIP) y punta de índice, medio, anular y meñique
var WRIST = 0;
var THUMB_KNUCKLE = 2;
var THUMB_TIP = 4;
var MIDDLE_KNUCKLE = 9; // Nudillo del dedo medio: centro aproximado de la palma
var LONG_FINGERS = [
  { pip: 6, tip: 8 },
  { pip: 10, tip: 12 },
  { pip: 14, tip: 16 },
  { pip: 18, tip: 20 }
];

// ================= Elementos de la página =================

var cameraButton = document.getElementById("cameraButton");
var showIndicesCheckbox = document.getElementById("showIndicesCheckbox");
var mirrorCheckbox = document.getElementById("mirrorCheckbox");
var statusText = document.getElementById("status");
var stage = document.getElementById("stage");
var video = document.getElementById("video");
var overlay = document.getElementById("overlay");
var stagePlaceholder = document.getElementById("stagePlaceholder");
var handsValue = document.getElementById("handsValue");
var fpsValue = document.getElementById("fpsValue");
var delegateValue = document.getElementById("delegateValue");
var handDataList = document.getElementById("handDataList");
var controlPointSelect = document.getElementById("controlPointSelect");
var controlXValue = document.getElementById("controlXValue");
var controlYValue = document.getElementById("controlYValue");
var fingersValue = document.getElementById("fingersValue");
var gestureValue = document.getElementById("gestureValue");
var messageValue = document.getElementById("messageValue");
var messageRateValue = document.getElementById("messageRateValue");
var controlHint = document.getElementById("controlHint");
var context = overlay.getContext("2d");

// ================= Estado =================

var isCameraSupported = Boolean(window.isSecureContext && navigator.mediaDevices &&
                                navigator.mediaDevices.getUserMedia);
var mediapipePromise = null;   // Carga de la librería y sus archivos WASM (se hace una sola vez)
var landmarkerPromise = null;  // Creación del detector en curso o terminada
var handLandmarker = null;     // Detector listo para usar
var activeDelegate = null;     // "GPU" o "CPU", según con cuál se pudo crear el detector
var allowedDelegates = ["GPU", "CPU"]; // Si la GPU falla al detectar, se queda solo "CPU"
var mediaStream = null;        // Flujo de la cámara abierto actualmente
var animationFrameId = null;
var isRunning = false;         // true mientras el bucle de detección está activo
var isBusy = false;            // true mientras se abre la cámara o se recrea el detector
var isMirrored = mirrorCheckbox.checked;
var showIndices = showIndicesCheckbox.checked;
var lastVideoTime = -1;        // Evita procesar dos veces el mismo cuadro de video
var lastTimestamp = 0;         // detectForVideo exige marcas de tiempo estrictamente crecientes
var framesSinceStats = 0;
var lastStatsTime = 0;

// Datos de control
var controlPointMode = controlPointSelect.value; // "palm" o "index"
var smoothedPoint = null;      // Punto de control suavizado, en coordenadas de la vista (0-1, "y" hacia abajo)
var stablePose = null;         // Último gesto aceptado: { gesture, fingers }
var candidatePose = null;      // Gesto que se está viendo pero todavía no cumplió GESTURE_HOLD_MS
var candidateSince = 0;
var isPinching = false;        // Estado de la pinza en el cuadro anterior (para la histéresis)
var lastHandSeenTime = 0;
var lastSentData = null;       // Últimos datos emitidos: solo se vuelve a emitir si cambian
var lastSendTime = 0;
var messagesSinceStats = 0;

// ================= Mensajes =================

// Muestra un mensaje de estado y lo replica en la consola. level: info | success | warn | error
function setStatus(level, message) {
  statusText.textContent = message;
  statusText.className = "status status-" + level;
  var method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method]("[manos] " + message);
}

// Traduce los errores al abrir la cámara o cargar el modelo a mensajes accionables
function describeStartError(error) {
  var name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permiso de cámara denegado. Habilítalo desde el ícono de la barra de direcciones y vuelve a intentar.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No se encontró ninguna cámara compatible.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "La cámara está en uso por otra aplicación (Teams, Zoom, OBS…) o no responde.";
  }
  if (name === "ModelLoadError" || name === "CameraTimeoutError") {
    return error.message;
  }
  return "No se pudo iniciar: " + (error && error.message ? error.message : String(error));
}

// ================= Carga de MediaPipe =================

// import() dinámico en vez de un import estático: si el CDN no responde se puede mostrar el error
function loadMediaPipe() {
  if (!mediapipePromise) {
    mediapipePromise = import(MEDIAPIPE_BASE_URL + "/vision_bundle.mjs")
      .then(async function (vision) {
        var wasmFileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_BASE_URL + "/wasm");
        return { HandLandmarker: vision.HandLandmarker, wasmFileset: wasmFileset };
      })
      .catch(function (error) {
        mediapipePromise = null; // Permite reintentar con el siguiente clic
        throw error;
      });
  }
  return mediapipePromise;
}

// Crea el detector probando cada procesador permitido en orden (GPU primero por velocidad)
async function createHandLandmarker() {
  var mediapipe;
  try {
    mediapipe = await loadMediaPipe();
  } catch (error) {
    var loadError = new Error("No se pudo descargar MediaPipe. Revisa la conexión a internet " +
                              "(la librería se carga desde cdn.jsdelivr.net). Detalle: " + error.message);
    loadError.name = "ModelLoadError";
    throw loadError;
  }

  var lastError = null;
  for (var i = 0; i < allowedDelegates.length; i++) {
    var delegate = allowedDelegates[i];
    try {
      var landmarker = await mediapipe.HandLandmarker.createFromOptions(mediapipe.wasmFileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate },
        runningMode: "VIDEO",
        numHands: MAX_HANDS,
        minHandDetectionConfidence: MIN_DETECTION_CONFIDENCE,
        minHandPresenceConfidence: MIN_PRESENCE_CONFIDENCE,
        minTrackingConfidence: MIN_TRACKING_CONFIDENCE
      });
      activeDelegate = delegate;
      return landmarker;
    } catch (error) {
      lastError = error;
      console.warn("[manos] No se pudo crear el detector con " + delegate + ":", error);
    }
  }

  var createError = new Error("No se pudo cargar el modelo de manos. Detalle: " +
                              (lastError && lastError.message ? lastError.message : "desconocido"));
  createError.name = "ModelLoadError";
  throw createError;
}

// Devuelve el detector, creándolo solo la primera vez
function ensureHandLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = createHandLandmarker()
      .then(function (landmarker) {
        handLandmarker = landmarker;
        delegateValue.textContent = activeDelegate;
        return landmarker;
      })
      .catch(function (error) {
        landmarkerPromise = null; // Permite reintentar con el siguiente clic
        throw error;
      });
  }
  return landmarkerPromise;
}

function disposeHandLandmarker() {
  if (handLandmarker) {
    try {
      handLandmarker.close();
    } catch (error) {
      // El detector ya pudo quedar inutilizable tras el error; no hay nada más que liberar
    }
  }
  handLandmarker = null;
  landmarkerPromise = null;
  activeDelegate = null;
  delegateValue.textContent = "–";
}

// ================= Cámara =================

// Espera a que el video conozca sus dimensiones; algunas cámaras tardan o nunca responden
function waitForVideoMetadata() {
  if (video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      cleanup();
      var timeoutError = new Error("La cámara no entregó imagen en " + (CAMERA_TIMEOUT_MS / 1000) + " s.");
      timeoutError.name = "CameraTimeoutError";
      reject(timeoutError);
    }, CAMERA_TIMEOUT_MS);

    function onLoaded() {
      cleanup();
      resolve();
    }

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoaded);
    }

    video.addEventListener("loadedmetadata", onLoaded);
  });
}

// Ajusta el canvas a la resolución real del video para que cada nodo caiga en su lugar
function resizeOverlay() {
  var width = video.videoWidth;
  var height = video.videoHeight;
  if (!width || !height) {
    return;
  }
  overlay.width = width;
  overlay.height = height;
  // El CSS usa esta proporción para dimensionar el escenario sin deformar la imagen
  stage.style.setProperty("--video-ratio", String(width / height));
}

function onTrackEnded() {
  stopCamera();
  setStatus("warn", "La cámara se desconectó o la liberó otra aplicación.");
}

function releaseStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(function (track) {
      track.removeEventListener("ended", onTrackEnded);
      track.stop();
    });
    mediaStream = null;
  }
  video.srcObject = null;
  lastVideoTime = -1;
}

async function startCamera() {
  if (isBusy || isRunning) {
    return;
  }

  if (!isCameraSupported) {
    setStatus("error", describeUnsupported());
    return;
  }

  setBusy(true);
  setStatus("info", "Solicitando acceso a la cámara…");

  // Cámara y modelo se piden en paralelo para arrancar antes.
  // El catch vacío solo evita el aviso de "promesa rechazada sin manejar"; el error se trata en el await.
  var landmarkerTask = ensureHandLandmarker();
  landmarkerTask.catch(function () {});

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    mediaStream.getVideoTracks().forEach(function (track) {
      track.addEventListener("ended", onTrackEnded);
    });

    video.srcObject = mediaStream;
    await waitForVideoMetadata();
    await video.play();
    resizeOverlay();

    if (!handLandmarker) {
      setStatus("info", "Cámara lista. Cargando el modelo de manos…");
    }
    await landmarkerTask;

    // Caso borde: la cámara pudo desconectarse mientras se cargaba el modelo
    if (!mediaStream) {
      return;
    }

    startDetectionLoop();
    setStatus("success", "Detectando manos con " + activeDelegate + ". Muestra tus manos a la cámara.");
  } catch (error) {
    releaseStream();
    setStatus("error", describeStartError(error));
  } finally {
    setBusy(false);
  }
}

function stopCamera() {
  stopDetectionLoop();
  releaseStream();
  resetControlState();
  sendControlData(true); // Avisa SIN_MANO aunque el bucle de detección ya no corra
  clearOverlay();
  resetReadouts();
  updateUi();
}

// ================= Detección =================

function startDetectionLoop() {
  isRunning = true;
  framesSinceStats = 0;
  lastStatsTime = performance.now();
  updateUi();
  animationFrameId = requestAnimationFrame(detectionLoop);
}

function stopDetectionLoop() {
  isRunning = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function detectionLoop() {
  if (!isRunning) {
    return;
  }
  animationFrameId = requestAnimationFrame(detectionLoop);

  // Sin cuadro nuevo no hay nada que procesar (el monitor suele refrescar más rápido que la cámara)
  if (video.readyState < HAVE_CURRENT_DATA || video.currentTime === lastVideoTime) {
    return;
  }
  lastVideoTime = video.currentTime;

  // La resolución puede cambiar en marcha (p. ej. al rotar un celular)
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    resizeOverlay();
  }

  var timestamp = Math.max(performance.now(), lastTimestamp + 1);
  lastTimestamp = timestamp;

  var result;
  try {
    result = handLandmarker.detectForVideo(video, timestamp);
  } catch (error) {
    handleDetectionError(error);
    return;
  }

  updateControl(result, timestamp);
  drawResult(result);
  framesSinceStats++;

  if (timestamp - lastStatsTime >= STATS_INTERVAL_MS) {
    updateReadouts(result, timestamp);
  }
}

// La GPU puede fallar recién al procesar (driver, contexto WebGL perdido): se reintenta una vez con CPU
async function handleDetectionError(error) {
  stopDetectionLoop();
  console.error("[manos] Error en detectForVideo:", error);

  if (activeDelegate !== "GPU") {
    stopCamera();
    setStatus("error", isWebGlAvailable()
      ? "Error al detectar manos: " + error.message
      : "Error al detectar manos: el navegador no tiene WebGL, que MediaPipe necesita para leer el video " +
        "(también en modo CPU). Activa la aceleración por hardware del navegador y recarga la página.");
    return;
  }

  setBusy(true);
  setStatus("warn", "Falló el procesamiento por GPU; reintentando con CPU…");
  allowedDelegates = ["CPU"];
  disposeHandLandmarker();

  try {
    await ensureHandLandmarker();
    if (mediaStream) {
      startDetectionLoop();
      setStatus("success", "Detectando manos con CPU (la GPU no funcionó en este equipo).");
    }
  } catch (retryError) {
    stopCamera();
    setStatus("error", describeStartError(retryError));
  } finally {
    setBusy(false);
  }
}

// Comprueba si el navegador puede crear un contexto WebGL (se libera enseguida para no acumular contextos)
function isWebGlAvailable() {
  try {
    var gl = document.createElement("canvas").getContext("webgl2") ||
             document.createElement("canvas").getContext("webgl");
    var loseContext = gl && gl.getExtension("WEBGL_lose_context");
    if (loseContext) {
      loseContext.loseContext();
    }
    return Boolean(gl);
  } catch (error) {
    return false;
  }
}

// ================= Datos de control =================

function distance(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  var dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isCompleteHand(landmarks) {
  return Boolean(landmarks) && landmarks.length >= LANDMARK_COUNT;
}

// Promedio de los nodos elegidos, en coordenadas de la vista: 0-1, con espejo si corresponde y "y" hacia abajo
function getControlPoint(landmarks) {
  var nodes = CONTROL_POINT_NODES[controlPointMode] || CONTROL_POINT_NODES.palm;
  var sumX = 0;
  var sumY = 0;
  nodes.forEach(function (node) {
    sumX += landmarks[node].x;
    sumY += landmarks[node].y;
  });
  var x = sumX / nodes.length;
  return { x: isMirrored ? 1 - x : x, y: sumY / nodes.length };
}

// Con dos manos en cuadro se sigue a la más cercana a la posición anterior, para no saltar de una a otra.
// Devuelve -1 si no hay ninguna mano completa.
function pickControlHand(hands) {
  var bestIndex = -1;
  var bestGap = Infinity;
  hands.forEach(function (landmarks, index) {
    if (!isCompleteHand(landmarks)) {
      return;
    }
    if (!smoothedPoint) {
      if (bestIndex === -1) {
        bestIndex = index;
      }
      return;
    }
    var point = getControlPoint(landmarks);
    var gap = Math.hypot(point.x - smoothedPoint.x, point.y - smoothedPoint.y);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  });
  return bestIndex;
}

// Para medir los dedos se usan las coordenadas 3D en metros (worldLandmarks): no dependen de la distancia
// a la cámara ni de la proporción del video. Si no vinieran, se usan las de la imagen pasadas a píxeles.
function getGeometryPoints(result, handIndex) {
  var world = result.worldLandmarks && result.worldLandmarks[handIndex];
  if (isCompleteHand(world)) {
    return world;
  }
  return result.landmarks[handIndex].map(function (landmark) {
    return { x: landmark.x * overlay.width, y: landmark.y * overlay.height, z: landmark.z * overlay.width };
  });
}

// Reconoce el gesto comparando, en cada dedo, qué tan lejos de la muñeca queda la punta
function classifyPose(points, wasPinching) {
  var palmLength = distance(points[WRIST], points[MIDDLE_KNUCKLE]);
  if (!(palmLength > 0)) {
    return null; // Caso borde: nodos superpuestos, no hay nada que medir
  }

  var ratios = LONG_FINGERS.map(function (finger) {
    var pipDistance = distance(points[finger.pip], points[WRIST]);
    return pipDistance > 0 ? distance(points[finger.tip], points[WRIST]) / pipDistance : 0;
  });
  var extended = ratios.map(function (ratio) {
    return ratio > FINGER_EXTENDED_RATIO;
  });
  var isThumbExtended = distance(points[THUMB_TIP], points[MIDDLE_KNUCKLE]) >
                        distance(points[THUMB_KNUCKLE], points[MIDDLE_KNUCKLE]) * THUMB_EXTENDED_RATIO;
  var fingers = extended.filter(Boolean).length + (isThumbExtended ? 1 : 0);

  // En un puño la punta del pulgar también queda cerca del índice: por eso se exige que el índice no esté cerrado del todo
  var pinchRatio = distance(points[THUMB_TIP], points[INDEX_FINGERTIP]) / palmLength;
  var isPinch = ratios[0] > FINGER_CURLED_RATIO &&
                pinchRatio < (wasPinching ? PINCH_OFF_RATIO : PINCH_ON_RATIO);

  var onlyIndex = extended[0] && !extended[1] && !extended[2] && !extended[3];
  var indexAndMiddle = extended[0] && extended[1] && !extended[2] && !extended[3];
  var gesture = "OTRO";

  if (isPinch) {
    gesture = "PINZA";
  } else if (extended.indexOf(true) === -1) {
    gesture = "CERRADA"; // El pulgar no cuenta: con el pulgar arriba también es mano cerrada (Dedos: 1)
  } else if (fingers === 5) {
    gesture = "ABIERTA";
  } else if (onlyIndex) {
    gesture = "INDICE";
  } else if (indexAndMiddle) {
    gesture = "V";
  }

  return { gesture: gesture, fingers: fingers, isPinch: isPinch };
}

function isSamePose(a, b) {
  return Boolean(a) && Boolean(b) && a.gesture === b.gesture && a.fingers === b.fingers;
}

// Un gesto nuevo se acepta recién cuando se mantuvo GESTURE_HOLD_MS; el primero se acepta enseguida
function updateStablePose(pose, now) {
  if (!stablePose || isSamePose(pose, stablePose)) {
    stablePose = pose;
    candidatePose = null;
    return;
  }
  if (!isSamePose(pose, candidatePose)) {
    candidatePose = pose;
    candidateSince = now;
    return;
  }
  if (now - candidateSince >= GESTURE_HOLD_MS) {
    stablePose = pose;
    candidatePose = null;
  }
}

// Coordenada de la vista (0-1) a entero de 0 a OUTPUT_MAX, descontando los márgenes
function toOutput(value) {
  var t = (value - CONTROL_MARGIN) / (1 - 2 * CONTROL_MARGIN);
  return Math.round(Math.min(Math.max(t, 0), 1) * OUTPUT_MAX);
}

// Datos listos para enviar. En la imagen "y" crece hacia abajo: se invierte para que subir la mano aumente Y
function getControlData() {
  if (!smoothedPoint || !stablePose) {
    return { hasHand: false };
  }
  return {
    hasHand: true,
    x: toOutput(smoothedPoint.x),
    y: toOutput(1 - smoothedPoint.y),
    fingers: stablePose.fingers,
    gesture: stablePose.gesture
  };
}

// Zona muerta: se ignoran los cambios chicos, pero los extremos (0 y OUTPUT_MAX) se envían siempre para poder llegar a ellos
function hasPositionChanged(value, lastValue) {
  return value !== lastValue &&
         (Math.abs(value - lastValue) >= POSITION_DEADBAND || value === 0 || value === OUTPUT_MAX);
}

function hasMeaningfulChange(data, last) {
  if (!last || data.hasHand !== last.hasHand) {
    return true;
  }
  if (!data.hasHand) {
    return false;
  }
  return data.gesture !== last.gesture || data.fingers !== last.fingers ||
         hasPositionChanged(data.x, last.x) || hasPositionChanged(data.y, last.y);
}

function renderControlData(data, message) {
  controlXValue.textContent = data.hasHand ? String(data.x) : "–";
  controlYValue.textContent = data.hasHand ? String(data.y) : "–";
  fingersValue.textContent = data.hasHand ? String(data.fingers) : "–";
  gestureValue.textContent = data.hasHand ? GESTURE_LABELS[data.gesture] || data.gesture : "Sin mano";
  messageValue.textContent = message;
}

// Emite los datos solo si cambiaron y como máximo cada sendIntervalMs (force ignora el intervalo, p. ej. al detener).
// Se mide con la hora real del envío y no con la del cuadro: la detección no tarda siempre lo mismo.
function sendControlData(force) {
  var now = performance.now();
  if (!force && now - lastSendTime < sendIntervalMs) {
    return;
  }

  var data = getControlData();
  if (!hasMeaningfulChange(data, lastSentData)) {
    return;
  }

  var message = formatMessage(data);
  lastSendTime = now;
  lastSentData = data;
  messagesSinceStats++;
  renderControlData(data, message);

  // La página decide adónde va cada mensaje: al Arduino por USB (versión local) o al broker MQTT (emisor)
  window.dispatchEvent(new CustomEvent("handcontrol", { detail: { data: data, message: message } }));
}

function resetControlState() {
  smoothedPoint = null;
  stablePose = null;
  candidatePose = null;
  isPinching = false;
}

// Se llama en cada cuadro: elige la mano, suaviza su posición, reconoce el gesto y emite si corresponde
function updateControl(result, now) {
  var hands = result && result.landmarks ? result.landmarks : [];
  var handIndex = pickControlHand(hands);

  if (handIndex === -1) {
    // Perder la mano un cuadro suele ser un parpadeo del detector: se avisa recién después de HAND_LOST_MS
    if (now - lastHandSeenTime >= HAND_LOST_MS) {
      resetControlState();
    }
    sendControlData(false);
    return;
  }

  lastHandSeenTime = now;
  var point = getControlPoint(hands[handIndex]);
  if (smoothedPoint) {
    // Suavizado exponencial: se avanza solo una parte del camino hacia la medición nueva
    smoothedPoint = {
      x: smoothedPoint.x + (point.x - smoothedPoint.x) * SMOOTHING_FACTOR,
      y: smoothedPoint.y + (point.y - smoothedPoint.y) * SMOOTHING_FACTOR
    };
  } else {
    smoothedPoint = point;
  }

  var pose = classifyPose(getGeometryPoints(result, handIndex), isPinching);
  if (pose) {
    isPinching = pose.isPinch;
    updateStablePose({ gesture: pose.gesture, fingers: pose.fingers }, now);
  }

  sendControlData(false);
}

// ================= Dibujo =================

// Color de un nodo según su dedo: 0 es la muñeca (palma) y cada dedo ocupa 4 nodos seguidos
function nodeColor(index) {
  var part = HAND_PARTS[Math.ceil(index / 4)];
  return part ? part.color : LABEL_COLOR;
}

// Convierte un nodo (coordenadas normalizadas 0-1) a píxeles del canvas, espejando si corresponde
function toCanvasPoint(landmark) {
  var x = isMirrored ? 1 - landmark.x : landmark.x;
  return { x: x * overlay.width, y: landmark.y * overlay.height };
}

function getHandedness(result, handIndex) {
  // "handednesses" es el nombre antiguo (obsoleto); se usa solo como respaldo
  var list = result.handedness || result.handednesses || [];
  var category = list[handIndex] && list[handIndex][0];
  if (!category) {
    return null;
  }

  var label = category.categoryName;
  if (SWAP_HANDEDNESS) {
    label = label === "Left" ? "Right" : label === "Right" ? "Left" : label;
  }
  return { name: HAND_NAMES[label] || label || "Mano", score: category.score };
}

// Texto blanco con contorno oscuro; se ajusta para que no se salga por los bordes del canvas
function drawLabel(text, x, y, fontSize, align) {
  context.font = "600 " + fontSize + "px system-ui, sans-serif";
  context.textAlign = align;

  var width = context.measureText(text).width;
  var margin = fontSize / 2;
  var minX = align === "center" ? width / 2 + margin : margin;
  var maxX = overlay.width - (align === "center" ? width / 2 : width) - margin;
  x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  y = Math.min(Math.max(y, fontSize), overlay.height - fontSize);

  context.lineWidth = Math.max(2, fontSize / 4);
  context.strokeStyle = OUTLINE_COLOR;
  context.strokeText(text, x, y);
  context.fillStyle = LABEL_COLOR;
  context.fillText(text, x, y);
}

function drawHand(landmarks, handedness, scale) {
  var points = landmarks.map(toCanvasPoint);

  context.lineCap = "round";
  context.lineJoin = "round";

  // Huesos: primero un contorno oscuro ancho y encima el color del dedo
  HAND_PARTS.forEach(function (part) {
    part.connections.forEach(function (pair) {
      var start = points[pair[0]];
      var end = points[pair[1]];
      if (!start || !end) {
        return;
      }
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.strokeStyle = OUTLINE_COLOR;
      context.lineWidth = 6 * scale;
      context.stroke();
      context.strokeStyle = part.color;
      context.lineWidth = 3 * scale;
      context.stroke();
    });
  });

  // Nodos: las puntas de los dedos un poco más grandes
  points.forEach(function (point, index) {
    var radius = (FINGERTIPS.indexOf(index) !== -1 ? 7 : 5) * scale;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = nodeColor(index);
    context.fill();
    context.lineWidth = 2 * scale;
    context.strokeStyle = OUTLINE_COLOR;
    context.stroke();
  });

  context.textBaseline = "middle";

  if (showIndices) {
    points.forEach(function (point, index) {
      drawLabel(String(index), point.x + 8 * scale, point.y - 8 * scale, Math.round(11 * scale), "left");
    });
  }

  // Lateralidad y confianza debajo de la muñeca, o encima si la muñeca está en el borde inferior
  if (handedness && points[0]) {
    var fontSize = Math.round(14 * scale);
    var offset = 24 * scale;
    var wrist = points[0];
    var labelY = wrist.y + offset + fontSize <= overlay.height ? wrist.y + offset : wrist.y - offset;
    var text = handedness.name + " " + Math.round(handedness.score * 100) + "%";
    drawLabel(text, wrist.x, labelY, fontSize, "center");
  }
}

// Grosores proporcionales a la resolución: se ven igual con cámaras de 480p o 1080p
function getDrawScale() {
  return Math.max(1, overlay.width / 640);
}

// Recuadro punteado: la zona en la que X e Y recorren de 0 a OUTPUT_MAX
function drawControlArea(scale) {
  var left = CONTROL_MARGIN * overlay.width;
  var top = CONTROL_MARGIN * overlay.height;
  context.setLineDash([8 * scale, 8 * scale]);
  context.lineWidth = 2 * scale;
  context.strokeStyle = CONTROL_AREA_COLOR;
  context.strokeRect(left, top, overlay.width - 2 * left, overlay.height - 2 * top);
  context.setLineDash([]);
}

// Punto que mueve X/Y: anillo con una cruz al centro; se rellena mientras hay una pinza
function drawControlMarker(scale) {
  var data = getControlData();
  if (!data.hasHand) {
    return;
  }

  var x = smoothedPoint.x * overlay.width;
  var y = smoothedPoint.y * overlay.height;
  var radius = 14 * scale;
  var cross = 6 * scale;

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  if (data.gesture === "PINZA") {
    context.fillStyle = CONTROL_MARKER_FILL;
    context.fill();
  }
  context.moveTo(x - cross, y);
  context.lineTo(x + cross, y);
  context.moveTo(x, y - cross);
  context.lineTo(x, y + cross);
  context.lineWidth = 5 * scale;
  context.strokeStyle = OUTLINE_COLOR;
  context.stroke();
  context.lineWidth = 2.5 * scale;
  context.strokeStyle = CONTROL_MARKER_COLOR;
  context.stroke();

  context.textBaseline = "middle";
  drawLabel("X " + data.x + " · Y " + data.y, x, y - radius - 14 * scale, Math.round(13 * scale), "center");
}

function drawResult(result) {
  clearOverlay();
  var scale = getDrawScale();
  drawControlArea(scale);
  var hands = result && result.landmarks ? result.landmarks : [];
  hands.forEach(function (landmarks, handIndex) {
    drawHand(landmarks, getHandedness(result, handIndex), scale);
  });
  // Al final, para que el punto de control quede encima de los dedos
  drawControlMarker(scale);
}

function clearOverlay() {
  context.clearRect(0, 0, overlay.width, overlay.height);
}

// ================= Indicadores =================

// Ancho fijo para que los números no "bailen" al cambiar de signo: "x  0.52", "z -0.04"
function formatCoordinate(axis, value) {
  return axis + " " + value.toFixed(2).padStart(5, " ");
}

function addHandDataRow(parts) {
  var item = document.createElement("li");
  parts.forEach(function (part) {
    var span = document.createElement("span");
    span.className = part.className || "";
    span.textContent = part.text; // textContent: nunca se interpreta como HTML
    item.appendChild(span);
  });
  handDataList.appendChild(item);
}

function updateReadouts(result, now) {
  var hands = result && result.landmarks ? result.landmarks : [];
  var elapsedSeconds = (now - lastStatsTime) / 1000;

  handsValue.textContent = String(hands.length);
  fpsValue.textContent = elapsedSeconds > 0 ? String(Math.round(framesSinceStats / elapsedSeconds)) : "–";
  messageRateValue.textContent = (elapsedSeconds > 0 ? Math.round(messagesSinceStats / elapsedSeconds) : "–") + " msg/s";
  framesSinceStats = 0;
  messagesSinceStats = 0;
  lastStatsTime = now;

  handDataList.textContent = "";
  if (hands.length === 0) {
    addHandDataRow([{ className: "hand-empty", text: "No hay manos en cuadro." }]);
    return;
  }

  hands.forEach(function (landmarks, handIndex) {
    var handedness = getHandedness(result, handIndex);
    var tip = landmarks[INDEX_FINGERTIP];
    var name = handedness
      ? handedness.name + " " + Math.round(handedness.score * 100) + "%"
      : "Mano " + (handIndex + 1);

    if (!tip) {
      addHandDataRow([{ className: "hand-name", text: name }, { text: "sin datos del nodo 8" }]);
      return;
    }

    // x se informa como se ve en pantalla: con vista espejo, mover la mano a la derecha aumenta x
    var x = isMirrored ? 1 - tip.x : tip.x;
    addHandDataRow([
      { className: "hand-name", text: name },
      { text: formatCoordinate("x", x) },
      { text: formatCoordinate("y", tip.y) },
      { text: formatCoordinate("z", tip.z) }
    ]);
  });
}

function resetReadouts() {
  handsValue.textContent = "0";
  fpsValue.textContent = "–";
  messageRateValue.textContent = "– msg/s";
  messagesSinceStats = 0;
  handDataList.textContent = "";
  addHandDataRow([{ className: "hand-empty", text: "Cámara apagada." }]);
}

// ================= Interfaz =================

function setBusy(value) {
  isBusy = value;
  updateUi();
}

function updateUi() {
  var isLive = mediaStream !== null;
  cameraButton.textContent = isLive || isRunning ? "Detener cámara" : "Iniciar cámara";
  cameraButton.disabled = !isCameraSupported || isBusy;
  stage.classList.toggle("is-live", isLive);
  stagePlaceholder.textContent = isBusy ? "Iniciando…" : "Cámara apagada";
}

function describeUnsupported() {
  if (!window.isSecureContext) {
    return "El navegador solo permite la cámara en orígenes seguros. Abre la página desde " +
           "http://localhost (con un servidor local), no con doble clic / file://.";
  }
  return "Este navegador no permite acceder a la cámara (falta navigator.mediaDevices.getUserMedia).";
}

// ================= Arranque =================

// Mensaje que representa el estado actual: sirve para enviarlo apenas se conecta un Arduino o se recibe el control
export function getCurrentMessage() {
  return formatMessage(lastSentData || { hasHand: false });
}

// Conecta los controles de la página y precarga el modelo.
// options.sendIntervalMs: tiempo mínimo entre mensajes (100 ms en la versión local, más en la remota)
export function initHandTracker(options) {
  var requestedInterval = options && Number(options.sendIntervalMs);
  if (Number.isFinite(requestedInterval) && requestedInterval >= MIN_SEND_INTERVAL_MS) {
    sendIntervalMs = requestedInterval;
  }

  cameraButton.addEventListener("click", function () {
    if (isRunning || mediaStream) {
      stopCamera();
      setStatus("info", "Cámara detenida.");
    } else {
      startCamera();
    }
  });

  showIndicesCheckbox.addEventListener("change", function () {
    showIndices = showIndicesCheckbox.checked;
  });

  mirrorCheckbox.addEventListener("change", function () {
    isMirrored = mirrorCheckbox.checked;
    stage.classList.toggle("is-mirrored", isMirrored);
    smoothedPoint = null; // La posición guardada quedó del otro lado: se arranca desde la medición nueva
  });

  controlPointSelect.addEventListener("change", function () {
    controlPointMode = controlPointSelect.value;
    smoothedPoint = null; // Evita que el punto se "deslice" desde el nodo anterior hasta el nuevo
  });

  controlHint.textContent = "X e Y: de 0 a " + OUTPUT_MAX + " dentro del recuadro punteado (Y crece hacia arriba). " +
                            "Se envía solo cuando algo cambia, como máximo " +
                            Math.round(1000 / sendIntervalMs) + " por segundo.";
  renderControlData({ hasHand: false }, NO_HAND_MESSAGE);
  resetReadouts();
  updateUi();

  if (!isCameraSupported) {
    setStatus("error", describeUnsupported());
  } else {
    // Se precarga el modelo mientras el usuario decide; así la detección arranca enseguida
    setStatus("info", "Cargando MediaPipe y el modelo de manos…");
    ensureHandLandmarker()
      .then(function () {
        if (!isBusy && !isRunning) {
          setStatus("success", "Modelo listo (" + activeDelegate + "). Pulsa «Iniciar cámara».");
        }
      })
      .catch(function (error) {
        if (!isBusy && !isRunning) {
          setStatus("error", describeStartError(error) + " Pulsa «Iniciar cámara» para reintentar.");
        }
      });
  }

  return { getCurrentMessage: getCurrentMessage };
}
