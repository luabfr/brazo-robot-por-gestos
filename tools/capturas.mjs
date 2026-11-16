// Genera las capturas ilustrativas de la infografía (assets/capturas/): el emisor y el receptor funcionando de
// verdad, con datos de ejemplo. Corre las páginas en navegadores headless (Edge o Chrome) conectados entre sí:
// - "profesor": receptor.html, con la foto del brazo como cámara y un Arduino simulado por Web Serial
//   (responde como arduino/brazo_2_motores);
// - "ana": emisor.html, con la foto de unas manos como cámara y el control del robot;
// - "alumnos": beto y caro conectados, para que la lista del profesor tenga gente;
// - "local": hand-tracking.html (la versión local), con la misma foto y otro Arduino simulado, al final y solo.
// Todos usan el broker público de pruebas en una sala al azar. No se usan credenciales ni datos de nadie.
// Las manos no las detecta MediaPipe sino los puntos que ya trae dibujados la foto (ver «MediaPipe de reemplazo»).
//
// Además de las imágenes, escribe assets/capturas/capturas.json con la ubicación de los elementos señalados
// (en % de cada imagen): así las anotaciones numeradas de la infografía siguen en su lugar si cambia la página.
// También genera las miniaturas de las tarjetas de la portada (portada-*.webp).
//
// Las funciones de navegador y servidor se exportan: tools/vista-previa.mjs las usa para la imagen de redes.
//
// Uso:   node tools/capturas.mjs --mano <foto de manos> [--brazo <foto del brazo>]
// Requisitos: Node 22 o posterior, Edge o Chrome instalado (o su ruta en la variable NAVEGADOR) e internet
// (broker público, MediaPipe y VDO.Ninja).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

var ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
var OUTPUT_DIR = join(ROOT, "assets", "capturas");
var PUBLIC_BROKER = "wss://broker.emqx.io:8084/mqtt";
var VIEWPORT = { width: 1440, height: 900 };
var SCALE = 2;              // Los recortes se guardan al doble de resolución: se ven nítidos en pantallas de alta densidad
var CLIP_PADDING = 10;      // px de aire alrededor de cada recorte
var WEBP_QUALITY = 80;
var THUMB_SCALE = 0.28;     // Miniaturas de la portada: la pantalla de 1440 px queda en unos 800 px de ancho
var BROWSER_CANDIDATES = [
  process.env.NAVEGADOR,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
];

// ================= Capturas: qué se recorta y qué se señala =================
// clip: elementos cuyo contorno (unidos) forma el recorte. hotspots: elementos a numerar en la infografía; un
// selector marca el rectángulo del elemento, y { selector, at: [x, y] } un punto dentro de él (en 0..1).
// full: la página entera. thumb: lo que entra en la pantalla, chico (miniatura de la portada).
// Los textos de las anotaciones están en js/arquitectura-contenido.js (CAPTURES); acá solo va la geometría

var SHOTS = [
  { id: "receptor", page: "profesor", full: true },
  {
    id: "receptor-alumnos", page: "profesor", clip: ["section.students", "section.control"],
    hotspots: { lista: "#studentList", control: "#studentList .btn-secondary", datos: "section.control .stats", mensaje: "section.control .message" }
  },
  {
    id: "receptor-arduino", page: "profesor", clip: ["section.serial"],
    hotspots: { puerto: "section.serial .port-row", estado: "section.serial .connection-status", brazo: "#armStatus" }
  },
  {
    id: "receptor-camara", page: "profesor", clip: ["section.video-panel"],
    hotspots: { boton: "#videoButton", estado: "section.video-panel .connection-status", video: "#pushBox" }
  },
  { id: "emisor", page: "ana", full: true },
  {
    id: "emisor-camara", page: "ana", clip: [".camera-area"],
    // Los nodos se señalan sobre una de las manos (en la foto de origen, a la derecha del cuadro)
    hotspots: { nodos: { selector: "#overlay", at: [0.7, 0.42] }, meta: "#stage .stage-meta", datos: ".hand-data" }
  },
  {
    id: "emisor-conexion", page: "ana", clip: ["section.mqtt-panel"],
    hotspots: { estado: "section.mqtt-panel .connection-status", control: "#controlBadge", envio: "#sentRateValue" }
  },
  {
    id: "emisor-envio", page: "ana", clip: ["section.control"],
    hotspots: { datos: "section.control .stats", mensaje: "section.control .message" }
  },
  {
    id: "emisor-brazo", page: "ana", clip: [".stream-area"],
    hotspots: { video: "#streamBox", vivo: "#streamLabel", estado: "#robotHud" }
  },
  { id: "local", page: "local", full: true },
  { id: "portada-emisor", page: "ana", thumb: true },
  { id: "portada-receptor", page: "profesor", thumb: true },
  { id: "portada-local", page: "local", thumb: true }
];

