// Video en vivo del brazo con VDO.Ninja (https://vdo.ninja): video por WebRTC entre navegadores, sin servidor propio.
// El receptor publica la cámara del brazo en un iframe (?push=ID) y cada emisor la mira en otro iframe (?view=ID).
// El ID y la clave se generan al azar cada vez que se enciende la cámara y viajan por MQTT en <raíz>/<sala>/video,
// que solo pueden leer los usuarios del broker: el link nunca queda escrito en la página ni en el repositorio.
// Parámetros verificados en https://docs.vdo.ninja el 2026-11-10.

var ID_LENGTH = 12;
var PASSWORD_LENGTH = 16; // VDO.Ninja acepta claves alfanuméricas de 1 a 49 caracteres
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// 248 es el mayor múltiplo de 62 que entra en un byte: los bytes ≥ 248 se descartan para que todas las letras
// tengan la misma probabilidad (con el resto directo, las primeras saldrían un poco más seguido)
var UNBIASED_LIMIT = 248;

// Mensaje retenido en el topic de video: "VIDEO <id> <clave>". Vacío = la cámara del brazo está apagada
var VIDEO_PATTERN = /^VIDEO ([A-Za-z0-9]{12}) ([A-Za-z0-9]{16})$/;

// Permisos de cada iframe. El del emisor no incluye cámara ni micrófono: aunque quisiera, no podría usar
// la webcam del alumno. El del receptor pide solo la cámara (el audio se desactiva con audiodevice=0)
export var PUSH_FRAME_ALLOW = "camera; autoplay; fullscreen";
export var VIEW_FRAME_ALLOW = "autoplay; fullscreen; picture-in-picture";

// Texto al azar con crypto.getRandomValues: la clave tiene que ser impredecible (Math.random no lo es)
function randomText(length) {
  var result = "";
  var bytes = new Uint8Array(length * 2);
  while (result.length < length) {
    crypto.getRandomValues(bytes);
    for (var i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < UNBIASED_LIMIT) {
        result += ALPHABET[bytes[i] % ALPHABET.length];
      }
    }
  }
  return result;
}

// Datos nuevos en cada encendido: un link viejo deja de funcionar al apagar la cámara
export function createVideoSession() {
  return { id: randomText(ID_LENGTH), password: randomText(PASSWORD_LENGTH) };
}

export function formatVideoMessage(videoSession) {
  return videoSession ? "VIDEO " + videoSession.id + " " + videoSession.password : "";
}

// Devuelve { id, password } o null. Formato exacto: lo que llega por internet nunca se mete tal cual en un link
export function parseVideoMessage(text) {
  var match = VIDEO_PATTERN.exec(String(text).trim());
  return match ? { id: match[1], password: match[2] } : null;
}

// VDO.Ninja usa parámetros sin valor (&webcam), que URLSearchParams escribiría como "webcam=": se arma a mano.
// params: lista de [nombre] o [nombre, valor]
function buildUrl(baseUrl, params) {
  return baseUrl + "?" + params.map(function (param) {
    return param.length === 1 ? param[0] : param[0] + "=" + encodeURIComponent(param[1]);
  }).join("&");
}

// Publicador (receptor). options: { baseUrl, maxBitrateKbps, deviceLabel }
// webcam + autostart: arranca la cámara sin la pantalla de selección de VDO.Ninja.
// videodevice elige la cámara por nombre (VDO.Ninja acepta "_" en lugar de los espacios); sin nombre usa la predeterminada.
// maxvideobitrate es el tope por cada alumno que mira, en kbps
export function buildPushUrl(videoSession, options) {
  var params = [
    ["push", videoSession.id],
    ["password", videoSession.password],
    ["webcam"],
    ["autostart"],
    ["audiodevice", "0"],
    ["cleanoutput"],
    ["maxvideobitrate", String(options.maxBitrateKbps)]
  ];
  if (options.deviceLabel) {
    params.push(["videodevice", options.deviceLabel.trim().replace(/\s+/g, "_")]);
  }
  return buildUrl(options.baseUrl, params);
}

// Visor (emisor): solo video y sin los botones de VDO.Ninja. Si se abre antes que el publicador, conecta solo
// cuando aparece el stream
export function buildViewUrl(videoSession, options) {
  return buildUrl(options.baseUrl, [
    ["view", videoSession.id],
    ["password", videoSession.password],
    ["noaudio"],
    ["cleanoutput"]
  ]);
}

export function createVideoFrame(url, allow, title) {
  var frame = document.createElement("iframe");
  frame.className = "video-frame";
  frame.src = url;
  frame.allow = allow;
  frame.title = title;
  return frame;
}

// Nombres de las cámaras del equipo. El navegador solo los informa si la página ya tiene permiso de cámara:
// por eso se pide un instante y se libera enseguida (el iframe de VDO.Ninja la abre después por su cuenta)
export async function listCameraLabels() {
  var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  stream.getTracks().forEach(function (track) {
    track.stop();
  });
  var devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(function (device) {
      return device.kind === "videoinput" && device.label;
    })
    .map(function (device) {
      return device.label;
    });
}

// Mensajes accionables para los errores al pedir la cámara
export function describeCameraError(error) {
  var name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permiso de cámara denegado. Habilítalo desde el ícono de la barra de direcciones.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No se encontró ninguna cámara en este equipo.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "La cámara está en uso por otra aplicación (Teams, Zoom, OBS…) o no responde.";
  }
  return "No se pudo acceder a la cámara: " + (error && error.message ? error.message : String(error));
}
