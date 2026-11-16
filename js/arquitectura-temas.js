// Temas a fondo de la infografía (arquitectura.html): un panel con pestañas que profundiza en cada parte.
// Hardware (esquema de conexión y simulador del pulso del servo), el mensaje, MQTT, video, seguridad y la web.
// Los números salen del código real: config.js (tiempos, intervalo, tope del video), protocol.js (formato)
// y mqtt-link.js (rutas de los topics). Lo que es una estimación se muestra como tal.

import { CONFIG } from "./config.js";
import { OUTPUT_MAX, MAX_FINGERS, GESTURE_LABELS, NO_HAND_MESSAGE, formatMessage, parseMessage } from "./protocol.js";
import { buildTopics } from "./mqtt-link.js";
import {
  REPO_URL, TOPICS, BOARD_ROWS, WIRES, MESSAGE_ROWS, MQTT_CONCEPTS, TOPIC_ROWS, ACL_ROWS,
  SECURITY_ITEMS, WEB_ROWS, WEB_ITEMS, SCENARIOS
} from "./arquitectura-contenido.js";

var SVG_NS = "http://www.w3.org/2000/svg";

// Colores de los gráficos: paleta validada para el fondo oscuro de los paneles (skill dataviz, script
// validate_palette.js: CVD ΔE 15,9 y visión normal ΔE 26,5). Siempre acompañados por su nombre escrito
var DATA_COLOR = "#3987e5";   // Datos de la mano
var VIDEO_COLOR = "#d55181";  // Video

// Copiados de js/hand-tracker.js (no se puede importar: toma la cámara y la página al cargarse)
var GESTURE_HOLD_SECONDS = 0.15;
var HAND_LOST_SECONDS = 0.3;
// Del sketch arduino/brazo_2_motores (COMMAND_TIMEOUT_MS)
var ARDUINO_TIMEOUT_SECONDS = 2;

// Librería Servo de Arduino (src/Servo.h): ancho del pulso por defecto y periodo
var SERVO_MIN_US = 544;
var SERVO_MAX_US = 2400;
var SERVO_PERIOD_MS = 20;
// Topes y reposo del sketch del brazo (MIN_ANGLE, MAX_ANGLE, HOME_ANGLE)
var ARM_MIN_ANGLE = 20;
var ARM_MAX_ANGLE = 160;
var ARM_HOME_ANGLE = 90;

// Estimaciones para los gráficos de ancho de banda y de la cuota del broker
var SAMPLE_MESSAGE = "X:52 Y:31 D:5 G:ABIERTA"; // El mensaje habitual más largo
var SAMPLE_ALIAS = "ana";
var OVERHEAD_BYTES = 33;   // Encabezados de MQTT 5 (~5), WebSocket (6) y TLS 1.3 (~22), aproximados
var JPEG_FRAME_KB = 12.5;  // Una foto JPEG de 320 × 240, aproximada
var JPEG_FPS = 5;
var QUOTA_MB = 1000;       // 1 GB por mes del plan gratuito de EMQX Serverless

// Del sketch del brazo (MAX_LINE_LENGTH) y del de LEDs (pines 8, 9 y 10): se imitan en el simulador del mensaje
var SKETCH_MAX_LINE = 48;
var LED_COUNT = 3;
// sscanf(line, "X:%d Y:%d D:%d G:%11s") del sketch, en forma de expresión regular. Es más permisivo que el
// receptor: %d acepta signo y números grandes, un espacio del formato acepta cero o más espacios, y lo que sobra
// al final se ignora. Por eso el receptor valida primero con el formato exacto
var SKETCH_DATA_PATTERN = /^X:\s*[+-]?\d+\s*Y:\s*[+-]?\d+\s*D:\s*[+-]?\d+\s*G:\s*(\S{1,11})/;
// Comandos manuales del sketch, para probar el montaje desde el Monitor Serie del IDE
var SKETCH_MANUAL = {
  IZQUIERDA: "Comando manual: los motores van a la izquierda.",
  DERECHA: "Comando manual: los motores van a la derecha.",
  QUIETO: "Comando manual: los motores se detienen.",
  CENTRO: "Comando manual: los motores vuelven a 90°."
};
var MESSAGE_EXAMPLES = [
  { text: "X:52 Y:31 D:2 G:V", label: "Válido" },
  { text: "X:150 Y:31 D:2 G:V", label: "Fuera de rango" },
  { text: "x:52 y:31 d:2 g:v", label: "Minúsculas" },
  { text: "X:52 Y:31 D:2 G:BAILE", label: "Gesto inventado" },
  { text: "X:52  Y:31 D:2 G:V", label: "Doble espacio" },
  { text: NO_HAND_MESSAGE, label: "Sin mano" }
];

var panel = null;
var tabsList = null;
var body = null;
var tooltipApi = null;
var callbacks = {};
var opener = null;
var built = {};
var activeId = null;

// ================= Utilidades =================

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text; // textContent: nunca se interpreta como HTML
  }
  return element;
}

function svgEl(name, attributes) {
  var element = document.createElementNS(SVG_NS, name);
  Object.keys(attributes || {}).forEach(function (key) {
    element.setAttribute(key, attributes[key]);
  });
  return element;
}

// Números con coma decimal, como se escriben en castellano
function formatNumber(value, decimals) {
  return value.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Completa los marcadores de tiempo de los escenarios de falla ({stale}, {will}…) con los valores de config.js
export function fillTimes(text) {
  var values = {
    stale: CONFIG.handStaleMs / 1000,
    heartbeat: CONFIG.heartbeatMs / 1000,
    serial: CONFIG.serialKeepaliveMs / 1000,
    keepalive: CONFIG.keepaliveSeconds,
    will: CONFIG.keepaliveSeconds * 1.5
  };
  return String(text).replace(/\{(\w+)\}/g, function (match, key) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return match; // Marcador desconocido: queda a la vista para detectarlo
    }
    return formatNumber(values[key], values[key] % 1 === 0 ? 0 : 1);
  });
}

function section(title, className) {
  var element = el("section", "topic-section" + (className ? " " + className : ""));
  element.appendChild(el("h4", "topic-section-title", title));
  return element;
}

function table(headers, rows, caption) {
  var element = el("table", "topic-table");
  if (caption) {
    element.appendChild(el("caption", "visually-hidden", caption));
  }
  var head = el("thead");
  var headRow = el("tr");
  headers.forEach(function (header) {
    var cell = el("th", "", header);
    cell.scope = "col";
    headRow.appendChild(cell);
  });
  head.appendChild(headRow);
  var bodyElement = el("tbody");
  rows.forEach(function (row) {
    var tr = el("tr");
    row.forEach(function (value, index) {
      var cell = el(index === 0 ? "th" : "td", "", value);
      if (index === 0) {
        cell.scope = "row";
      }
      tr.appendChild(cell);
    });
    bodyElement.appendChild(tr);
  });
  element.append(head, bodyElement);
  var wrapper = el("div", "topic-table-wrap");
  wrapper.appendChild(element);
  return wrapper;
}