// ================= Arduino simulado (se inyecta en receptor.html y hand-tracking.html) =================
// Reemplaza navigator.serial por un puerto que contesta como el sketch del brazo: "LISTO" al abrir y
// "OK: BRAZO <estado> <ángulo> <ángulo>" cuando cambia algo. Mano abierta = derecha, cerrada = izquierda.
// Con window.__brazoQuieto = true deja de avanzar y de informar: el script lo congela antes de las capturas,
// para que todas muestren el mismo ángulo

var FAKE_SERIAL = `(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let output = null;
  let pending = "";
  // Arranca cerca de la izquierda y avanza de a poco: así sigue "moviéndose" (lejos del tope) al sacar las capturas,
  // aunque el video del brazo tarde en llegar
  let angle = 40;
  let lastReport = "";
  const send = (text) => { if (output) { output.enqueue(encoder.encode(text + "\\n")); } };
  const handle = (line) => {
    if (window.__brazoQuieto) { return; }
    const match = /^X:\\d+ Y:\\d+ D:\\d G:(\\w+)$/.exec(line);
    let state = "QUIETO";
    if (match && match[1] === "ABIERTA") { angle = Math.min(160, angle + 0.4); state = angle >= 160 ? "TOPE" : "DERECHA"; }
    if (match && match[1] === "CERRADA") { angle = Math.max(20, angle - 0.4); state = angle <= 20 ? "TOPE" : "IZQUIERDA"; }
    const report = "OK: BRAZO " + state + " " + Math.round(angle) + " " + Math.round(angle);
    if (report !== lastReport) { lastReport = report; send(report); }
  };
  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x0042 }),
    open: async () => {
      port.readable = new ReadableStream({ start(controller) { output = controller; setTimeout(() => send("LISTO: brazo de 2 motores en pines 5 6. Mano cerrada = izquierda, abierta = derecha. Prueba: IZQUIERDA, DERECHA, QUIETO, CENTRO"), 400); } });
      port.writable = new WritableStream({ write(chunk) {
        pending += decoder.decode(chunk);
        let index;
        while ((index = pending.indexOf("\\n")) >= 0) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (line) { handle(line); }
        }
      } });
    },
    close: async () => {},
    addEventListener() {},
    removeEventListener() {}
  };
  Object.defineProperty(navigator, "serial", { configurable: true, value: {
    requestPort: async () => port, getPorts: async () => [port], addEventListener() {}, removeEventListener() {}
  } });
})();`;

// ================= MediaPipe de reemplazo =================
// En un navegador headless MediaPipe no detecta manos (ni con GPU emulada ni con CPU). La foto de origen ya
// trae dibujados los 21 puntos de cada mano (puntos rojos, el estilo de dibujo de MediaPipe): el script los lee,
// los ordena como los entrega MediaPipe y los sirve con un módulo de reemplazo. Así el esqueleto que dibuja el
// emisor coincide con el de la foto, y X, Y, dedos y gesto salen del cálculo real de js/hand-tracker.js.
// El servidor cambia solo en memoria la dirección de MediaPipe en hand-tracker.js; el archivo no se toca
var MEDIAPIPE_FAKE_PATH = "/__mediapipe-falso";
var SERVER_PATCHES = {
  "/js/hand-tracker.js": {
    find: 'var MEDIAPIPE_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + MEDIAPIPE_VERSION;',
    replace: 'var MEDIAPIPE_BASE_URL = "' + MEDIAPIPE_FAKE_PATH + '";'
  }
};

// Centros de los puntos rojos de la foto (en 0..1), con un recorrido de píxeles en el navegador
async function findDrawnLandmarks(page, url) {
  return page.evaluate("(async () => {" +
    "const image = new Image(); image.src = " + JSON.stringify(url) + "; await image.decode();" +
    "const w = image.width, h = image.height;" +
    "const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;" +
    "const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);" +
    "const data = context.getImageData(0, 0, w, h).data;" +
    "const isRed = (i) => data[i] > 170 && data[i + 1] < 110 && data[i + 2] < 110 && data[i] - data[i + 1] > 90;" +
    "const seen = new Uint8Array(w * h); const points = [];" +
    "for (let p = 0; p < w * h; p++) {" +
    "  if (seen[p] || !isRed(p * 4)) { continue; }" +
    "  const stack = [p]; seen[p] = 1; let sx = 0, sy = 0, n = 0;" +
    "  while (stack.length) { const q = stack.pop(); const x = q % w, y = (q - x) / w; sx += x; sy += y; n++;" +
    "    for (let dy = -1; dy <= 1; dy++) { for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy;" +
    "      if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; } const r = ny * w + nx;" +
    "      if (!seen[r] && isRed(r * 4)) { seen[r] = 1; stack.push(r); } } } }" +
    "  if (n >= 3) { points.push({ x: (sx / n + 0.5) / w, y: (sy / n + 0.5) / h, size: n }); }" +
    "}" +
    "return { width: w, height: h, points: points }; })()");
}

