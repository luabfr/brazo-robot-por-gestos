// Conexión con el Arduino por Web Serial: elegir y autorizar el puerto, conectar, leer las respuestas del sketch
// y enviar mensajes. Lo usan hand-tracking.html (versión local) y receptor.html (versión remota).

import { NO_HAND_MESSAGE, describeArmStatus } from "./protocol.js";

// ================= Conexión con el Arduino (Web Serial) =================

var BAUD_RATE = 9600;          // Debe coincidir con Serial.begin(...) de los sketches de arduino/
var MAX_LINE_LENGTH = 1024;    // Protege contra datos sin salto de línea que llenen la memoria
var READY_TIMEOUT_MS = 3000;   // Si el Arduino no saluda en este tiempo, se habilita el envío igual
var LED_COUNT = 3;             // LEDs del sketch; el Arduino confirma cada cambio con "OK: LEDS n"

// Fabricantes USB conocidos (VID) para mostrar un nombre legible en el selector
var USB_VENDORS = {
  0x2341: "Arduino",
  0x2a03: "Arduino",
  0x1a86: "CH340 (clon de Arduino)"
};

// ================= Elementos de la página =================

var portSelect = document.getElementById("portSelect");
var addPortButton = document.getElementById("addPortButton");
var connectButton = document.getElementById("connectButton");
var statusDot = document.getElementById("statusDot");
var connectionStatus = document.getElementById("connectionStatus");
var ledIndicators = Array.prototype.slice.call(document.querySelectorAll("#serialLedRow .led-indicator"));
var ledStatus = document.getElementById("ledStatus");
var ledRow = document.getElementById("serialLedRow");
var armStatus = document.getElementById("armStatus"); // Opcional: solo en las páginas que muestran el brazo
var logTxCheckbox = document.getElementById("logTxCheckbox");

// ================= Estado =================

var isSerialSupported = window.isSecureContext && "serial" in navigator;
var authorizedPorts = [];      // Puertos que el usuario ya autorizó para este sitio
var activePort = null;         // Puerto abierto actualmente
var activeReader = null;       // Lector activo del puerto (se cancela al desconectar)
var readLoopPromise = null;    // Se resuelve cuando termina el bucle de lectura
var keepReading = false;       // false = el cierre lo pidió el usuario
var isSerialBusy = false;      // true mientras se abre o se cierra el puerto
var isDeviceReady = false;     // true cuando el Arduino terminó de reiniciarse y acepta mensajes
var readyTimer = null;         // Temporizador de respaldo para habilitar el envío
var pendingSerialMessage = null;      // Próximo mensaje a escribir: solo se guarda el último
var pendingIsKeepalive = false;       // true si el pendiente es un latido (no se muestra en el registro)
var isWriting = false;                // true mientras hay una escritura en curso
var lastWriteTime = 0;                // performance.now() de la última escritura
var keepaliveMs = 0;                  // 0 = sin latido; se configura en initSerialLink()
var writePromise = Promise.resolve(); // Se resuelve cuando terminan las escrituras pendientes
var textEncoder = new TextEncoder();

// Se completan en initSerialLink(): registro de eventos, estado actual a enviar y aviso de LEDs confirmados
var log = function () {};
var getCurrentMessage = function () {
  return NO_HAND_MESSAGE;
};
var onLedsConfirmed = function () {};
var onArmStatus = function () {};
var onDeviceReset = function () {};

// ================= Arduino (Web Serial) =================