function termList(items) {
  var list = el("dl", "topic-terms");
  items.forEach(function (item) {
    var group = el("div");
    group.append(el("dt", "", item[0]), el("dd", "", item[1]));
    list.appendChild(group);
  });
  return list;
}

// Tooltip compartido con el diagrama (lo maneja js/arquitectura.js)
function bindTooltip(element, title, text, color) {
  element.addEventListener("pointerenter", function (event) {
    if (event.pointerType !== "touch") {
      tooltipApi.showAt(title, text, color, event.clientX, event.clientY);
    }
  });
  element.addEventListener("pointermove", function (event) {
    if (event.pointerType !== "touch") {
      tooltipApi.move(event.clientX, event.clientY);
    }
  });
  element.addEventListener("pointerleave", tooltipApi.hide);
  element.addEventListener("focus", function () {
    tooltipApi.showBelow(title, text, color, element);
  });
  element.addEventListener("blur", tooltipApi.hide);
}

// ================= Gráficos de barras (HTML) =================
// Barras horizontales con escala lineal desde cero: la diferencia de tamaño es el mensaje.
// Cada barra lleva su nombre y su valor escritos (la identidad no depende solo del color)

function barChart(options) {
  var figure = el("figure", "topic-chart");
  figure.appendChild(el("figcaption", "topic-chart-title", options.title));
  var max = Math.max.apply(null, options.rows.map(function (row) {
    return row.value;
  }));
  var list = el("ul", "bar-chart");
  options.rows.forEach(function (row) {
    var item = el("li", "bar-row");
    item.style.setProperty("--color", row.color);
    var label = el("span", "bar-label", row.label);
    var track = el("span", "bar-track");
    var bar = el("span", "bar-fill");
    // Mínimo de 3 px: una barra diminuta tiene que seguir viéndose
    bar.style.width = "max(3px, " + (row.value / max) * 100 + "%)";
    bar.tabIndex = 0;
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", row.label + ": " + row.valueText);
    bindTooltip(bar, row.label, row.valueText + (row.detail ? ". " + row.detail : ""), row.color);
    track.appendChild(bar);
    var value = el("span", "bar-value", row.valueText);
    item.append(label, track, value);
    list.appendChild(item);
  });
  figure.appendChild(list);
  if (options.note) {
    figure.appendChild(el("p", "topic-chart-note", options.note));
  }
  return figure;
}

// ================= Hardware: esquema de conexión =================

// Coordenadas del esquema (viewBox 640 × 380). Los pines siguen el orden real del header digital del Uno:
// ... 10, 9, 8 · 7, 6, 5 ... y el header de alimentación de abajo: 5V, GND
var WIRE_PATHS = {
  usb: { color: "#6aa8ff", d: "M44 170 H-34", label: { x: -38, y: 160, text: "a la PC" } },
  signal2: { color: "#f39c4a", d: "M226 128 V78 H438" },
  signal1: { color: "#f39c4a", d: "M240 128 V112 H360 V158 H438" },
  power: { color: "#ef5350", d: "M412 284 V256 H392 V88 H438 M392 168 H438" },
  ground: { color: "#c9d0dc", d: "M444 284 V266 H378 V98 H438 M378 178 H438" },
  common: { color: "#c9d0dc", d: "M378 266 V326 H156 V272" },
  pson: { color: "#5fd38a", d: "M520 284 V268 H552 V284" },
  leds: { color: "#ff6b6b", d: "M150 128 V100 M165 128 V100 M180 128 V100" }
};

function drawBoard(svg) {
  // Placa: color de las placas Arduino, con agujeros de montaje y el chip
  svg.appendChild(svgEl("rect", { x: 40, y: 128, width: 270, height: 144, rx: 10, class: "hw-board" }));
  svg.appendChild(svgEl("rect", { x: 30, y: 152, width: 34, height: 36, rx: 3, class: "hw-metal" })); // USB-B
  svg.appendChild(svgEl("rect", { x: 30, y: 214, width: 30, height: 30, rx: 4, class: "hw-jack" }));  // jack de alimentación
  svg.appendChild(svgEl("rect", { x: 150, y: 196, width: 110, height: 30, rx: 3, class: "hw-chip" }));
  [[54, 140], [296, 140], [54, 260], [296, 260]].forEach(function (hole) {
    svg.appendChild(svgEl("circle", { cx: hole[0], cy: hole[1], r: 4, class: "hw-hole" }));
  });
  var name = svgEl("text", { x: 205, y: 246, class: "hw-text hw-text-board", "text-anchor": "middle" });
  name.textContent = "Arduino Uno / Mega";
  svg.appendChild(name);

  // Header digital (arriba) y de alimentación (abajo): solo se rotulan los pines que usa el proyecto
  var topPins = [[120, ""], [135, ""], [150, "10"], [165, "9"], [180, "8"], [211, "7"], [226, "6"], [240, "5"], [255, ""], [270, ""]];
  topPins.forEach(function (pin) {
    svg.appendChild(svgEl("rect", { x: pin[0] - 4, y: 126, width: 8, height: 8, class: pin[1] ? "hw-pin is-used" : "hw-pin" }));
    if (pin[1]) {
      var label = svgEl("text", { x: pin[0], y: 148, class: "hw-text hw-pin-label", "text-anchor": "middle" });
      label.textContent = pin[1];
      svg.appendChild(label);
    }
  });
  // El pin 5V queda libre a propósito: los servos toman los 5 V de la fuente ATX
  [[126, ""], [141, ""], [156, "GND"], [171, ""]].forEach(function (pin) {
    svg.appendChild(svgEl("rect", { x: pin[0] - 4, y: 266, width: 8, height: 8, class: pin[1] ? "hw-pin is-used" : "hw-pin" }));
    if (pin[1]) {
      var label = svgEl("text", { x: pin[0], y: 260, class: "hw-text hw-pin-label", "text-anchor": "middle" });
      label.textContent = pin[1];
      svg.appendChild(label);
    }
  });
}