// Ordena 21 puntos de una mano abierta como MediaPipe: 0 muñeca; 1-4 pulgar; 5-8 índice; 9-12 medio;
// 13-16 anular; 17-20 meñique (cada dedo, de la base a la punta)
function orderHand(points, otherCenterX, aspect) {
  var wrist = points.reduce(function (best, point) {
    return point.y > best.y ? point : best; // La muñeca es el punto más bajo (mano levantada)
  });
  var others = points.filter(function (point) {
    return point !== wrist;
  }).map(function (point) {
    var dx = (point.x - wrist.x) * aspect;
    var dy = wrist.y - point.y;
    return { x: point.x, y: point.y, angle: Math.atan2(dy, dx), distance: Math.hypot(dx, dy) };
  }).sort(function (a, b) {
    return a.angle - b.angle;
  });
  var fingers = [];
  for (var i = 0; i < 5; i++) {
    fingers.push(others.slice(i * 4, i * 4 + 4).sort(function (a, b) {
      return a.distance - b.distance;
    }));
  }
  // El pulgar es el dedo de una punta del abanico más cercano a la otra mano (las palmas miran a la cámara)
  var meanX = function (finger) {
    return finger.reduce(function (sum, point) { return sum + point.x; }, 0) / finger.length;
  };
  if (Math.abs(meanX(fingers[4]) - otherCenterX) < Math.abs(meanX(fingers[0]) - otherCenterX)) {
    fingers.reverse();
  }
  var ordered = [wrist];
  fingers.forEach(function (finger) {
    finger.forEach(function (point) {
      ordered.push(point);
    });
  });
  return ordered.map(function (point, index) {
    // z: la muñeca en 0 y cada dedo un poco más cerca de la cámara hacia la punta (MediaPipe da z negativas)
    var z = index === 0 ? 0 : -0.012 * (((index - 1) % 4) + 1);
    return { x: point.x, y: point.y, z: z };
  });
}

function buildFakeMediapipe(found) {
  if (found.points.length !== 42) {
    throw new Error("En la foto de las manos se encontraron " + found.points.length + " puntos rojos y se esperaban 42 " +
      "(21 por mano, dibujados por MediaPipe). Usá una foto con los puntos dibujados o revisá el umbral de color.");
  }
  var sorted = found.points.slice().sort(function (a, b) {
    return a.x - b.x;
  });
  // Las dos manos se separan donde hay más espacio horizontal entre puntos consecutivos
  var cut = 1;
  for (var i = 1; i < sorted.length; i++) {
    if (sorted[i].x - sorted[i - 1].x > sorted[cut].x - sorted[cut - 1].x) {
      cut = i;
    }
  }
  var left = sorted.slice(0, cut);
  var right = sorted.slice(cut);
  if (left.length !== 21 || right.length !== 21) {
    throw new Error("No se pudieron separar las dos manos de la foto (" + left.length + " y " + right.length + " puntos).");
  }
  var center = function (hand) {
    return hand.reduce(function (sum, point) { return sum + point.x; }, 0) / hand.length;
  };
  var aspect = found.width / found.height;
  var hands = [orderHand(left, center(right), aspect), orderHand(right, center(left), aspect)];
  // Como MediaPipe con una imagen sin espejar: la mano que aparece a la izquierda es la derecha de la persona y
  // MediaPipe la etiqueta "Left" (hand-tracker.js lo corrige con SWAP_HANDEDNESS)
  var handedness = [[{ categoryName: "Left", score: 0.97, index: 0 }], [{ categoryName: "Right", score: 0.96, index: 1 }]];
  return "// Módulo de reemplazo de MediaPipe para las capturas (tools/capturas.mjs): devuelve siempre las mismas manos\n" +
    "const HANDS = " + JSON.stringify(hands) + ";\n" +
    "const HANDEDNESS = " + JSON.stringify(handedness) + ";\n" +
    "export const FilesetResolver = { forVisionTasks: async () => ({}) };\n" +
    "export class HandLandmarker {\n" +
    "  static async createFromOptions() { return new HandLandmarker(); }\n" +
    "  detectForVideo() { return { landmarks: HANDS, handedness: HANDEDNESS, worldLandmarks: [] }; }\n" +
    "  detect() { return this.detectForVideo(); }\n" +
    "  setOptions() {}\n" +
    "  close() {}\n" +
    "}\n";
}