function toHex(value) {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

// Nombre legible del puerto. La API no expone el nombre COM, solo VID/PID USB.
function describePort(port) {
  var info = port.getInfo();

  if (info.usbVendorId === undefined) {
    return "Puerto serie (sin datos USB)";
  }

  var vendor = USB_VENDORS[info.usbVendorId] || "Dispositivo USB";
  var productId = info.usbProductId !== undefined ? toHex(info.usbProductId) : "????";
  return vendor + " — " + toHex(info.usbVendorId) + ":" + productId;
}

function getSelectedPort() {
  var index = Number(portSelect.value);
  return Number.isInteger(index) && authorizedPorts[index] ? authorizedPorts[index] : null;
}

function addOption(text, value, isDisabled) {
  var option = document.createElement("option");
  option.textContent = text;
  option.value = value;
  option.disabled = Boolean(isDisabled);
  portSelect.appendChild(option);
  return option;
}

// Reconstruye el selector manteniendo la selección previa si el puerto sigue disponible
function renderPortOptions(portToSelect) {
  var previousPort = portToSelect || getSelectedPort() || activePort;
  portSelect.textContent = "";

  if (!isSerialSupported) {
    addOption("Web Serial no disponible en este navegador", "", true).selected = true;
    return;
  }

  if (authorizedPorts.length === 0) {
    addOption("Sin puertos autorizados — usa “Agregar”", "", true).selected = true;
    return;
  }

  authorizedPorts.forEach(function (port, index) {
    var label = (index + 1) + ". " + describePort(port);
    if (port === activePort) {
      label += " (conectado)";
    }
    var option = addOption(label, String(index), false);
    if (port === previousPort) {
      option.selected = true;
    }
  });
}

function updateSerialUi() {
  var isConnected = activePort !== null;

  connectButton.textContent = isConnected ? "Desconectar" : "Conectar Arduino";
  connectButton.disabled = !isSerialSupported || isSerialBusy;
  addPortButton.disabled = !isSerialSupported || isSerialBusy || isConnected;
  portSelect.disabled = !isSerialSupported || isSerialBusy || isConnected || authorizedPorts.length === 0;

  statusDot.classList.toggle("is-connected", isConnected && isDeviceReady && !isSerialBusy);
  statusDot.classList.toggle("is-busy", isSerialBusy || (isConnected && !isDeviceReady));

  if (!isSerialSupported) {
    connectionStatus.textContent = "Web Serial no disponible (usa Chrome o Edge de escritorio desde http://localhost)";
  } else if (isSerialBusy) {
    connectionStatus.textContent = isConnected ? "Desconectando…" : "Conectando…";
  } else if (isConnected && !isDeviceReady) {
    connectionStatus.textContent = "Conectado · esperando a que el Arduino termine de reiniciarse…";
  } else if (isConnected) {
    connectionStatus.textContent = "Conectado a " + BAUD_RATE + " baudios · enviando los datos de la mano";
  } else {
    connectionStatus.textContent = "Desconectado";
  }
}

function setSerialBusy(value) {
  isSerialBusy = value;
  updateSerialUi();
}

// Vuelve a leer los puertos autorizados (no muestra ventana ni requiere clic)
async function refreshPorts(portToSelect) {
  try {
    authorizedPorts = await navigator.serial.getPorts();
  } catch (error) {
    log("error", "No se pudo obtener la lista de puertos: " + error.message);
    authorizedPorts = [];
  }
  renderPortOptions(portToSelect);
  updateSerialUi();
}

// Abre el selector del navegador para autorizar un puerto nuevo.
// Debe llamarse directamente desde un clic, sin "await" previos, o el navegador lo bloquea.
async function requestNewPort() {
  var port;
  try {
    port = await navigator.serial.requestPort();
  } catch (error) {
    if (error.name === "NotFoundError") {
      log("info", "Selección de puerto cancelada.");
    } else if (error.name === "SecurityError") {
      log("error", "El navegador bloqueó el acceso al puerto serie (política de seguridad).");
    } else {
      log("error", "No se pudo solicitar el puerto: " + error.message);
    }
    return null;
  }

  log("success", "Puerto autorizado: " + describePort(port));
  await refreshPorts(port);
  return port;
}

// Traduce los errores de port.open() a mensajes accionables
function describeOpenError(error) {
  if (error.name === "InvalidStateError") {
    return "El puerto ya está abierto (¿hay otra pestaña de este proyecto usando el Arduino?).";
  }
  if (error.name === "NetworkError") {
    return "No se pudo abrir el puerto. Cierra el Monitor Serie del IDE de Arduino " +
           "u otro programa que lo esté usando y vuelve a intentar.";
  }
  return "No se pudo abrir el puerto: " + error.name + " — " + error.message;
}

// Separa el texto recibido en líneas completas; el resto queda en el buffer
function processIncomingText(buffer, text) {
  buffer += text;
  var lines = buffer.split(/\r?\n/);
  buffer = lines.pop();

  lines.forEach(function (line) {
    if (line.length > 0) {
      log("rx", line);
      handleDeviceLine(line);
    }
  });

  if (buffer.length > MAX_LINE_LENGTH) {
    log("warn", "Se recibieron más de " + MAX_LINE_LENGTH + " caracteres sin salto de línea; se descartan.");
    buffer = "";
  }

  return buffer;
}

// Lee del puerto hasta que el usuario desconecte o se pierda la conexión
async function readLoop(port) {
  var decoder = new TextDecoder();
  var buffer = "";
  var isStreamDone = false;

  while (port.readable && keepReading && !isStreamDone) {
    activeReader = port.readable.getReader();
    try {
      while (true) {
        var result = await activeReader.read();
        if (result.done) {
          isStreamDone = true;
          break;
        }
        buffer = processIncomingText(buffer, decoder.decode(result.value, { stream: true }));
      }
    } catch (error) {
      // Errores no fatales (p. ej. FramingError, BufferOverrunError) permiten seguir leyendo.
      // Si el cable se desconectó, port.readable queda en null y el bucle termina.
      log("warn", "Error de lectura: " + error.name + " — " + error.message);
    } finally {
      activeReader.releaseLock();
      activeReader = null;
    }
  }

  // Muestra lo que haya quedado sin salto de línea final
  buffer += decoder.decode();
  if (buffer.length > 0) {
    log("rx", buffer);
  }

  // Si keepReading sigue en true, el cierre no lo pidió el usuario: se perdió la conexión
  if (keepReading && activePort === port) {
    keepReading = false;
    log("error", "Se perdió la conexión con el puerto.");
    try {
      await port.close();
    } catch (error) {
      // El puerto puede estar ya cerrado si el dispositivo se desconectó; no hay nada más que hacer
    }
    activePort = null;
    readLoopPromise = null;
    resetDeviceState();
    await refreshPorts();
  }
}

// Muestra cuántos LEDs encendió el Arduino (null = todavía no lo confirmó)
function setConfirmedLeds(count) {
  var leds = count === null ? null : Math.min(Math.max(count, 0), LED_COUNT);
  ledIndicators.forEach(function (indicator, index) {
    indicator.classList.toggle("is-on", leds !== null && index < leds);
    indicator.classList.toggle("is-off", leds !== null && index >= leds);
  });
  ledStatus.textContent = leds === null ? "LEDs sin confirmar" : leds + " de " + LED_COUNT + " LEDs encendidos";
}

// Muestra el estado que informa el sketch del brazo (null = no hay brazo o todavía no informó).
// Con un brazo conectado se ocultan los LEDs: la página se adapta sola al sketch que tenga el Arduino.
function setArmStatus(line) {
  var description = line === null ? null : describeArmStatus(line);
  ledRow.hidden = description !== null;
  if (armStatus) {
    armStatus.hidden = description === null;
    armStatus.textContent = description || "";
  }
}

// Habilita el envío (una sola vez por conexión) y manda enseguida el estado actual:
// con la mano quieta no hay mensajes nuevos, y el Arduino igual tiene que saber qué mostrar
function markDeviceReady(level, message) {
  if (isDeviceReady) {
    return;
  }
  isDeviceReady = true;
  clearTimeout(readyTimer);
  readyTimer = null;
  log(level, message);
  updateSerialUi();
  queueSerialMessage(getCurrentMessage());
}

// Vuelve al estado inicial: sin Arduino listo, sin envíos pendientes y con LEDs desconocidos
function resetDeviceState() {
  isDeviceReady = false;
  clearTimeout(readyTimer);
  readyTimer = null;
  pendingSerialMessage = null;
  setConfirmedLeds(null);
  setArmStatus(null);
  onDeviceReset();
}

// Interpreta las respuestas del sketch para mostrar lo que hizo de verdad (LEDs encendidos o estado del brazo)
function handleDeviceLine(line) {
  // La primera línea recibida tras el reinicio indica que el sketch ya está corriendo
  markDeviceReady("success", "El Arduino está listo; se envían los datos de la mano.");

  var text = line.trim();
  var ledsMatch = /^OK: LEDS (\d+)$/i.exec(text);
  if (ledsMatch) {
    setConfirmedLeds(Number(ledsMatch[1]));
    onLedsConfirmed(Number(ledsMatch[1]));
  } else if (describeArmStatus(text)) {
    setArmStatus(text);
    onArmStatus(text);
  } else if (/^AVISO:/i.test(text)) {
    log("warn", "El Arduino avisa: " + text.replace(/^AVISO:\s*/i, ""));
  } else if (/^ERROR:/i.test(text)) {
    log("warn", "El Arduino rechazó un mensaje: " + text);
  }
}

// Deja un mensaje listo para enviar. Si el puerto todavía está escribiendo, reemplaza al pendiente:
// para manejar LEDs (o un servo) importa el último estado, no la historia, y así nunca se acumula atraso.
// isKeepalive: es un latido que repite el estado actual (no se muestra en el registro)
function queueSerialMessage(message, isKeepalive) {
  pendingSerialMessage = message;
  pendingIsKeepalive = Boolean(isKeepalive);
  if (!isWriting) {
    writePromise = flushSerialMessages();
  }
  return writePromise;
}

// Escribe los mensajes de a uno (el puerto admite un solo escritor a la vez). Nunca rechaza.
async function flushSerialMessages() {
  isWriting = true;
  try {
    while (pendingSerialMessage !== null) {
      var message = pendingSerialMessage;
      var isKeepalive = pendingIsKeepalive;
      pendingSerialMessage = null;

      var port = activePort;
      if (!port || !port.writable) {
        log("warn", "El puerto no admite escritura; no se envió \"" + message + "\".");
        return;
      }

      var writer = port.writable.getWriter();
      try {
        await writer.write(textEncoder.encode(message + "\n"));
        lastWriteTime = performance.now();
        if (logTxCheckbox.checked && !isKeepalive) {
          log("tx", message);
        }
      } catch (error) {
        log("error", "No se pudo enviar \"" + message + "\": " + error.message);
      } finally {
        writer.releaseLock();
      }
    }
  } finally {
    isWriting = false;
  }
}

async function connectSerial() {
  if (isSerialBusy || activePort) {
    return;
  }

  log("info", "Intentando conectar el Arduino con la web…");

  // Si no hay puerto elegido, se pide uno (este clic habilita abrir el selector)
  var port = getSelectedPort();
  if (!port) {
    port = await requestNewPort();
    if (!port) {
      return;
    }
  }

  setSerialBusy(true);
  log("info", "Abriendo " + describePort(port) + " a " + BAUD_RATE + " baudios…");

  try {
    await port.open({ baudRate: BAUD_RATE });
  } catch (error) {
    log("error", describeOpenError(error));
    setSerialBusy(false);
    return;
  }

  activePort = port;
  keepReading = true;
  resetDeviceState();
  renderPortOptions(port);
  setSerialBusy(false);

  log("success", "Conectado a " + describePort(port) + ".");
  log("info", "Esperando el mensaje inicial del Arduino (se reinicia al abrir el puerto)…");

  // Respaldo: algunas placas no se reinician al abrir el puerto y no envían saludo
  readyTimer = setTimeout(function () {
    if (activePort === port) {
      markDeviceReady("warn", "No llegó el mensaje inicial del Arduino; se habilita el envío igualmente.");
    }
  }, READY_TIMEOUT_MS);

  readLoopPromise = readLoop(port);
}

async function disconnectSerial() {
  if (isSerialBusy || !activePort) {
    return;
  }

  var port = activePort;
  var wasReady = isDeviceReady;
  setSerialBusy(true);
  log("info", "Apagando los LEDs y cerrando el puerto…");

  keepReading = false;
  try {
    // Sin esto, los LEDs quedarían como estaban en el último mensaje
    if (wasReady) {
      await queueSerialMessage(NO_HAND_MESSAGE);
    }
    await writePromise; // Deja terminar cualquier envío en curso antes de cerrar
    if (activeReader) {
      await activeReader.cancel(); // Libera el bucle de lectura
    }
    if (readLoopPromise) {
      await readLoopPromise;
    }
    await port.close();
    log("success", "Puerto cerrado.");
  } catch (error) {
    log("error", "Error al cerrar el puerto: " + error.message);
  } finally {
    activePort = null;
    readLoopPromise = null;
    resetDeviceState();
    renderPortOptions(port);
    setSerialBusy(false);
  }
}

// Envía un mensaje al Arduino si está conectado y listo. Devuelve false si no se pudo encolar.
function send(message) {
  if (!activePort || !isDeviceReady || isSerialBusy) {
    return false;
  }
  queueSerialMessage(message);
  return true;
}

// ================= Arranque =================

// Latido: si el puerto estuvo sin escribir keepaliveMs, se repite el estado actual. Sin esto, con la mano quieta
// no habría mensajes y el sketch del brazo frenaría los motores por su "hombre muerto".
function sendKeepalive() {
  var isIdle = !isWriting && pendingSerialMessage === null && performance.now() - lastWriteTime >= keepaliveMs;
  if (activePort && isDeviceReady && !isSerialBusy && isIdle) {
    queueSerialMessage(getCurrentMessage(), true);
  }
}

// options.log: función de registro (createLogger). options.getCurrentMessage: estado a enviar al conectar.
// options.onLedsConfirmed(n): el Arduino confirmó cuántos LEDs encendió.
// options.onArmStatus(línea): el brazo informó su estado ("OK: BRAZO IZQUIERDA 72 72").
// options.onDeviceReset(): se desconectó el Arduino; lo que había informado ya no vale.
// options.keepaliveMs: cada cuánto repetir el estado actual sin cambios (0 = nunca).
export function initSerialLink(options) {
  options = options || {};
  log = options.log || log;
  getCurrentMessage = options.getCurrentMessage || getCurrentMessage;
  onLedsConfirmed = options.onLedsConfirmed || onLedsConfirmed;
  onArmStatus = options.onArmStatus || onArmStatus;
  onDeviceReset = options.onDeviceReset || onDeviceReset;
  keepaliveMs = Number(options.keepaliveMs) > 0 ? Number(options.keepaliveMs) : 0;
  if (keepaliveMs) {
    setInterval(sendKeepalive, Math.max(100, keepaliveMs / 2));
  }

  connectButton.addEventListener("click", function () {
    if (activePort) {
      disconnectSerial();
    } else {
      connectSerial();
    }
  });

  addPortButton.addEventListener("click", function () {
    requestNewPort();
  });

  renderPortOptions();
  updateSerialUi();
  setConfirmedLeds(null);
  setArmStatus(null);

  if (!window.isSecureContext) {
    log("error", "La página no está en un origen seguro. Ábrela desde http://localhost o HTTPS " +
                 "(no con doble clic / file://) para usar Web Serial.");
  } else if (!("serial" in navigator)) {
    log("error", "Este navegador no soporta Web Serial API. Usa Chrome, Edge u Opera de escritorio.");
  } else {
    // Avisos del sistema cuando se enchufa o desenchufa un puerto ya autorizado
    navigator.serial.addEventListener("connect", function (event) {
      log("info", "Se conectó un puerto autorizado: " + describePort(event.target));
      refreshPorts();
    });

    navigator.serial.addEventListener("disconnect", function (event) {
      log("warn", "Se desconectó un puerto: " + describePort(event.target));
      // Si era el puerto activo, el bucle de lectura detecta la pérdida y limpia el estado
      refreshPorts();
    });

    log("info", "Web Serial disponible. Buscando puertos autorizados…");
    refreshPorts().then(function () {
      log("info", authorizedPorts.length + " puerto(s) autorizado(s) encontrado(s).");
    });
  }

  return {
    send: send,
    isReady: function () {
      return activePort !== null && isDeviceReady && !isSerialBusy;
    }
  };
}