function drawServo(svg, y, name) {
  svg.appendChild(svgEl("rect", { x: 438, y: y, width: 96, height: 40, rx: 4, class: "hw-servo" }));
  svg.appendChild(svgEl("circle", { cx: 512, cy: y + 12, r: 9, class: "hw-servo-gear" }));
  svg.appendChild(svgEl("path", { d: "M512 " + (y + 12) + " L560 " + (y + 2), class: "hw-servo-horn" }));
  var label = svgEl("text", { x: 470, y: y + 56, class: "hw-text", "text-anchor": "middle" });
  label.textContent = name;
  svg.appendChild(label);
}

function drawPsu(svg) {
  svg.appendChild(svgEl("rect", { x: 396, y: 284, width: 200, height: 72, rx: 8, class: "hw-psu" }));
  [[412, "hw-terminal is-red"], [444, "hw-terminal is-black"], [520, "hw-terminal is-green"], [552, "hw-terminal is-black"]].forEach(function (terminal) {
    svg.appendChild(svgEl("rect", { x: terminal[0] - 5, y: 280, width: 10, height: 8, rx: 1, class: terminal[1] }));
  });
  var name = svgEl("text", { x: 496, y: 324, class: "hw-text hw-text-board", "text-anchor": "middle" });
  name.textContent = "Fuente ATX · 5 V";
  svg.appendChild(name);
  var bridge = svgEl("text", { x: 536, y: 344, class: "hw-text hw-pin-label", "text-anchor": "middle" });
  bridge.textContent = "puente PS_ON";
  svg.appendChild(bridge);
}

function drawLeds(svg) {
  svg.appendChild(svgEl("rect", { x: 112, y: 14, width: 110, height: 80, rx: 8, class: "hw-optional" }));
  var label = svgEl("text", { x: 167, y: 30, class: "hw-text hw-pin-label", "text-anchor": "middle" });
  label.textContent = "LEDs (alternativo)";
  svg.appendChild(label);
  [150, 165, 180].forEach(function (x) {
    svg.appendChild(svgEl("circle", { cx: x, cy: 70, r: 6, class: "hw-led" }));
    svg.appendChild(svgEl("path", { d: "M" + x + " 64 V44", class: "hw-resistor" }));
  });
}

function wiringDiagram() {
  var figure = el("figure", "topic-figure");
  figure.appendChild(el("figcaption", "topic-chart-title", "Esquema de conexión · señalá o tocá cada cable"));
  // viewBox con margen a la izquierda (x negativo) para el cable USB y su etiqueta
  var svg = svgEl("svg", { viewBox: "-44 0 684 380", class: "hw-diagram", role: "group", "aria-label": "Esquema de conexión del hardware" });

  // Primero los cables (debajo) y después las piezas
  WIRES.forEach(function (wire) {
    var spec = WIRE_PATHS[wire.id];
    var group = svgEl("g", { class: "hw-wire", tabindex: "0", role: "img", "aria-label": wire.label + ": de " + wire.from + " a " + wire.to + ". " + wire.carries });
    group.style.setProperty("--color", spec.color);
    group.appendChild(svgEl("path", { d: spec.d, class: "hw-wire-line" }));
    group.appendChild(svgEl("path", { d: spec.d, class: "hw-wire-hit" }));
    bindTooltip(group, wire.label, wire.from + " → " + wire.to + ". " + wire.carries, spec.color);
    group.addEventListener("pointerenter", function () {
      svg.classList.add("is-highlighting");
      group.classList.add("is-active");
    });
    group.addEventListener("pointerleave", function () {
      svg.classList.remove("is-highlighting");
      group.classList.remove("is-active");
    });
    group.addEventListener("focus", function () {
      svg.classList.add("is-highlighting");
      group.classList.add("is-active");
    });
    group.addEventListener("blur", function () {
      svg.classList.remove("is-highlighting");
      group.classList.remove("is-active");
    });
    svg.appendChild(group);
    if (spec.label) {
      var text = svgEl("text", { x: spec.label.x, y: spec.label.y, class: "hw-text hw-pin-label" });
      text.textContent = spec.label.text;
      svg.appendChild(text);
    }
  });

  drawBoard(svg);
  drawServo(svg, 58, "Servo 2 · pin 6");
  drawServo(svg, 138, "Servo 1 · pin 5");
  drawPsu(svg);
  drawLeds(svg);
  // En el celular el esquema conserva un ancho mínimo legible y se desplaza de costado dentro de su caja
  var scroller = el("div", "hw-scroll");
  scroller.appendChild(svg);
  figure.appendChild(scroller);
  figure.appendChild(el("p", "hw-scroll-hint", "Deslizá el esquema de costado para ver los servos y la fuente →"));

  // La misma información en una tabla (accesible y para quien no distingue los colores)
  var details = el("details", "topic-table-toggle");
  details.appendChild(el("summary", "", "Ver los cables como tabla"));
  details.appendChild(table(["Cable", "De", "A", "Qué lleva"], WIRES.map(function (wire) {
    return [wire.label, wire.from, wire.to, wire.carries];
  }), "Cables del esquema de conexión"));
  figure.appendChild(details);
  return figure;
}

// ================= Hardware: simulador del pulso del servo =================

function pulseMicroseconds(angle) {
  return Math.round(SERVO_MIN_US + (angle / 180) * (SERVO_MAX_US - SERVO_MIN_US));
}