// ================= Utilidades =================

var sleep = function (ms) {
  return new Promise(function (resolveSleep) {
    setTimeout(resolveSleep, ms);
  });
};

function log(text) {
  console.log("[capturas] " + text);
}

function readArgs() {
  var args = process.argv.slice(2);
  var options = { brazo: join(ROOT, "assets", "brazo-robot.webp"), mano: null };
  for (var i = 0; i < args.length; i += 2) {
    var key = args[i].replace(/^--/, "");
    if (!(key in options) || args[i + 1] === undefined) {
      throw new Error("Opción desconocida o sin valor: " + args[i] + ". Uso: node tools/capturas.mjs --mano <foto> [--brazo <foto>]");
    }
    options[key] = resolve(args[i + 1]);
  }
  if (!options.mano) {
    throw new Error("Falta --mano <foto>: una foto de manos abiertas frente a la cámara (con permiso de quien aparece).");
  }
  [options.mano, options.brazo].forEach(function (file) {
    if (!existsSync(file)) {
      throw new Error("No existe el archivo " + file);
    }
  });
  return options;
}

function findBrowser() {
  var path = BROWSER_CANDIDATES.find(function (candidate) {
    return candidate && existsSync(candidate);
  });
  if (!path) {
    throw new Error("No encontré Edge ni Chrome. Indicá la ruta en la variable NAVEGADOR.");
  }
  return path;
}

// ================= Servidor local (las páginas necesitan http para los módulos y la cámara) =================

var MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

// sources: archivos de afuera del proyecto, por ruta fija. virtual: contenido generado en memoria
// ({ body, type }); se puede completar después de arrancar el servidor
function startServer(sources, virtual) {
  return new Promise(function (resolveServer) {
    var server = createServer(async function (request, response) {
      try {
        var path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (virtual[path]) {
          response.writeHead(200, { "Content-Type": virtual[path].type });
          response.end(virtual[path].body);
          return;
        }
        var file = sources[path] || resolve(ROOT, "." + (path === "/" ? "/index.html" : path));
        // Nada fuera de la carpeta del proyecto (salvo las fotos de origen, que se sirven por nombre fijo)
        if (!sources[path] && !(file === ROOT || file.startsWith(ROOT + sep))) {
          response.writeHead(403).end();
          return;
        }
        var body = await readFile(file);
        var patch = SERVER_PATCHES[path];
        if (patch) {
          var text = body.toString("utf8");
          if (!text.includes(patch.find)) {
            log("  aviso: " + path + " cambió y no se pudo reemplazar MediaPipe (revisar SERVER_PATCHES)");
          }
          body = Buffer.from(text.replace(patch.find, patch.replace), "utf8");
        }
        response.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream" });
        response.end(body);
      } catch (error) {
        response.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", function () {
      resolveServer({ server: server, base: "http://127.0.0.1:" + server.address().port });
    });
  });
}

// ================= Navegador y pestañas (Chrome DevTools Protocol) =================

// extraArgs: opciones del navegador para este perfil (p. ej. bloquear un dominio)
async function launchBrowser(browserPath, name, fakeVideo, extraArgs) {
  var profile = await mkdtemp(join(tmpdir(), "capturas-" + name + "-"));
  var args = [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--hide-scrollbars", "--mute-audio",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"
  ];
  if (fakeVideo) {
    args.push("--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + fakeVideo);
  }
  args.push.apply(args, extraArgs || []);
  args.push("about:blank");
  var child = spawn(browserPath, args, { stdio: "ignore" });
  // Con el puerto 0, el navegador elige uno libre y lo escribe en DevToolsActivePort
  for (var i = 0; i < 100; i++) {
    try {
      var port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (port) {
        return { name: name, port: port, child: child, profile: profile };
      }
    } catch (error) {
      // Todavía no arrancó
    }
    await sleep(150);
  }
  child.kill();
  throw new Error("El navegador «" + name + "» no arrancó.");
}

async function openPage(browser, url, options) {
  options = options || {};
  var response = await fetch("http://127.0.0.1:" + browser.port + "/json/new?about:blank", { method: "PUT" });
  var target = await response.json();
  var socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(function (resolveOpen, rejectOpen) {
    socket.addEventListener("open", resolveOpen);
    socket.addEventListener("error", rejectOpen);
  });
  var id = 0;
  var pending = new Map();
  var label = options.label || browser.name;
  socket.addEventListener("message", function (event) {
    var message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === "Runtime.exceptionThrown") {
      var details = message.params.exceptionDetails;
      log("  error en «" + label + "»: " + (details.exception ? details.exception.description : details.text).split("\n")[0]);
    }
  });
  var page = {
    label: label,
    send: function (method, params) {
      return new Promise(function (resolveSend) {
        var messageId = ++id;
        pending.set(messageId, resolveSend);
        socket.send(JSON.stringify({ id: messageId, method: method, params: params || {} }));
      });
    },
    evaluate: async function (expression) {
      var result = await page.send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
      if (result.result.exceptionDetails) {
        throw new Error("en «" + label + "»: " + (result.result.exceptionDetails.exception || {}).description);
      }
      return result.result.result.value;
    },
    waitFor: async function (expression, description, timeoutMs) {
      var deadline = Date.now() + (timeoutMs || 30000);
      while (Date.now() < deadline) {
        try {
          // Una consulta hecha mientras la página navega puede no responder nunca: se corta a los 8 s y se reintenta
          var answer = await Promise.race([page.evaluate(expression), sleep(8000).then(function () {
            return false;
          })]);
          if (answer) {
            return;
          }
        } catch (error) {
          // La página puede estar cargando
        }
        await sleep(300);
      }
      throw new Error("«" + label + "» no llegó a: " + description);
    },
    click: function (selector) {
      return page.evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()");
    },
    fill: function (selector, value) {
      return page.evaluate("(() => { const input = document.querySelector(" + JSON.stringify(selector) + "); input.value = " +
        JSON.stringify(value) + "; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    },
    close: function () {
      socket.close();
    }
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: SCALE, mobile: false });
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "addEventListener('DOMContentLoaded', () => { window.__capturasLista = true; }, { once: true });"
  });
  if (options.script) {
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: options.script });
  }
  // Lista = ya corrieron sus módulos (DOMContentLoaded), aunque falte alguna imagen. Ojo: "interactive" no alcanza,
  // porque los módulos corren después; y una hoja de estilos que no llega (Google Fonts) los frena
  var loaded = "location.href === " + JSON.stringify(url) + " && window.__capturasLista === true";
  try {
    // Con la PC cargada, a veces la primera orden de navegar no llega a la pestaña: se reintenta una vez
    for (var attempt = 1; attempt <= 2; attempt++) {
      var navigation = await page.send("Page.navigate", { url: url });
      if (navigation.result && navigation.result.errorText) {
        log("  aviso: «" + label + "» no pudo abrir " + url + " (" + navigation.result.errorText + ")");
      }
      try {
        await page.waitFor(loaded, "cargar " + url, attempt === 1 ? 20000 : 45000);
        break;
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
        log("  «" + label + "» no terminó de cargar; reintento");
      }
    }
  } catch (error) {
    var state = await page.evaluate("location.href + ' · ' + document.readyState").catch(function () {
      return "(sin respuesta)";
    });
    throw new Error(error.message + " — " + state);
  }
  return page;
}

