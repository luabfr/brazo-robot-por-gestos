// Registro de eventos en pantalla (lista con hora, nivel y mensaje) y en la consola del navegador.

var MAX_LOG_ENTRIES = 300; // Evita que el registro crezca sin límite y degrade la página
var LOG_LABELS = { info: "INFO", success: "OK", warn: "AVISO", error: "ERROR", rx: "RX", tx: "TX" };
var CONSOLE_METHODS = { info: "log", success: "log", warn: "warn", error: "error", rx: "log", tx: "log" };

function formatTime(date) {
  var time = date.toLocaleTimeString("es", { hour12: false });
  return time + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function createSpan(className, text) {
  var span = document.createElement("span");
  span.className = className;
  span.textContent = text; // textContent: nunca se interpreta como HTML
  return span;
}

// Devuelve log(level, message), que escribe en listElement y en la consola con consolePrefix.
// level: info | success | warn | error | rx (recibido) | tx (enviado)
export function createLogger(listElement, consolePrefix) {
  return function log(level, message) {
    if (!LOG_LABELS[level]) {
      level = "info";
    }

    var time = formatTime(new Date());
    var text = String(message);

    // Solo hace autoscroll si el usuario ya estaba al final (no interrumpe si está leyendo arriba)
    var isNearBottom = listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight < 24;

    var entry = document.createElement("li");
    entry.className = "log-entry log-" + level;
    entry.appendChild(createSpan("log-time", time));
    entry.appendChild(createSpan("log-level", LOG_LABELS[level]));
    entry.appendChild(createSpan("log-message", text));
    listElement.appendChild(entry);

    while (listElement.children.length > MAX_LOG_ENTRIES) {
      listElement.removeChild(listElement.firstElementChild);
    }

    if (isNearBottom) {
      listElement.scrollTop = listElement.scrollHeight;
    }

    console[CONSOLE_METHODS[level]](consolePrefix + " [" + LOG_LABELS[level] + "] " + text);
  };
}