function servoSimulator() {
  var figure = el("figure", "topic-figure servo-sim");
  figure.appendChild(el("figcaption", "topic-chart-title", "Cómo entiende un servo el ángulo"));

  var controls = el("div", "servo-controls");
  var label = el("label", "servo-label", "Ángulo pedido");
  label.htmlFor = "servoAngle";
  var input = el("input", "servo-range");
  input.type = "range";
  input.id = "servoAngle";
  input.min = "0";
  input.max = "180";
  input.step = "1";
  input.value = String(ARM_HOME_ANGLE);
  var output = el("output", "servo-output");
  output.htmlFor = "servoAngle";
  output.setAttribute("aria-live", "polite");
  controls.append(label, input, output);

  // Señal: dos periodos de 20 ms. Escala: 12 px por milisegundo
  var wave = svgEl("svg", { viewBox: "0 0 500 90", class: "servo-wave", "aria-hidden": "true" });
  var wavePath = svgEl("path", { class: "servo-wave-line" });
  var periodMark = svgEl("path", { d: "M20 78 H260", class: "servo-wave-axis" });
  var periodText = svgEl("text", { x: 140, y: 74, class: "hw-text hw-pin-label", "text-anchor": "middle" });
  periodText.textContent = SERVO_PERIOD_MS + " ms";
  var pulseText = svgEl("text", { y: 14, class: "hw-text hw-pin-label" });
  wave.append(wavePath, periodMark, periodText, pulseText);

  // Indicador del ángulo: semicírculo de 0° a 180°, con la zona permitida por el sketch (20° a 160°)
  // Margen a los costados para que las etiquetas de 0° y 180° no queden cortadas
  var gauge = svgEl("svg", { viewBox: "-18 0 256 124", class: "servo-gauge", "aria-hidden": "true" });
  function polar(angle, radius) {
    var radians = Math.PI - (angle * Math.PI) / 180;
    return { x: 110 + radius * Math.cos(radians), y: 110 - radius * Math.sin(radians) };
  }
  function arc(fromAngle, toAngle, radius) {
    var a = polar(fromAngle, radius);
    var b = polar(toAngle, radius);
    return "M" + a.x + " " + a.y + " A" + radius + " " + radius + " 0 0 1 " + b.x + " " + b.y;
  }
  gauge.appendChild(svgEl("path", { d: arc(0, 180, 90), class: "servo-gauge-track" }));
  gauge.appendChild(svgEl("path", { d: arc(ARM_MIN_ANGLE, ARM_MAX_ANGLE, 90), class: "servo-gauge-allowed" }));
  [[0, "0°"], [ARM_MIN_ANGLE, ARM_MIN_ANGLE + "°"], [ARM_HOME_ANGLE, ARM_HOME_ANGLE + "°"], [ARM_MAX_ANGLE, ARM_MAX_ANGLE + "°"], [180, "180°"]].forEach(function (tick) {
    var point = polar(tick[0], 104);
    var text = svgEl("text", { x: point.x, y: point.y + 4, class: "hw-text hw-pin-label", "text-anchor": "middle" });
    text.textContent = tick[1];
    gauge.appendChild(text);
  });
  var needle = svgEl("line", { x1: 110, y1: 110, class: "servo-needle" });
  gauge.append(needle, svgEl("circle", { cx: 110, cy: 110, r: 7, class: "servo-hub" }));

  function update() {
    var angle = Number(input.value);
    var micros = pulseMicroseconds(angle);
    var widthPx = (micros / 1000) * 12;
    var d = "";
    [20, 260].forEach(function (start) {
      d += (d ? " L" : "M") + start + " 60 V20 H" + (start + widthPx) + " V60 H" + (start + SERVO_PERIOD_MS * 12);
    });
    wavePath.setAttribute("d", d);
    pulseText.setAttribute("x", String(20 + widthPx + 6));
    pulseText.textContent = formatNumber(micros / 1000, 2) + " ms";
    var tip = polar(angle, 78);
    needle.setAttribute("x2", String(tip.x));
    needle.setAttribute("y2", String(tip.y));
    var outside = angle < ARM_MIN_ANGLE || angle > ARM_MAX_ANGLE;
    figure.classList.toggle("is-outside", outside);
    output.textContent = angle + "° → pulso de " + micros + " µs cada " + SERVO_PERIOD_MS + " ms" +
      (outside ? " · fuera de los topes del brazo (" + ARM_MIN_ANGLE + "° a " + ARM_MAX_ANGLE + "°)" : "");
  }
  input.addEventListener("input", update);
  update();

  var visuals = el("div", "servo-visuals");
  visuals.append(wave, gauge);
  figure.append(controls, visuals);
  figure.appendChild(el("p", "topic-chart-note",
    "La librería Servo de Arduino manda un pulso cada " + SERVO_PERIOD_MS + " ms: " + SERVO_MIN_US + " µs es 0° y " +
    SERVO_MAX_US + " µs es 180°. El sketch del brazo no pasa de " + ARM_MIN_ANGLE + "° a " + ARM_MAX_ANGLE +
    "° (zona clara) y arranca en " + ARM_HOME_ANGLE + "°."));
  return figure;
}

// ================= El mensaje: simulador =================
// El veredicto del receptor sale de parseMessage() y el mensaje armado de formatMessage(): es el código de
// js/protocol.js, el mismo que corre en el emisor y el receptor. El motivo del rechazo y la respuesta del
// Arduino se calculan acá (el sketch corre en la placa y no se puede importar)

// Por qué parseMessage() rechazó una línea, revisando las reglas en el orden en que se leen
function explainRejection(text) {
  var line = String(text).trim();
  if (line === "") {
    return "Está vacío.";
  }
  if (parseMessage(line.toUpperCase())) {
    return "Las letras van en mayúsculas.";
  }
  var parts = line.split(" ");
  var names = ["X", "Y", "D", "G"];
  if (parts.length !== 4) {
    return parts.indexOf("") >= 0
      ? "Hay espacios de más: las partes van separadas por un solo espacio."
      : "Tiene que tener 4 partes separadas por un espacio (X, Y, D y G) o ser " + NO_HAND_MESSAGE + ".";
  }
  for (var i = 0; i < names.length; i++) {
    if (parts[i].indexOf(names[i] + ":") !== 0) {
      return "La parte " + (i + 1) + " tiene que empezar con «" + names[i] + ":» (el orden es X, Y, D, G).";
    }
  }
  var values = parts.map(function (part) {
    return part.slice(2);
  });
  for (var j = 0; j < 2; j++) {
    if (!/^\d{1,3}$/.test(values[j])) {
      return names[j] + " tiene que ser un número entero de 0 a " + OUTPUT_MAX + ", sin signo ni decimales.";
    }
    if (Number(values[j]) > OUTPUT_MAX) {
      return names[j] + " está fuera de rango: va de 0 a " + OUTPUT_MAX + ".";
    }
  }
  if (!/^\d$/.test(values[2]) || Number(values[2]) > MAX_FINGERS) {
    return "D (los dedos) va de 0 a " + MAX_FINGERS + ".";
  }
  if (!Object.prototype.hasOwnProperty.call(GESTURE_LABELS, values[3])) {
    return "El gesto «" + values[3] + "» no existe. Los válidos son " + Object.keys(GESTURE_LABELS).join(", ") + ".";
  }
  return "No respeta el formato exacto.";
}

function armAction(gesture) {
  if (gesture === "CERRADA") {
    return "Los dos motores giran de a poco a la izquierda, hasta el tope de " + ARM_MIN_ANGLE + "°.";
  }
  if (gesture === "ABIERTA") {
    return "Los dos motores giran de a poco a la derecha, hasta el tope de " + ARM_MAX_ANGLE + "°.";
  }
  return "Los motores se quedan quietos donde están (solo CERRADA y ABIERTA los mueven).";
}