// ================= Cámara falsa: foto → video Y4M =================
// Chromium acepta un archivo .y4m como cámara (--use-file-for-fake-video-capture). La foto se escala y
// recorta en un canvas del navegador y se pasa a YUV 4:2:0 acá

async function imageToY4m(page, url, width, height, outputPath) {
  var base64 = await page.evaluate("(async () => {" +
    "const image = new Image(); image.src = " + JSON.stringify(url) + "; await image.decode();" +
    "const canvas = document.createElement('canvas'); canvas.width = " + width + "; canvas.height = " + height + ";" +
    "const context = canvas.getContext('2d');" +
    // "cover": llena el cuadro y recorta lo que sobra, centrado
    "const scale = Math.max(" + width + " / image.width, " + height + " / image.height);" +
    "const w = image.width * scale; const h = image.height * scale;" +
    "context.drawImage(image, (" + width + " - w) / 2, (" + height + " - h) / 2, w, h);" +
    "const data = context.getImageData(0, 0, " + width + ", " + height + ").data;" +
    "let binary = ''; for (let i = 0; i < data.length; i += 32768) { binary += String.fromCharCode.apply(null, data.subarray(i, i + 32768)); }" +
    "return btoa(binary); })()");
  var rgba = Buffer.from(base64, "base64");
  var ySize = width * height;
  var cSize = (width / 2) * (height / 2);
  var frame = Buffer.alloc(ySize + cSize * 2);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      frame[y * width + x] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }
  }
  for (var cy = 0; cy < height / 2; cy++) {
    for (var cx = 0; cx < width / 2; cx++) {
      var r = 0;
      var g = 0;
      var b = 0;
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (offset) {
        var p = ((cy * 2 + offset[1]) * width + cx * 2 + offset[0]) * 4;
        r += rgba[p];
        g += rgba[p + 1];
        b += rgba[p + 2];
      });
      r /= 4;
      g /= 4;
      b /= 4;
      var index = cy * (width / 2) + cx;
      frame[ySize + index] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
      frame[ySize + cSize + index] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
    }
  }
  var header = Buffer.from("YUV4MPEG2 W" + width + " H" + height + " F30:1 Ip A1:1 C420jpeg\n");
  var frameHeader = Buffer.from("FRAME\n");
  // Dos cuadros iguales: alcanza para una imagen fija (Chromium repite el archivo en bucle)
  await writeFile(outputPath, Buffer.concat([header, frameHeader, frame, frameHeader, frame]));
}