// Qué haría el sketch del brazo con una línea (imita readSerial() y handleLine())
function sketchResponse(line) {
  if (line.length > SKETCH_MAX_LINE) {
    return { ok: false, text: "Responde «ERROR: linea demasiado larga, se descarta» (más de " + SKETCH_MAX_LINE + " caracteres)." };
  }
  if (line === "") {
    return { ok: false, text: "Una línea vacía se ignora." };
  }
  if (line === NO_HAND_MESSAGE) {
    return { ok: true, text: "Los motores se detienen." };
  }
  var match = SKETCH_DATA_PATTERN.exec(line);
  if (match) {
    return { ok: true, text: armAction(match[1]) };
  }
  if (Object.prototype.hasOwnProperty.call(SKETCH_MANUAL, line)) {
    return { ok: true, text: SKETCH_MANUAL[line] };
  }
  return { ok: false, text: "Responde «ERROR: no entiendo» y no mueve nada." };
}

function resultRow(title) {
  var row = el("div", "msg-result");
  var heading = el("p", "msg-result-title");
  var badge = el("span", "msg-badge");
  heading.append(el("strong", "", title), badge);
  var text = el("p", "msg-result-text");
  row.append(heading, text);
  return {
    element: row,
    set: function (isOk, label, detail) {
      row.classList.toggle("is-ok", isOk);
      row.classList.toggle("is-rejected", !isOk);
      badge.textContent = (isOk ? "✓ " : "✕ ") + label; // Ícono y palabra: el estado no depende solo del color
      text.textContent = detail;
    }
  };
}

function rangeField(id, label, max, value) {
  var field = el("div", "msg-field");
  var name = el("label", "msg-field-label", label);
  name.htmlFor = id;
  var input = el("input", "msg-range");
  input.type = "range";
  input.id = id;
  input.min = "0";
  input.max = String(max);
  input.step = "1";
  input.value = String(value);
  var output = el("output", "msg-field-value", String(value));
  output.htmlFor = id;
  input.addEventListener("input", function () {
    output.textContent = input.value;
  });
  field.append(name, input, output);
  return { element: field, input: input };
}

function messageSimulator() {
  var container = section("Probá el mensaje", "msg-sim");
  container.appendChild(el("p", "",
    "Armalo con los controles o escribilo a mano. Lo revisa parseMessage(), la misma función que usa el receptor."));

  // Controles: arman la línea con formatMessage(), igual que el emisor
  var builder = el("div", "msg-builder");
  var handLabel = el("label", "msg-check");
  var handInput = el("input");
  handInput.type = "checkbox";
  handInput.checked = true;
  handLabel.append(handInput, document.createTextNode("Hay una mano frente a la cámara"));
  var xField = rangeField("msgX", "X", OUTPUT_MAX, 52);
  var yField = rangeField("msgY", "Y", OUTPUT_MAX, 31);
  var fingersField = rangeField("msgD", "Dedos", MAX_FINGERS, 5);
  var gestureField = el("div", "msg-field");
  var gestureLabel = el("label", "msg-field-label", "Gesto");
  gestureLabel.htmlFor = "msgG";
  var gestureSelect = el("select", "msg-select");
  gestureSelect.id = "msgG";
  Object.keys(GESTURE_LABELS).forEach(function (code) {
    var option = el("option", "", code + " · " + GESTURE_LABELS[code]);
    option.value = code;
    gestureSelect.appendChild(option);
  });
  gestureSelect.value = "ABIERTA"; // Arranca con un gesto que mueve el brazo
  gestureField.append(gestureLabel, gestureSelect);
  builder.append(handLabel, xField.element, yField.element, fingersField.element, gestureField);

  // La línea que viaja: la escriben los controles, pero también se puede editar a mano
  var lineField = el("div", "msg-line");
  var lineLabel = el("label", "msg-field-label", "Mensaje");
  lineLabel.htmlFor = "msgText";
  var lineInput = el("input", "msg-text");
  lineInput.id = "msgText";
  lineInput.type = "text";
  lineInput.maxLength = 120;
  lineInput.spellcheck = false;
  lineInput.autocomplete = "off";
  lineInput.setAttribute("autocapitalize", "off");
  lineField.append(lineLabel, lineInput);

  var examples = el("div", "msg-examples");
  examples.appendChild(el("span", "msg-examples-label", "Ejemplos:"));
  MESSAGE_EXAMPLES.forEach(function (example) {
    var button = el("button", "msg-example", example.label);
    button.type = "button";
    button.title = example.text;
    button.addEventListener("click", function () {
      lineInput.value = example.text;
      evaluateLine();
    });
    examples.appendChild(button);
  });

  var results = el("div", "msg-results");
  results.setAttribute("aria-live", "polite");
  var receptorRow = resultRow("Receptor · parseMessage()");
  var armRow = resultRow("Arduino · sketch del brazo");
  var ledsRow = resultRow("Arduino · sketch de los LEDs");
  results.append(receptorRow.element, armRow.element, ledsRow.element);

  function evaluateLine() {
    var text = lineInput.value;
    var data = parseMessage(text);
    if (data) {
      // El receptor no reenvía el texto recibido: lo vuelve a armar con formatMessage() a partir de los datos
      var forwarded = formatMessage(data);
      receptorRow.set(true, "Lo acepta", data.hasHand
        ? "X " + data.x + " · Y " + data.y + " · " + data.fingers + (data.fingers === 1 ? " dedo" : " dedos") +
          " · " + GESTURE_LABELS[data.gesture] + ". Reenvía al Arduino: " + forwarded
        : "No hay mano. Reenvía al Arduino: " + forwarded);
      armRow.set(true, "Le llega", sketchResponse(forwarded).text);
      var lit = data.hasHand ? Math.min(data.fingers, LED_COUNT) : 0;
      ledsRow.set(true, "Le llega", lit === 0
        ? "Apaga todos los LEDs."
        : "Enciende " + lit + (lit === 1 ? " LED" : " LEDs") + (data.fingers > LED_COUNT ? " (hay " + LED_COUNT + ": con 4 o 5 dedos quedan los " + LED_COUNT + ")." : "."));
    } else {
      receptorRow.set(false, "Lo descarta", explainRejection(text) + " No se reenvía: queda anotado en el registro.");
      var fallback = sketchResponse(text);
      armRow.set(false, "No le llega", "Si igual llegara, el sketch lo vuelve a revisar: " + fallback.text);
      ledsRow.set(false, "No le llega", "El receptor lo frenó antes del cable.");
    }
  }

  function buildFromControls() {
    var hasHand = handInput.checked;
    [xField.input, yField.input, fingersField.input, gestureSelect].forEach(function (control) {
      control.disabled = !hasHand;
    });
    lineInput.value = formatMessage(hasHand
      ? { hasHand: true, x: Number(xField.input.value), y: Number(yField.input.value), fingers: Number(fingersField.input.value), gesture: gestureSelect.value }
      : { hasHand: false });
    evaluateLine();
  }

  [handInput, xField.input, yField.input, fingersField.input, gestureSelect].forEach(function (control) {
    control.addEventListener("input", buildFromControls);
  });
  lineInput.addEventListener("input", evaluateLine);
  buildFromControls();

  container.append(builder, lineField, examples, results);
  container.appendChild(el("p", "topic-chart-note",
    "El veredicto del receptor es el código real (js/protocol.js). Lo que hace el Arduino se imita acá a partir de los sketches."));
  return container;
}

// ================= Contenido de cada tema =================

function buildHardware(container) {
  // Puerta al banco 3D: las mismas piezas, a tamaño real
  var callout = el("button", "bench-callout");
  callout.type = "button";
  callout.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7zM3.5 7 12 11.5 20.5 7M12 11.5v10" /></svg>';
  var calloutText = el("span");
  calloutText.append(
    el("strong", "", "Ver las piezas en 3D, a tamaño real"),
    el("span", "", "La placa sale del CAD oficial de Arduino; el servo, de su ficha. Todo a la misma escala.")
  );
  callout.appendChild(calloutText);
  callout.addEventListener("click", function () {
    if (callbacks.onBench) {
      callbacks.onBench(callout);
    }
  });
  container.appendChild(callout);
  container.appendChild(wiringDiagram());
  container.appendChild(servoSimulator());

  var boards = section("Uno R3 y Mega 2560: cualquiera de las dos");
  boards.appendChild(el("p", "", "El proyecto usa los pines 5 y 6 (servos), 8, 9 y 10 (LEDs) y el USB: están en las dos placas. La Mega tiene más memoria y pines; el Uno es más chica."));
  boards.appendChild(table(["", "Uno R3", "Mega 2560 Rev3"], BOARD_ROWS, "Comparación entre Arduino Uno R3 y Mega 2560"));
  container.appendChild(boards);

  var safety = section("Seguridad eléctrica");
  safety.appendChild(termList([
    ["No abrir la fuente", "Adentro hay tensión de red y capacitores que quedan cargados aunque esté desenchufada."],
    ["Corriente alta", "Una fuente de PC entrega mucha corriente: un cortocircuito en los 5 V puede quemar un cable. Conviene un fusible."],
    ["GND común, 5 V aparte", "Los motores toman los 5 V de la fuente, nunca del pin 5V del Arduino; los GND de los dos sí van unidos."]
  ]));
  container.appendChild(safety);
}

function buildMessage(container) {
  // Anatomía del mensaje, con los rangos de protocol.js
  var anatomy = el("figure", "topic-figure");
  anatomy.appendChild(el("figcaption", "topic-chart-title", "Anatomía del mensaje"));
  var parts = el("dl", "message-anatomy");
  [
    ["X:52", "Horizontal, de 0 a " + OUTPUT_MAX],
    ["Y:31", "Vertical, de 0 a " + OUTPUT_MAX + " (crece hacia arriba)"],
    ["D:2", "Dedos extendidos, de 0 a " + MAX_FINGERS],
    ["G:V", "Gesto: " + Object.keys(GESTURE_LABELS).join(", ")]
  ].forEach(function (part) {
    var group = el("div");
    group.append(el("dt", "", part[0]), el("dd", "", part[1]));
    parts.appendChild(group);
  });
  anatomy.appendChild(parts);
  anatomy.appendChild(el("p", "topic-chart-note",
    "Si no hay mano, el mensaje es " + NO_HAND_MESSAGE + ". Se manda como máximo " + Math.round(1000 / CONFIG.remoteSendIntervalMs) +
    " veces por segundo, y solo cuando algo cambia."));
  container.appendChild(anatomy);
  container.appendChild(messageSimulator());

  var messages = section("Todos los mensajes del sistema");
  messages.appendChild(table(["Mensaje", "Quién lo manda", "Qué significa"], MESSAGE_ROWS, "Mensajes del protocolo"));
  container.appendChild(messages);

  var validation = section("Validación doble");
  validation.appendChild(termList([
    ["En el receptor", "El mensaje tiene que coincidir con el formato exacto y con los rangos: si no, se descarta y no llega al cable."],
    ["En el Arduino", "El sketch lo vuelve a revisar (largo máximo de 48 caracteres y formato) y responde ERROR si no lo entiende."]
  ]));
  container.appendChild(validation);
}

function buildMqtt(container) {
  var concepts = section("Conceptos");
  concepts.appendChild(termList(MQTT_CONCEPTS));
  container.appendChild(concepts);

  // Rutas reales de los topics, armadas con la misma función que usan el emisor y el receptor
  var topics = buildTopics(CONFIG.topicRoot, CONFIG.defaultRoom);
  var topicSection = section("Topics de una sala");
  topicSection.appendChild(el("p", "", "Ejemplo con la sala «" + CONFIG.defaultRoom + "» y el alias «" + SAMPLE_ALIAS + "». Cada curso usa su propia sala."));
  topicSection.appendChild(table(["Topic", "Publica", "Contenido"], TOPIC_ROWS.map(function (row) {
    var value = topics[row.key];
    return [typeof value === "function" ? value(SAMPLE_ALIAS) : value, row.publisher, row.content];
  }), "Topics MQTT"));
  container.appendChild(topicSection);

  var acl = section("Permisos en el broker");
  acl.appendChild(table(["Usuario", "Acción", "Topics (dentro de robotica/<sala>/)"], ACL_ROWS, "Permisos por usuario en EMQX"));
  container.appendChild(acl);

  // Cuota del plan gratuito: cuántas horas de clase entran en 1 GB
  var handBytes = SAMPLE_MESSAGE.length + topics.studentHand(SAMPLE_ALIAS).length + OVERHEAD_BYTES;
  var handKBs = handBytes * (1000 / CONFIG.remoteSendIntervalMs) / 1000;
  var handMBh = handKBs * 2 * 3600 / 1000;   // entra al broker y sale hacia el profesor
  var jpegMBh = JPEG_FRAME_KB * JPEG_FPS * 2 * 3600 / 1000;
  container.appendChild(barChart({
    title: "Cuántas horas de clase entran en 1 GB (el plan gratuito por mes)",
    rows: [
      { label: "Datos de la mano", value: QUOTA_MB / handMBh, valueText: "≈ " + formatNumber(QUOTA_MB / handMBh, 0) + " h", color: DATA_COLOR,
        detail: "Unos " + formatNumber(handMBh, 1) + " MB por hora con un alumno con el control" },
      { label: "Video como fotos JPEG", value: QUOTA_MB / jpegMBh, valueText: "≈ " + formatNumber(QUOTA_MB / jpegMBh, 1) + " h", color: VIDEO_COLOR,
        detail: "Unos " + formatNumber(jpegMBh, 0) + " MB por hora con un solo alumno mirando" }
    ],
    note: "Estimado. Datos: mensaje de " + SAMPLE_MESSAGE.length + " caracteres con su topic y encabezados (~" + handBytes + " bytes), " +
      Math.round(1000 / CONFIG.remoteSendIntervalMs) + " por segundo, que entra al broker y sale hacia el profesor. Fotos: JPEG de 320 × 240 (~" + formatNumber(JPEG_FRAME_KB, 1) +
      " KB) a " + JPEG_FPS + " por segundo. Por eso el video va por VDO.Ninja y no por el broker."
  }));
}