// ================= Recortes y anotaciones =================

async function measure(page, shot) {
  return page.evaluate("(() => {" +
    "const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };" +
    "const doc = document.documentElement;" +
    "let clip;" +
    (shot.full
      ? "clip = { x: 0, y: 0, w: doc.scrollWidth, h: doc.scrollHeight };"
      : shot.thumb
      ? "clip = { x: 0, y: 0, w: innerWidth, h: Math.min(innerHeight, doc.scrollHeight) };"
      : "const boxes = " + JSON.stringify(shot.clip) + ".map((s) => { const el = document.querySelector(s); if (!el) { throw new Error('No está ' + s); } return box(el); });" +
        "const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - " + CLIP_PADDING + ");" +
        "const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - " + CLIP_PADDING + ");" +
        "const right = Math.min(doc.scrollWidth, Math.max(...boxes.map((b) => b.x + b.w)) + " + CLIP_PADDING + ");" +
        "const bottom = Math.min(doc.scrollHeight, Math.max(...boxes.map((b) => b.y + b.h)) + " + CLIP_PADDING + ");" +
        "clip = { x: left, y: top, w: right - left, h: bottom - top };") +
    "const spots = {};" +
    "Object.entries(" + JSON.stringify(shot.hotspots || {}) + ").forEach(([id, spec]) => {" +
    "  const selector = typeof spec === 'string' ? spec : spec.selector;" +
    "  const el = document.querySelector(selector);" +
    "  if (!el || el.hidden || el.getClientRects().length === 0) { return; }" +
    "  let b = box(el);" +
    // Un punto dentro del elemento: rectángulo de tamaño 0
    // Ojo: los textos también tienen .at() (un método), por eso se mira el tipo antes
    "  if (typeof spec === 'object' && Array.isArray(spec.at)) { b = { x: b.x + b.w * spec.at[0], y: b.y + b.h * spec.at[1], w: 0, h: 0 }; }" +
    "  const pct = (v, total) => Math.round(v / total * 1000) / 10;" +
    "  spots[id] = [pct(b.x - clip.x, clip.w), pct(b.y - clip.y, clip.h), pct(b.w, clip.w), pct(b.h, clip.h)];" +
    "});" +
    "return { clip: clip, hotspots: spots }; })()");
}

async function capture(page, shot) {
  var measured = await measure(page, shot);
  var clip = measured.clip;
  // Las páginas completas se guardan a tamaño normal; los recortes, al doble; las miniaturas, chicas
  var scale = shot.thumb ? THUMB_SCALE : shot.full ? 1 / SCALE : 1;
  var result = await page.send("Page.captureScreenshot", {
    format: "webp", quality: WEBP_QUALITY, captureBeyondViewport: true,
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: scale }
  });
  var file = shot.id + ".webp";
  await writeFile(join(OUTPUT_DIR, file), Buffer.from(result.result.data, "base64"));
  var width = Math.round(clip.w * SCALE * scale);
  var height = Math.round(clip.h * SCALE * scale);
  var missing = Object.keys(shot.hotspots || {}).filter(function (id) {
    return !measured.hotspots[id];
  });
  log("  " + file + " (" + width + " × " + height + ")" + (missing.length ? " · no se vieron: " + missing.join(", ") : ""));
  return { file: file, width: width, height: height, hotspots: measured.hotspots };
}

// ================= Recorrido =================

async function connect(page, room, alias) {
  await page.fill("#brokerInput", PUBLIC_BROKER);
  await page.fill("#roomInput", room);
  if (alias) {
    await page.fill("#aliasInput", alias);
  }
  await page.click("#mqttConnectButton");
  try {
    // El estado dice "Conectado a la sala «…»"
    await page.waitFor("/^Conectado/.test(document.getElementById('mqttStatus').textContent.trim())", "conectarse al broker", 40000);
  } catch (error) {
    // Para entender qué pasó: el estado y las últimas líneas del registro de la página
    var detail = await page.evaluate("document.getElementById('mqttStatus').textContent + ' | ' + " +
      "[...document.querySelectorAll('.log-panel li')].slice(-4).map((li) => li.textContent.trim()).join(' / ')").catch(function () {
      return "(sin detalle)";
    });
    throw new Error(error.message + " — " + detail);
  }
}