function buildVideo(container) {
  var paths = section("Directo o con relevo");
  paths.appendChild(termList([
    ["Directo (P2P)", "Las dos computadoras se conectan entre sí. Es lo más rápido, y lo habitual."],
    ["Con relevo (TURN)", "Si un firewall o la red no lo permiten, el video pasa por un servidor intermedio. Sigue cifrado de punta a punta."],
    ["Señalización", "VDO.Ninja solo «presenta» a las dos computadoras. El ID y la clave para encontrarse viajan por el broker."]
  ]));
  container.appendChild(paths);

  // Ancho de banda: datos de la mano frente al tope del video, por alumno
  var topics = buildTopics(CONFIG.topicRoot, CONFIG.defaultRoom);
  var handBytes = SAMPLE_MESSAGE.length + topics.studentHand(SAMPLE_ALIAS).length + OVERHEAD_BYTES;
  var handKBs = handBytes * (1000 / CONFIG.remoteSendIntervalMs) / 1000;
  var videoKBs = CONFIG.videoMaxBitrateKbps / 8;
  container.appendChild(barChart({
    title: "Cuánto viaja por segundo, por alumno",
    rows: [
      { label: "Datos de la mano", value: handKBs, valueText: "≈ " + formatNumber(handKBs, 1) + " KB/s", color: DATA_COLOR,
        detail: Math.round(1000 / CONFIG.remoteSendIntervalMs) + " mensajes por segundo de unos " + handBytes + " bytes" },
      { label: "Video del brazo", value: videoKBs, valueText: "hasta " + formatNumber(videoKBs, 0) + " KB/s", color: VIDEO_COLOR,
        detail: "Tope de " + CONFIG.videoMaxBitrateKbps + " kbps por alumno que mira" }
    ],
    note: "El video usa unas " + formatNumber(Math.round(videoKBs / handKBs / 10) * 10, 0) + " veces más (estimado: mensaje de " +
      SAMPLE_MESSAGE.length + " caracteres, más el topic (" + topics.studentHand(SAMPLE_ALIAS).length + ") y unos " + OVERHEAD_BYTES +
      " bytes de encabezados de MQTT, WebSocket y TLS)."
  }));

  var privacy = section("Privacidad");
  privacy.appendChild(termList([
    ["Solo la cámara del brazo", "Sin audio: el micrófono del profesor no se usa."],
    ["La webcam del alumno no sale de su PC", "El visor del brazo es un iframe sin permiso de cámara ni de micrófono."],
    ["Llave nueva en cada clase", "El ID y la clave del video cambian cada vez que se enciende la cámara."]
  ]));
  container.appendChild(privacy);
}

function buildSecurity(container) {
  // Línea de tiempo de los "hombre muerto" (gráfico de puntos sobre escala logarítmica)
  var rows = [
    { seconds: GESTURE_HOLD_SECONDS, label: "Un gesto nuevo se acepta", where: "Emisor (MediaPipe)", detail: "Un gesto tiene que sostenerse este tiempo para que cuente: evita parpadeos." },
    { seconds: HAND_LOST_SECONDS, label: "La mano se da por perdida", where: "Emisor (MediaPipe)", detail: "Perderla menos tiempo se toma como un parpadeo del detector." },
    { seconds: CONFIG.serialKeepaliveMs / 1000, label: "Latido al Arduino", where: "Receptor", detail: "Con la mano quieta, el receptor repite el estado por USB." },
    { seconds: CONFIG.heartbeatMs / 1000, label: "Latido del emisor", where: "Emisor", detail: "Con la mano quieta, el alumno repite su estado por MQTT." },
    { seconds: ARDUINO_TIMEOUT_SECONDS, label: "El Arduino frena solo", where: "Sketch del brazo", detail: "Si dejan de llegar mensajes por USB, frena los motores por su cuenta." },
    { seconds: CONFIG.handStaleMs / 1000, label: "El receptor detiene el robot", where: "Receptor", detail: "Si el alumno con el control deja de enviar, el robot pasa a SIN_MANO." },
    { seconds: CONFIG.keepaliveSeconds * 1.5, label: "El broker publica el Last Will", where: "Broker", detail: "1,5 veces el keepalive sin noticias: avisa a todos que esa página se cayó." }
  ];
  var minLog = -1;   // 0,1 s
  var maxLog = Math.log10(20);
  function position(seconds) {
    return ((Math.log10(seconds) - minLog) / (maxLog - minLog)) * 100;
  }

  var figure = el("figure", "topic-chart");
  figure.appendChild(el("figcaption", "topic-chart-title", "Cuándo reacciona cada protección (escala logarítmica)"));
  var chart = el("div", "dot-chart");
  // Eje: una celda vacía bajo los nombres y las marcas bajo la columna del gráfico
  var axis = el("div", "dot-axis");
  axis.setAttribute("aria-hidden", "true");
  var axisTrack = el("span", "dot-axis-track");
  [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].forEach(function (tick) {
    // En pantallas angostas solo quedan 0,1 · 1 · 10 s: las demás marcas se encimarían
    var major = tick === 0.1 || tick === 1 || tick === 10;
    var mark = el("span", major ? "dot-tick" : "dot-tick is-minor", formatNumber(tick, tick < 1 ? 1 : 0) + " s");
    mark.style.left = position(tick) + "%";
    axisTrack.appendChild(mark);
  });
  axis.append(el("span"), axisTrack);
  rows.forEach(function (row) {
    var item = el("div", "dot-row");
    var text = el("span", "dot-label");
    text.append(el("strong", "", row.label), el("small", "", row.where));
    var track = el("span", "dot-track");
    [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].forEach(function (tick) {
      var line = el("span", "dot-grid");
      line.style.left = position(tick) + "%";
      track.appendChild(line);
    });
    var dot = el("span", "dot-mark");
    dot.style.left = position(row.seconds) + "%";
    dot.style.setProperty("--color", DATA_COLOR);
    // Ceros finales solo después de la coma: 0,30 → 0,3 (pero 10 queda 10)
    var number = formatNumber(row.seconds, row.seconds < 1 ? 2 : 0).replace(/(,\d*?)0+$/, "$1").replace(/,$/, "");
    var valueText = (row.seconds >= 10 ? "≈ " : "") + number + " s";
    dot.tabIndex = 0;
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", row.label + ": " + valueText + ". " + row.detail);
    bindTooltip(dot, row.label + " · " + valueText, row.where + ". " + row.detail, DATA_COLOR);
    // Cerca del borde derecho, el valor va a la izquierda del punto para no quedar cortado
    var value = el("span", position(row.seconds) > 75 ? "dot-value is-left" : "dot-value", valueText);
    value.style.left = position(row.seconds) + "%";
    track.append(dot, value);
    item.append(text, track);
    chart.appendChild(item);
  });
  chart.appendChild(axis);
  figure.appendChild(chart);
  figure.appendChild(el("p", "topic-chart-note", "Valores del código: config.js, js/hand-tracker.js y el sketch del brazo. Escala logarítmica: de 0,1 a 1 s ocupa lo mismo que de 1 a 10 s, para que se vean juntos tiempos muy distintos."));
  container.appendChild(figure);

  // Escenarios de falla: cada uno se reproduce sobre el diagrama (lo maneja js/arquitectura.js)
  var failures = section("Qué pasa si algo falla");
  failures.appendChild(el("p", "", "Elegí una falla y mirala sobre el diagrama, paso a paso y con sus tiempos."));
  var list = el("ul", "scenario-cards");
  SCENARIOS.forEach(function (scenario) {
    var button = el("button", "scenario-card");
    button.type = "button";
    button.append(
      el("strong", "", scenario.title),
      el("span", "scenario-card-summary", fillTimes(scenario.summary)),
      el("span", "scenario-card-link", "Ver en el diagrama →")
    );
    button.addEventListener("click", function () {
      if (callbacks.onScenario) {
        callbacks.onScenario(scenario.id);
      }
    });
    var item = el("li");
    item.appendChild(button);
    list.appendChild(item);
  });
  failures.appendChild(list);
  container.appendChild(failures);

  var layers = section("Capas de protección");
  layers.appendChild(termList(SECURITY_ITEMS));
  container.appendChild(layers);
}