async function main() {
  var options = readArgs();
  var browserPath = findBrowser();
  await mkdir(OUTPUT_DIR, { recursive: true });
  var work = await mkdtemp(join(tmpdir(), "capturas-videos-"));
  var room = "captura-" + Math.random().toString(36).slice(2, 8);
  var virtualFiles = {};
  var served = await startServer({ "/__fuente-mano": options.mano, "/__fuente-brazo": options.brazo }, virtualFiles);
  var browsers = [];
  var pages = [];
  try {
    log("Navegador: " + browserPath);
    log("Sala de prueba: " + room + " (broker público)");

    // 1. Cámaras falsas: las fotos pasadas a video
    var helperBrowser = await launchBrowser(browserPath, "alumnos", null);
    browsers.push(helperBrowser);
    var helper = await openPage(helperBrowser, served.base + "/index.html", { label: "conversor" });
    await imageToY4m(helper, served.base + "/__fuente-brazo", 960, 720, join(work, "brazo.y4m"));
    await imageToY4m(helper, served.base + "/__fuente-mano", 960, 540, join(work, "mano.y4m"));
    var found = await findDrawnLandmarks(helper, served.base + "/__fuente-mano");
    virtualFiles[MEDIAPIPE_FAKE_PATH + "/vision_bundle.mjs"] = { body: buildFakeMediapipe(found), type: "text/javascript; charset=utf-8" };
    helper.close();
    log("Cámaras falsas listas; " + found.points.length + " puntos de las manos leídos de la foto");

    // 2. Profesor: receptor con el Arduino simulado y la cámara del brazo
    var teacherBrowser = await launchBrowser(browserPath, "profesor", join(work, "brazo.y4m"));
    browsers.push(teacherBrowser);
    var receptor = await openPage(teacherBrowser, served.base + "/receptor.html", { script: FAKE_SERIAL, label: "receptor" });
    pages.push(receptor);
    await connect(receptor, room, null);
    await receptor.evaluate("(async () => { if (!document.getElementById('portSelect').options.length) { document.getElementById('addPortButton').click(); await new Promise((r) => setTimeout(r, 500)); } })()");
    await receptor.click("#connectButton");
    await receptor.waitFor("!document.getElementById('armStatus').hidden || /Conectado|listo/i.test(document.getElementById('connectionStatus').textContent)", "conectar el Arduino simulado");
    await receptor.click("#videoButton");
    log("Receptor conectado, con el Arduino simulado y la cámara del brazo encendida");

    // 3. Alumnos: ana con cámara (foto de manos) y beto y caro solo conectados
    var anaBrowser = await launchBrowser(browserPath, "ana", join(work, "mano.y4m"));
    browsers.push(anaBrowser);
    var ana = await openPage(anaBrowser, served.base + "/emisor.html", { label: "ana" });
    pages.push(ana);
    await ana.click("#cameraButton");
    try {
      await ana.waitFor("Number(document.getElementById('handsValue').textContent) > 0", "detectar las manos con MediaPipe", 90000);
    } catch (error) {
      var state = await ana.evaluate("(() => { const v = document.getElementById('video'); return 'video ' + v.videoWidth + '×' + v.videoHeight + ' (readyState ' + v.readyState + ')' +" +
        "' · estado: ' + document.getElementById('status').textContent.trim() + ' · ' + document.getElementById('delegateValue').textContent + ' · FPS ' + document.getElementById('fpsValue').textContent; })()");
      if (process.env.CAPTURAS_DEBUG) {
        var debugShot = await ana.send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(process.env.CAPTURAS_DEBUG, "ana-sin-manos.png"), Buffer.from(debugShot.result.data, "base64"));
      }
      throw new Error(error.message + " — " + state);
    }
    await connect(ana, room, "ana");
    // Un navegador por alumno, como en clase: dos pestañas en el mismo navegador dejan una en segundo plano.
    // Sin VDO.Ninja ni Google Fonts: solo tienen que aparecer en la lista (no salen en las capturas). Cada video
    // extra es trabajo para la PC, y si la hoja de la fuente tarda, frena los módulos de la página
    for (var alias of ["beto", "caro"]) {
      var otherBrowser = await launchBrowser(browserPath, alias, null, ["--host-resolver-rules=MAP vdo.ninja ~NOTFOUND, MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"]);
      browsers.push(otherBrowser);
      var other = await openPage(otherBrowser, served.base + "/emisor.html", { label: alias });
      pages.push(other);
      await connect(other, room, alias);
    }
    log("Alumnos conectados: ana (con cámara), beto y caro");

    // 4. El profesor le da el control a ana y el robot empieza a moverse
    // El broker público a veces demora en repartir los «online»: margen amplio y, si falla, a quiénes vio
    try {
      await receptor.waitFor("document.querySelectorAll('#studentList li').length >= 3", "ver a los tres alumnos", 60000);
    } catch (error) {
      var seen = await receptor.evaluate("[...document.querySelectorAll('#studentList li')].map((li) => li.textContent.trim()).join(', ') || 'nadie'");
      throw new Error(error.message + " — vio: " + seen);
    }
    await receptor.evaluate("[...document.querySelectorAll('#studentList li')].find((li) => li.textContent.includes('ana')).querySelector('button').click()");
    await receptor.waitFor("document.getElementById('receivedMessageValue').textContent.startsWith('X:')", "recibir los datos de ana");
    await receptor.waitFor("!document.getElementById('armStatus').hidden", "mostrar el estado del brazo");
    await ana.waitFor("!document.getElementById('remoteArmStatus').hidden", "ver el estado del brazo en el emisor");
    await ana.waitFor("document.querySelector('#streamBox iframe') !== null", "recibir el video del brazo", 40000);
    log("Control dado a ana; esperando que el video del brazo llegue al emisor…");
    await sleep(15000);

    // 5. Capturas
    var data = {
      generated: new Date().toISOString().slice(0, 10),
      note: "Capturas con datos de ejemplo, generadas con tools/capturas.mjs",
      images: {}
    };
    var captureFor = async function (name, target) {
      // La fuente del sitio tiene que estar cargada antes de la foto; si no llega, se avisa y se captura igual
      await target.waitFor("document.fonts.status === 'loaded'", "cargar la fuente", 20000).catch(function () {
        log("  aviso: «" + target.label + "» sin la fuente del sitio; la captura usa la del sistema");
      });
      for (var shot of SHOTS.filter(function (item) { return item.page === name; })) {
        await target.evaluate("window.scrollTo(0, 0)");
        data.images[shot.id] = await capture(target, shot);
      }
    };
    await receptor.evaluate("window.__brazoQuieto = true");
    await sleep(1500);
    await captureFor("profesor", receptor);
    await captureFor("ana", ana);

    // 6. Versión local, sola: los navegadores de la clase se cierran antes, para que no le quiten máquina
    pages.forEach(function (page) {
      page.close();
    });
    pages = [];
    browsers.forEach(function (browser) {
      browser.child.kill();
    });
    var localBrowser = await launchBrowser(browserPath, "local", join(work, "mano.y4m"));
    browsers.push(localBrowser);
    var local = await openPage(localBrowser, served.base + "/hand-tracking.html", { script: FAKE_SERIAL, label: "local" });
    pages.push(local);
    await local.click("#cameraButton");
    await local.waitFor("Number(document.getElementById('handsValue').textContent) > 0", "detectar las manos en la versión local", 90000);
    await local.evaluate("(async () => { if (!document.getElementById('portSelect').options.length) { document.getElementById('addPortButton').click(); await new Promise((r) => setTimeout(r, 500)); } })()");
    await local.click("#connectButton");
    await local.waitFor("!document.getElementById('armStatus').hidden", "mostrar el estado del brazo en la versión local");
    await sleep(5000);
    await local.evaluate("window.__brazoQuieto = true");
    log("Versión local con la cámara y el Arduino simulado");
    await captureFor("local", local);
    // Cada rectángulo [x, y, ancho, alto] en una sola línea: el archivo queda corto y fácil de revisar
    var json = JSON.stringify(data, null, 2).replace(/\[\s+([\d.,\s-]+?)\s+\]/g, function (match, numbers) {
      return "[" + numbers.split(/,\s*/).join(", ") + "]";
    });
    await writeFile(join(OUTPUT_DIR, "capturas.json"), json + "\n");
    log("Listo: " + SHOTS.length + " imágenes y capturas.json en assets/capturas/");
  } finally {
    pages.forEach(function (page) {
      page.close();
    });
    browsers.forEach(function (browser) {
      browser.child.kill();
    });
    served.server.close();
    await sleep(800);
    // Los perfiles temporales; en Windows pueden quedar bloqueados un instante después de cerrar el navegador
    for (var folder of browsers.map(function (browser) { return browser.profile; }).concat([work])) {
      await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(function () {});
    }
  }
}

export { ROOT, sleep, findBrowser, startServer, launchBrowser, openPage };

// Solo corre cuando se ejecuta este archivo (no cuando otro script importa sus funciones)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(function (error) {
    console.error("[capturas] No se pudo terminar: " + error.message);
    process.exitCode = 1;
  });
}