function buildWeb(container) {
  var stack = section("De qué está hecho");
  stack.appendChild(table(["Parte", "Tecnología", "Archivos"], WEB_ROWS, "Partes del proyecto y sus archivos"));
  container.appendChild(stack);

  var principles = section("Decisiones");
  principles.appendChild(termList(WEB_ITEMS));
  container.appendChild(principles);

  var repo = section("El código");
  var link = el("a", "topic-link", "Ver el repositorio en GitHub");
  link.href = REPO_URL.replace(/blob\/main\/$/, "");
  link.target = "_blank";
  link.rel = "noopener";
  repo.appendChild(link);
  container.appendChild(repo);
}

var BUILDERS = {
  hardware: buildHardware,
  mensaje: buildMessage,
  mqtt: buildMqtt,
  video: buildVideo,
  seguridad: buildSecurity,
  web: buildWeb
};

// ================= Pestañas =================

function tabId(id) {
  return "topicTab-" + id;
}

function panelId(id) {
  return "topicPanel-" + id;
}

function selectTopic(id, moveFocus) {
  activeId = id;
  TOPICS.forEach(function (topic) {
    var tab = document.getElementById(tabId(topic.id));
    var isActive = topic.id === id;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    document.getElementById(panelId(topic.id)).hidden = !isActive;
  });
  // Cada tema se arma la primera vez que se abre
  if (!built[id]) {
    built[id] = true;
    BUILDERS[id](document.getElementById(panelId(id)).querySelector(".topic-content"));
  }
  body.scrollTop = 0;
  var tab = document.getElementById(tabId(id));
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (moveFocus) {
    tab.focus();
  }
}

function buildTabs() {
  TOPICS.forEach(function (topic) {
    var tab = el("button", "topic-tab", topic.label);
    tab.type = "button";
    tab.id = tabId(topic.id);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId(topic.id));
    tab.addEventListener("click", function () {
      selectTopic(topic.id, false);
    });
    tabsList.appendChild(tab);

    var tabPanel = el("section", "topic-panel");
    tabPanel.id = panelId(topic.id);
    tabPanel.setAttribute("role", "tabpanel");
    tabPanel.setAttribute("aria-labelledby", tabId(topic.id));
    tabPanel.hidden = true;
    tabPanel.append(el("h3", "topic-title", topic.title), el("p", "topic-intro", topic.intro), el("div", "topic-content"));
    body.appendChild(tabPanel);
  });

  // Flechas izquierda/derecha, Inicio y Fin entre pestañas (patrón de pestañas de ARIA)
  tabsList.addEventListener("keydown", function (event) {
    var index = TOPICS.findIndex(function (topic) {
      return topic.id === activeId;
    });
    var next = null;
    if (event.key === "ArrowRight") {
      next = (index + 1) % TOPICS.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + TOPICS.length) % TOPICS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = TOPICS.length - 1;
    }
    if (next !== null) {
      event.preventDefault();
      selectTopic(TOPICS[next].id, true);
    }
  });
}

// ================= API =================

export function openTopic(id, from) {
  opener = from || document.activeElement;
  if (callbacks.onOpen) {
    callbacks.onOpen();
  }
  panel.hidden = false;
  selectTopic(id || activeId || TOPICS[0].id, true);
}

export function closeTopics() {
  if (panel.hidden) {
    return;
  }
  panel.hidden = true;
  tooltipApi.hide();
  if (opener && document.contains(opener)) {
    opener.focus({ preventScroll: true });
  }
}

export function isTopicsOpen() {
  return !panel.hidden;
}

// options.tooltip: { showAt, showBelow, move, hide } (el tooltip del diagrama). options.onOpen: se llama al abrir.
// options.onScenario(id): reproducir un escenario de falla sobre el diagrama.
// options.onBench(opener): abrir el banco 3D
export function initTopics(options) {
  panel = document.getElementById("archTopics");
  tabsList = document.getElementById("archTopicsTabs");
  body = document.getElementById("archTopicsBody");
  tooltipApi = options.tooltip;
  callbacks = options;
  buildTabs();
  document.getElementById("archTopicsClose").addEventListener("click", closeTopics);
  body.addEventListener("scroll", tooltipApi.hide, { passive: true });
}
