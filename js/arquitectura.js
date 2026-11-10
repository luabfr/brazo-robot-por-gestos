// Infografía de arquitectura (arquitectura.html): un lienzo a pantalla completa que se puede recorrer.
// - Dibujo: las zonas y las líneas van en SVG; las tarjetas y los textos de las líneas, en HTML encima, con las
//   mismas coordenadas (1 unidad = 1 px a zoom 100 %). Los datos salen de js/arquitectura-contenido.js.
// - Navegación: arrastrar para moverse, rueda o pellizco para acercar, botones y teclado (+, −, 0 y flechas).
// - Detalle: tooltip al pasar sobre una tarjeta o una línea; panel con información desplegable al elegir una tarjeta.
// - Capas: resaltan un recorrido (datos, estado, video, energía, carga de la página o seguridad).

import { REPO_URL, ZONES, ICONS, NODES, EDGES, LAYERS, LAYOUTS, LINE_KINDS } from "./arquitectura-contenido.js";

var SVG_NS = "http://www.w3.org/2000/svg";

// ================= Configuración =================

var NARROW_MAX_WIDTH = 760;  // Ventanas más angostas usan la disposición vertical
var LANE_GAP = 10;           // Separación entre la ida y la vuelta de una misma conexión
var END_GAP = 5;             // Las líneas terminan un poco antes del borde de la tarjeta (ahí apoya la flecha)
var LABEL_OFFSET = 20;       // Distancia de los textos a la fila de tarjetas en los tramos horizontales
var MIN_CURVE = 24;          // Curvatura mínima de las líneas
var GRID_STEP = 28;          // Separación de los puntos de la retícula de fondo (a zoom 100 %)

var ZOOM_STEP = 1.25;        // Cada clic en + o − (y cada pulsación de tecla)
var MIN_ZOOM = 0.5;          // Límites del zoom, relativos al encuadre completo
var MAX_ZOOM = 4;
var PAN_STEP = 80;           // Desplazamiento con las flechas del teclado, en píxeles de pantalla
var DRAG_THRESHOLD = 5;      // Menos que esto es un clic, no un arrastre
var VIEW_MARGIN = 20;        // Margen libre alrededor del diagrama al encuadrar
var KEEP_VISIBLE = 120;      // Al arrastrar, al menos esto del diagrama queda en pantalla
var ANIMATION_MS = 380;
var RESIZE_DELAY_MS = 150;

var WEB_COLOR = "#9aa3b5";   // Línea de carga de la página (la energía usa el ámbar del robot)
var LAYER_NAMES = {
  datos: "datos de la mano",
  estado: "estado y control",
  video: "video",
  energia: "energía",
  web: "carga de la página"
};

// ================= Elementos y estado =================

var app = document.getElementById("archApp");
var viewport = document.getElementById("archViewport");
var world = document.getElementById("archWorld");
var header = document.getElementById("archHeader");
var bottomBar = document.getElementById("archBottom");
var zoomValue = document.getElementById("zoomValue");
var layersBar = document.getElementById("archLayers");
var layerCaption = document.getElementById("archLayerCaption");
var legend = document.getElementById("archLegend");
var panel = document.getElementById("archPanel");
var panelIcon = document.getElementById("archPanelIcon");
var panelZone = document.getElementById("archPanelZone");
var panelTitle = document.getElementById("archPanelTitle");
var panelBody = document.getElementById("archPanelBody");
var tooltip = document.getElementById("archTooltip");
var connectionsList = document.getElementById("archConnections");
var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

var zoneById = {};
ZONES.forEach(function (zone) {
  zoneById[zone.id] = zone;
});
var nodeById = {};
NODES.forEach(function (node) {
  nodeById[node.id] = node;
});

var layoutName = null;
var layout = null;
var view = { x: 0, y: 0, k: 1 };  // Desplazamiento (px) y escala del lienzo
var fitScale = 1;                 // Escala del encuadre completo: es el "100 %"
var animationFrame = null;
var selectedId = null;            // Componente con el panel abierto
var activeLayer = "todo";
var nodeItems = {};               // id → <li> de la tarjeta
var edgeGroups = {};              // id → <g> de la línea
var edgeLabels = {};              // id → texto de la línea
var pointers = new Map();         // Punteros apoyados (mouse, dedo o lápiz)
var drag = null;                  // Arrastre en curso
var pinch = null;                 // Pellizco en curso
var suppressClick = false;        // Un arrastre no tiene que abrir el componente donde terminó

// ================= Utilidades =================

function svgElement(name, attributes) {
  var element = document.createElementNS(SVG_NS, name);
  Object.keys(attributes || {}).forEach(function (key) {
    element.setAttribute(key, attributes[key]);
  });
  return element;
}

// Ícono de línea como texto SVG. Los íconos son contenido propio (js/arquitectura-contenido.js), nunca datos externos
function iconMarkup(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || "") + "</svg>";
}

function zoneColor(nodeId) {
  return zoneById[nodeById[nodeId].zone].color;
}

// Colores de los dos extremos de una línea: los de sus zonas, salvo energía (ámbar) y carga de la página (gris)
function edgeColors(edge) {
  if (edge.kind === "web") {
    return [WEB_COLOR, WEB_COLOR];
  }
  if (edge.kind === "energy") {
    return [zoneById.robot.color, zoneById.robot.color];
  }
  return [zoneColor(edge.from), zoneColor(edge.to)];
}

function edgeName(edge) {
  return nodeById[edge.from].title + " → " + nodeById[edge.to].title;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isNarrowWindow() {
  return window.innerWidth < NARROW_MAX_WIDTH;
}

function createElement(tag, className, text) {
  var element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text; // textContent: el contenido nunca se interpreta como HTML
  }
  return element;
}

// ================= Geometría de las líneas =================

// Sale por el lado de la tarjeta que mira hacia la otra: horizontal si están más lejos en x que en y
function automaticSides(from, to) {
  var dx = to[0] - from[0];
  var dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

// Punto de apoyo en un lado de la tarjeta; shift lo corre a lo largo del lado. dx/dy apunta hacia afuera
function sidePoint(center, side, card, shift) {
  var halfW = card.w / 2;
  var halfH = card.h / 2;
  if (side === "right") {
    return { x: center[0] + halfW + END_GAP, y: center[1] + shift, dx: 1, dy: 0 };
  }
  if (side === "left") {
    return { x: center[0] - halfW - END_GAP, y: center[1] + shift, dx: -1, dy: 0 };
  }
  if (side === "bottom") {
    return { x: center[0] + shift, y: center[1] + halfH + END_GAP, dx: 0, dy: 1 };
  }
  return { x: center[0] + shift, y: center[1] - halfH - END_GAP, dx: 0, dy: -1 };
}

function isHorizontalSide(side) {
  return side === "left" || side === "right";
}

// Curva de Bézier cúbica entre dos tarjetas, y el lugar de su texto
function edgeGeometry(edge) {
  var from = layout.pos[edge.from];
  var to = layout.pos[edge.to];
  var sides = (layout.sides && layout.sides[edge.id]) || automaticSides(from, to);
  var lane = (edge.lane || 0) * LANE_GAP;
  var shift = (layout.laneShift && layout.laneShift[edge.id]) || [0, 0];

  var p0 = sidePoint(from, sides[0], layout.card, lane + shift[0]);
  var p3 = sidePoint(to, sides[1], layout.card, lane + shift[1]);
  var reach = Math.max(MIN_CURVE, Math.max(Math.abs(p3.x - p0.x), Math.abs(p3.y - p0.y)) * 0.5);
  var p1 = { x: p0.x + p0.dx * reach, y: p0.y + p0.dy * reach };
  var p2 = { x: p3.x + p3.dx * reach, y: p3.y + p3.dy * reach };
  var middle = {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8
  };

  // En los tramos horizontales el espacio entre tarjetas es angosto: el texto va arriba de la fila (ida)
  // o debajo (vuelta), centrado en el tramo
  var label = middle;
  if (isHorizontalSide(sides[0]) && isHorizontalSide(sides[1]) && edge.labelAt !== "mid") {
    var rowY = (from[1] + to[1]) / 2;
    var distance = layout.card.h / 2 + LABEL_OFFSET;
    label = { x: middle.x, y: (edge.lane || 0) > 0 ? rowY + distance : rowY - distance };
  }

  return {
    d: "M" + p0.x + " " + p0.y + " C" + p1.x + " " + p1.y + " " + p2.x + " " + p2.y + " " + p3.x + " " + p3.y,
    start: p0,
    end: p3,
    label: label
  };
}

// ================= Dibujo =================

function buildDefs(geometries) {
  var defs = svgElement("defs");

  // Una punta de flecha por color: el de la zona de llegada
  var arrows = {};
  EDGES.forEach(function (edge) {
    arrows[edgeColors(edge)[1]] = true;
  });
  Object.keys(arrows).forEach(function (color, index) {
    var marker = svgElement("marker", {
      id: "arch-arrow-" + index,
      viewBox: "0 0 10 10",
      refX: 8,
      refY: 5,
      markerWidth: 9,
      markerHeight: 9,
      markerUnits: "userSpaceOnUse",
      orient: "auto"
    });
    marker.appendChild(svgElement("path", { d: "M0 1 L9 5 L0 9 Z", fill: color }));
    defs.appendChild(marker);
    arrows[color] = "url(#arch-arrow-" + index + ")";
  });

  // Degradé de cada línea entre los colores de sus dos zonas (en coordenadas del dibujo: funciona con líneas rectas)
  EDGES.forEach(function (edge) {
    var colors = edgeColors(edge);
    if (colors[0] === colors[1]) {
      return;
    }
    var geometry = geometries[edge.id];
    var gradient = svgElement("linearGradient", {
      id: "arch-gradient-" + edge.id,
      gradientUnits: "userSpaceOnUse",
      x1: geometry.start.x,
      y1: geometry.start.y,
      x2: geometry.end.x,
      y2: geometry.end.y
    });
    gradient.appendChild(svgElement("stop", { offset: "0", "stop-color": colors[0] }));
    gradient.appendChild(svgElement("stop", { offset: "1", "stop-color": colors[1] }));
    defs.appendChild(gradient);
  });

  return { defs: defs, arrows: arrows };
}

function drawZones(svg) {
  var isSide = layout.zoneLabels === "side";
  ZONES.forEach(function (zone, index) {
    var range = layout.zones[zone.id];
    var band = isSide
      ? { x: 0, y: range[0], width: layout.width, height: range[1] - range[0] }
      : { x: range[0], y: 0, width: range[1] - range[0], height: layout.height };

    svg.appendChild(svgElement("rect", Object.assign({ class: "arch-zone", fill: zone.color, rx: 0 }, band)));
    if (index > 0) {
      svg.appendChild(svgElement("line", isSide
        ? { class: "arch-zone-divider", x1: 0, y1: range[0], x2: layout.width, y2: range[0] }
        : { class: "arch-zone-divider", x1: range[0], y1: 0, x2: range[0], y2: layout.height }));
    }

    // Nombre de la zona: arriba a la izquierda, o escrito en vertical en el margen (disposición del celular),
    // de abajo hacia arriba y terminando cerca del borde superior de la zona
    var labelX = isSide ? 20 : band.x + 24;
    var labelY = isSide ? band.y + 16 : band.y + 42;
    var label = svgElement("text", { class: "arch-zone-label", x: labelX, y: labelY, fill: zone.color });
    if (isSide) {
      label.setAttribute("transform", "rotate(-90 " + labelX + " " + labelY + ")");
      label.setAttribute("text-anchor", "end");
    }
    label.textContent = zone.label;
    svg.appendChild(label);
  });
}

function drawEdges(svg, geometries, arrows) {
  EDGES.forEach(function (edge) {
    var colors = edgeColors(edge);
    var group = svgElement("g", { class: "arch-edge-group", "data-edge": edge.id });
    var path = svgElement("path", {
      class: "arch-edge arch-edge--" + edge.kind,
      d: geometries[edge.id].d,
      stroke: colors[0] === colors[1] ? colors[0] : "url(#arch-gradient-" + edge.id + ")"
    });
    if (edge.arrow !== false) {
      path.setAttribute("marker-end", arrows[colors[1]]);
    }
    // Trazo invisible y ancho encima de la línea: es el que recibe el mouse para el tooltip
    var hitArea = svgElement("path", { class: "arch-edge-hit", d: geometries[edge.id].d, "data-edge": edge.id });
    group.append(path, hitArea);
    svg.appendChild(group);
    edgeGroups[edge.id] = group;
  });
}

// Posición en coordenadas del lienzo: el CSS la convierte en left/top
function placeAt(element, x, y) {
  element.style.setProperty("--x", String(x));
  element.style.setProperty("--y", String(y));
}

function drawLabels(container, geometries) {
  EDGES.forEach(function (edge) {
    var text = layoutName === "narrow"
      ? edge.narrowLabel || (edge.labelNarrow === false ? null : edge.label)
      : edge.label;
    if (!text) {
      return;
    }
    var label = createElement("span", "arch-label" + (edge.mono ? " arch-label--mono" : ""), text);
    label.style.setProperty("--color", edgeColors(edge)[1]);
    placeAt(label, geometries[edge.id].label.x, geometries[edge.id].label.y);
    container.appendChild(label);
    edgeLabels[edge.id] = label;
  });
}

function drawNodes() {
  var list = createElement("ul", "arch-nodes");
  list.setAttribute("aria-label", "Componentes del sistema");

  NODES.forEach(function (node) {
    var position = layout.pos[node.id];
    var item = createElement("li", "arch-node-item");
    item.style.setProperty("--zone", zoneColor(node.id));
    placeAt(item, position[0], position[1]);

    var button = createElement("button", "arch-node");
    button.type = "button";
    button.dataset.node = node.id;
    button.setAttribute("aria-controls", "archPanel");
    button.setAttribute("aria-expanded", "false");

    var icon = createElement("span", "arch-node-icon");
    icon.innerHTML = iconMarkup(node.icon);
    var text = createElement("span", "arch-node-text");
    text.append(
      createElement("strong", "", node.title),
      createElement("small", "", node.tech),
      // Para lectores de pantalla: la zona y la explicación corta (el tooltip es solo visual)
      createElement("span", "visually-hidden", " (" + zoneById[node.zone].label + "): " + node.tooltip)
    );
    button.append(icon, text);
    item.appendChild(button);
    list.appendChild(item);
    nodeItems[node.id] = item;
  });
  return list;
}

function render(name) {
  layoutName = name;
  layout = LAYOUTS[name];
  nodeItems = {};
  edgeGroups = {};
  edgeLabels = {};

  var geometries = {};
  EDGES.forEach(function (edge) {
    geometries[edge.id] = edgeGeometry(edge);
  });

  world.textContent = "";
  world.dataset.layout = name;
  world.style.width = layout.width + "px";
  world.style.height = layout.height + "px";
  world.style.setProperty("--card-w", String(layout.card.w));
  world.style.setProperty("--card-h", String(layout.card.h));

  var svg = svgElement("svg", {
    width: layout.width,
    height: layout.height,
    viewBox: "0 0 " + layout.width + " " + layout.height,
    "aria-hidden": "true",
    focusable: "false"
  });
  var defs = buildDefs(geometries);
  svg.appendChild(defs.defs);
  drawZones(svg);
  drawEdges(svg, geometries, defs.arrows);

  // Los textos de las líneas repiten lo que dice la lista de conexiones (oculta a la vista)
  var labels = createElement("div", "arch-labels");
  labels.setAttribute("aria-hidden", "true");
  drawLabels(labels, geometries);

  world.append(svg, labels, drawNodes());
  applyHighlight();
}

// ================= Zoom y desplazamiento =================

function setView(x, y, k) {
  view.x = x;
  view.y = y;
  view.k = k;
  world.style.transform = "translate(" + x + "px, " + y + "px) scale(" + k + ")";
  // La retícula de puntos acompaña al lienzo: se mueve y cambia de tamaño con él
  var step = GRID_STEP * k;
  viewport.style.backgroundSize = step + "px " + step + "px, 100% 100%";
  viewport.style.backgroundPosition = x + "px " + y + "px, 0 0";
  zoomValue.textContent = Math.round((k / fitScale) * 100) + " %";
}

function clampScale(k) {
  return clamp(k, fitScale * MIN_ZOOM, fitScale * MAX_ZOOM);
}

// Que el diagrama no se pierda fuera de la pantalla: siempre queda a la vista al menos KEEP_VISIBLE px
function clampPosition(x, y, k) {
  var width = viewport.clientWidth;
  var height = viewport.clientHeight;
  return {
    x: clamp(x, KEEP_VISIBLE - layout.width * k, width - KEEP_VISIBLE),
    y: clamp(y, KEEP_VISIBLE - layout.height * k, height - KEEP_VISIBLE)
  };
}

// Zona de la pantalla que no tapan los paneles flotantes: ahí se encuadra y se centra
function freeArea(includePanel) {
  var width = viewport.clientWidth;
  var height = viewport.clientHeight;
  var top = Math.max(VIEW_MARGIN, header.getBoundingClientRect().bottom + 12);
  var bottom = Math.max(VIEW_MARGIN, height - bottomBar.getBoundingClientRect().top + 12);
  var right = VIEW_MARGIN;
  if (includePanel && !panel.hidden) {
    var panelRect = panel.getBoundingClientRect();
    if (layoutName === "narrow") {
      bottom = Math.max(bottom, height - panelRect.top + 12);
    } else {
      right = Math.max(right, width - panelRect.left + 12);
    }
  }
  return {
    left: VIEW_MARGIN,
    top: top,
    width: Math.max(80, width - VIEW_MARGIN - right),
    height: Math.max(80, height - top - bottom)
  };
}

function moveTo(x, y, k, animate) {
  cancelAnimationFrame(animationFrame);
  if (!animate || reducedMotion.matches) {
    setView(x, y, k);
    return;
  }
  var from = { x: view.x, y: view.y, k: view.k };
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / ANIMATION_MS);
    var eased = 1 - Math.pow(1 - t, 3);
    setView(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased, from.k + (k - from.k) * eased);
    if (t < 1) {
      animationFrame = requestAnimationFrame(step);
    }
  }
  animationFrame = requestAnimationFrame(step);
}

// Encuadre completo. En el celular el diagrama es alto y angosto: se ajusta al ancho y se recorre hacia abajo
function fitView(animate) {
  var area = freeArea(false);
  fitScale = layoutName === "narrow"
    ? area.width / layout.width
    : Math.min(area.width / layout.width, area.height / layout.height);

  var current = panel.hidden ? area : freeArea(true);
  var k = layoutName === "narrow" ? fitScale : Math.min(fitScale, current.width / layout.width, current.height / layout.height);
  var x = current.left + (current.width - layout.width * k) / 2;
  var y = layoutName === "narrow" ? current.top : current.top + (current.height - layout.height * k) / 2;
  moveTo(x, y, k, animate);
}

// Zoom manteniendo fijo el punto de la pantalla (sx, sy): lo que está bajo el puntero no se mueve
function zoomAt(factor, sx, sy, animate) {
  var k = clampScale(view.k * factor);
  var x = sx - (sx - view.x) * (k / view.k);
  var y = sy - (sy - view.y) * (k / view.k);
  var position = clampPosition(x, y, k);
  moveTo(position.x, position.y, k, animate);
}

function zoomAtCenter(factor) {
  var area = freeArea(true);
  zoomAt(factor, area.left + area.width / 2, area.top + area.height / 2, true);
}

// Centra un componente en la zona libre; si el zoom está muy lejos, se acerca hasta el encuadre completo
function centerOn(nodeId, animate) {
  var area = freeArea(true);
  var position = layout.pos[nodeId];
  var k = Math.max(view.k, fitScale);
  moveTo(area.left + area.width / 2 - position[0] * k, area.top + area.height / 2 - position[1] * k, k, animate);
}

// Al llegar con el teclado a un componente que está fuera de la pantalla, se lo trae a la vista
function ensureVisible(nodeId) {
  var area = freeArea(true);
  var position = layout.pos[nodeId];
  var x = view.x + position[0] * view.k;
  var y = view.y + position[1] * view.k;
  var halfW = (layout.card.w / 2) * view.k;
  var halfH = (layout.card.h / 2) * view.k;
  var isInside = x - halfW >= area.left && x + halfW <= area.left + area.width &&
                 y - halfH >= area.top && y + halfH <= area.top + area.height;
  if (!isInside) {
    centerOn(nodeId, true);
  }
}

// ================= Arrastre, pellizco y rueda =================

function pointerList() {
  return Array.from(pointers.values());
}

function startPinch() {
  var points = pointerList();
  var middle = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  pinch = {
    distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1,
    k: view.k,
    worldX: (middle.x - view.x) / view.k,
    worldY: (middle.y - view.y) / view.k
  };
  pointers.forEach(function (point, id) {
    viewport.setPointerCapture(id);
  });
  if (drag) {
    drag.moved = true;
  }
}

function updatePinch() {
  var points = pointerList();
  var middle = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  var distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  var k = clampScale(pinch.k * distance / pinch.distance);
  var position = clampPosition(middle.x - pinch.worldX * k, middle.y - pinch.worldY * k, k);
  setView(position.x, position.y, k);
}

function handlePointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, moved: false };
  } else if (pointers.size === 2) {
    hideTooltip();
    startPinch();
  }
}

function handlePointerMove(event) {
  if (!pointers.has(event.pointerId)) {
    return;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pinch && pointers.size >= 2) {
    updatePinch();
    return;
  }
  if (!drag || event.pointerId !== drag.id) {
    return;
  }
  var dx = event.clientX - drag.startX;
  var dy = event.clientY - drag.startY;
  // Recién al superar el umbral se toma el puntero: antes, un clic en una tarjeta funciona normalmente
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    drag.moved = true;
    cancelAnimationFrame(animationFrame);
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
    hideTooltip();
  }
  var position = clampPosition(drag.viewX + dx, drag.viewY + dy, view.k);
  setView(position.x, position.y, view.k);
}

function handlePointerEnd(event) {
  if (!pointers.has(event.pointerId)) {
    return;
  }
  pointers.delete(event.pointerId);
  if (drag && drag.moved) {
    suppressClick = true;
    // El clic (si llega) se dispara enseguida después de soltar; si no llega, la marca no tiene que quedar puesta
    setTimeout(function () {
      suppressClick = false;
    }, 0);
  }
  if (pointers.size < 2) {
    pinch = null;
  }
  if (pointers.size === 0) {
    drag = null;
    viewport.classList.remove("is-dragging");
  }
}

function handleWheel(event) {
  event.preventDefault();
  hideTooltip();
  // deltaMode 1 = líneas y 2 = páginas (Firefox); con Ctrl, el gesto de pellizco del touchpad
  var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
  var factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015));
  var rect = viewport.getBoundingClientRect();
  zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top, false);
}

// ================= Tooltip =================

function showTooltip(title, text, color) {
  tooltip.textContent = "";
  tooltip.style.setProperty("--color", color);
  tooltip.append(createElement("strong", "", title), createElement("p", "", text));
  tooltip.hidden = false;
}

// Junto al puntero, sin salirse de la pantalla
function placeTooltipAt(clientX, clientY) {
  var rect = tooltip.getBoundingClientRect();
  var left = clientX + 18;
  var top = clientY + 20;
  if (left + rect.width > window.innerWidth - 8) {
    left = clientX - rect.width - 18;
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = clientY - rect.height - 20;
  }
  tooltip.style.left = Math.max(8, left) + "px";
  tooltip.style.top = Math.max(8, top) + "px";
}

// Debajo de un elemento (o arriba, si no entra): para cuando se llega con el teclado
function placeTooltipBelow(element) {
  var target = element.getBoundingClientRect();
  var rect = tooltip.getBoundingClientRect();
  var left = clamp(target.left + target.width / 2 - rect.width / 2, 8, window.innerWidth - rect.width - 8);
  var top = target.bottom + 12;
  if (top + rect.height > window.innerHeight - 8) {
    top = target.top - rect.height - 12;
  }
  tooltip.style.left = left + "px";
  tooltip.style.top = Math.max(8, top) + "px";
}

function hideTooltip() {
  tooltip.hidden = true;
}

function nodeTooltip(nodeId) {
  var node = nodeById[nodeId];
  showTooltip(node.title, node.tooltip, zoneColor(nodeId));
}

function edgeTooltip(edgeId) {
  var edge = EDGES.find(function (item) {
    return item.id === edgeId;
  });
  showTooltip(edgeName(edge), edge.detail, edgeColors(edge)[1]);
}

// Con el dedo no hay "pasar por encima": el detalle se ve en el panel al tocar
function handleHover(event) {
  if (event.pointerType === "touch" || (drag && drag.moved)) {
    return;
  }
  var node = event.target.closest(".arch-node");
  var edge = event.target.closest(".arch-edge-hit");
  if (node) {
    nodeTooltip(node.dataset.node);
  } else if (edge) {
    edgeTooltip(edge.dataset.edge);
  } else {
    hideTooltip();
    return;
  }
  placeTooltipAt(event.clientX, event.clientY);
}

// ================= Resaltado: componente elegido o capa activa =================

function applyHighlight() {
  var activeNodes = null;
  var activeEdges = null;

  if (selectedId) {
    // El componente elegido, sus conexiones y sus vecinos
    activeNodes = new Set([selectedId]);
    activeEdges = new Set();
    EDGES.forEach(function (edge) {
      if (edge.from === selectedId || edge.to === selectedId) {
        activeEdges.add(edge.id);
        activeNodes.add(edge.from);
        activeNodes.add(edge.to);
      }
    });
  } else if (activeLayer === "seguridad") {
    activeNodes = new Set(NODES.filter(function (node) {
      return node.security;
    }).map(function (node) {
      return node.id;
    }));
    activeEdges = new Set();
  } else if (activeLayer !== "todo") {
    activeNodes = new Set();
    activeEdges = new Set();
    EDGES.forEach(function (edge) {
      if (edge.layer === activeLayer) {
        activeEdges.add(edge.id);
        activeNodes.add(edge.from);
        activeNodes.add(edge.to);
      }
    });
  }

  world.classList.toggle("is-filtered", activeNodes !== null);
  Object.keys(nodeItems).forEach(function (id) {
    nodeItems[id].classList.toggle("is-active", Boolean(activeNodes && activeNodes.has(id)));
    nodeItems[id].classList.toggle("is-selected", id === selectedId);
    nodeItems[id].firstChild.setAttribute("aria-expanded", String(id === selectedId));
  });
  Object.keys(edgeGroups).forEach(function (id) {
    var isActive = Boolean(activeEdges && activeEdges.has(id));
    edgeGroups[id].classList.toggle("is-active", isActive);
    if (edgeLabels[id]) {
      edgeLabels[id].classList.toggle("is-active", isActive);
    }
  });
}

// ================= Capas =================

function setLayer(id) {
  activeLayer = id;
  layersBar.querySelectorAll(".arch-layer").forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.dataset.layer === id));
  });
  var layer = LAYERS.find(function (item) {
    return item.id === id;
  });
  layerCaption.textContent = layer.caption;
  if (selectedId) {
    closePanel(false);
  } else {
    applyHighlight();
  }
}

function buildLayers() {
  LAYERS.forEach(function (layer) {
    var button = createElement("button", "arch-layer", layer.label);
    button.type = "button";
    button.dataset.layer = layer.id;
    button.setAttribute("aria-pressed", String(layer.id === activeLayer));
    button.addEventListener("click", function () {
      setLayer(layer.id);
    });
    layersBar.appendChild(button);
  });
  layerCaption.textContent = LAYERS[0].caption;
}

// ================= Panel de detalle =================

function detailsSection(title, content, isOpen) {
  var section = createElement("details", "arch-panel-section");
  section.open = isOpen;
  section.append(createElement("summary", "", title), content);
  return section;
}

function bulletList(items) {
  var list = createElement("ul", "arch-panel-list");
  items.forEach(function (item) {
    list.appendChild(createElement("li", "", item));
  });
  return list;
}

// Conexiones del componente: cada una es un botón que lleva al componente vecino
function connectionsContent(nodeId) {
  var container = createElement("div", "arch-panel-connections");
  [
    { title: "Recibe de", match: function (edge) { return edge.to === nodeId; }, other: "from" },
    { title: "Envía a", match: function (edge) { return edge.from === nodeId; }, other: "to" }
  ].forEach(function (group) {
    var edges = EDGES.filter(group.match);
    if (edges.length === 0) {
      return;
    }
    container.appendChild(createElement("p", "arch-panel-connections-title", group.title));
    var list = createElement("ul", "arch-panel-links");
    edges.forEach(function (edge) {
      var otherId = edge[group.other];
      var button = createElement("button", "arch-connection");
      button.type = "button";
      button.style.setProperty("--zone", zoneColor(otherId));
      button.append(
        createElement("strong", "", nodeById[otherId].title),
        createElement("span", "", edge.detail)
      );
      button.addEventListener("click", function () {
        selectNode(otherId, true);
      });
      var item = createElement("li");
      item.appendChild(button);
      list.appendChild(item);
    });
    container.appendChild(list);
  });
  return container;
}

function linksContent(details) {
  var list = createElement("ul", "arch-panel-list arch-panel-files");
  (details.files || []).forEach(function (file) {
    var link = createElement("a", "", file);
    link.href = REPO_URL + file;
    link.target = "_blank";
    link.rel = "noopener";
    var item = createElement("li");
    item.appendChild(link);
    list.appendChild(item);
  });
  (details.links || []).forEach(function (entry) {
    var link = createElement("a", "", entry.label);
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener";
    var item = createElement("li");
    item.appendChild(link);
    list.appendChild(item);
  });
  return list;
}

function fillPanel(node) {
  var details = node.details;
  panel.style.setProperty("--zone", zoneColor(node.id));
  panelIcon.innerHTML = iconMarkup(node.icon);
  panelZone.textContent = zoneById[node.zone].label + " · " + node.tech;
  panelTitle.textContent = node.title;

  panelBody.textContent = "";
  panelBody.appendChild(createElement("p", "arch-panel-lead", node.tooltip));
  panelBody.appendChild(detailsSection("Qué es", createElement("p", "", details.what), true));
  panelBody.appendChild(detailsSection("Por qué así", createElement("p", "", details.why), true));
  if (details.facts && details.facts.length) {
    panelBody.appendChild(detailsSection("Datos clave", bulletList(details.facts), true));
  }
  panelBody.appendChild(detailsSection("Conexiones", connectionsContent(node.id), false));
  if (details.failure) {
    panelBody.appendChild(detailsSection("Si algo falla", createElement("p", "", details.failure), false));
  }
  if ((details.files && details.files.length) || (details.links && details.links.length)) {
    panelBody.appendChild(detailsSection("Archivos y enlaces", linksContent(details), false));
  }
  panelBody.scrollTop = 0;
}

function selectNode(nodeId, moveFocus) {
  selectedId = nodeId;
  fillPanel(nodeById[nodeId]);
  panel.hidden = false;
  app.classList.add("is-panel-open");
  hideTooltip();
  applyHighlight();
  centerOn(nodeId, true);
  if (moveFocus) {
    panelTitle.focus({ preventScroll: true });
  }
}

function closePanel(returnFocus) {
  var previous = selectedId;
  selectedId = null;
  panel.hidden = true;
  app.classList.remove("is-panel-open");
  applyHighlight();
  if (returnFocus && previous && nodeItems[previous]) {
    nodeItems[previous].firstChild.focus({ preventScroll: true });
  }
}

// ================= Leyenda y texto alternativo =================

function buildLegend() {
  var zones = createElement("ul", "arch-legend-group");
  zones.setAttribute("aria-label", "Zonas");
  ZONES.forEach(function (zone) {
    var item = createElement("li", "arch-legend-zone", zone.label);
    item.style.setProperty("--color", zone.color);
    zones.appendChild(item);
  });

  var lines = createElement("ul", "arch-legend-group");
  lines.setAttribute("aria-label", "Tipos de línea");
  LINE_KINDS.forEach(function (lineKind) {
    var item = createElement("li");
    var sample = svgElement("svg", { viewBox: "0 0 40 10", class: "arch-legend-line", "aria-hidden": "true" });
    sample.appendChild(svgElement("line", { class: "arch-edge arch-edge--" + lineKind.kind, x1: 2, y1: 5, x2: 38, y2: 5 }));
    item.append(sample, document.createTextNode(lineKind.label));
    lines.appendChild(item);
  });

  legend.append(zones, lines);
}

function buildConnectionsList() {
  EDGES.forEach(function (edge) {
    connectionsList.appendChild(createElement("li", "", edgeName(edge) + ": " + edge.detail + " (" + LAYER_NAMES[edge.layer] + ")"));
  });
}

// ================= Eventos =================

function handleKeyDown(event) {
  var handled = true;
  switch (event.key) {
    case "+":
    case "=":
      zoomAtCenter(ZOOM_STEP);
      break;
    case "-":
    case "_":
      zoomAtCenter(1 / ZOOM_STEP);
      break;
    case "0":
      fitView(true);
      break;
    case "ArrowLeft":
      moveTo(view.x + PAN_STEP, view.y, view.k, true);
      break;
    case "ArrowRight":
      moveTo(view.x - PAN_STEP, view.y, view.k, true);
      break;
    case "ArrowUp":
      moveTo(view.x, view.y + PAN_STEP, view.k, true);
      break;
    case "ArrowDown":
      moveTo(view.x, view.y - PAN_STEP, view.k, true);
      break;
    default:
      handled = false;
  }
  if (handled) {
    event.preventDefault();
    hideTooltip();
  }
}

function updateLayout(animate) {
  var name = isNarrowWindow() ? "narrow" : "wide";
  if (name !== layoutName) {
    render(name);
  }
  fitView(animate);
}

viewport.addEventListener("pointerdown", handlePointerDown);
viewport.addEventListener("pointermove", handlePointerMove);
viewport.addEventListener("pointerup", handlePointerEnd);
viewport.addEventListener("pointercancel", handlePointerEnd);
viewport.addEventListener("wheel", handleWheel, { passive: false });
viewport.addEventListener("keydown", handleKeyDown);

// Fase de captura: un arrastre que termina sobre una tarjeta no la abre
viewport.addEventListener("click", function (event) {
  if (suppressClick) {
    event.stopPropagation();
    event.preventDefault();
    suppressClick = false;
  }
}, true);

world.addEventListener("click", function (event) {
  var node = event.target.closest(".arch-node");
  if (node) {
    selectNode(node.dataset.node, event.detail === 0); // detail 0: activado con el teclado
  }
});

world.addEventListener("pointerover", handleHover);
world.addEventListener("pointermove", function (event) {
  if (!tooltip.hidden && event.pointerType !== "touch") {
    placeTooltipAt(event.clientX, event.clientY);
  }
});
world.addEventListener("pointerout", function (event) {
  if (!event.relatedTarget || !world.contains(event.relatedTarget)) {
    hideTooltip();
  }
});

world.addEventListener("focusin", function (event) {
  var node = event.target.closest(".arch-node");
  if (node && event.target.matches(":focus-visible")) {
    ensureVisible(node.dataset.node);
    nodeTooltip(node.dataset.node);
    placeTooltipBelow(node);
  }
});
world.addEventListener("focusout", hideTooltip);

document.getElementById("zoomInButton").addEventListener("click", function () {
  zoomAtCenter(ZOOM_STEP);
});
document.getElementById("zoomOutButton").addEventListener("click", function () {
  zoomAtCenter(1 / ZOOM_STEP);
});
document.getElementById("zoomFitButton").addEventListener("click", function () {
  fitView(true);
});
document.getElementById("archPanelClose").addEventListener("click", function () {
  closePanel(true);
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    hideTooltip();
    if (!panel.hidden) {
      closePanel(true);
    }
  }
});

var resizeTimer = null;
window.addEventListener("resize", function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    updateLayout(false);
  }, RESIZE_DELAY_MS);
});

// ================= Arranque =================

buildLegend();
buildLayers();
buildConnectionsList();
// En el celular el zoom va justo arriba de la barra de capas, cuyo alto cambia (texto de la capa, leyenda abierta)
new ResizeObserver(function () {
  app.style.setProperty("--bottom-h", bottomBar.offsetHeight + "px");
}).observe(bottomBar);

// La leyenda empieza cerrada: abierta, crece hacia arriba como un panel más, sin mover el diagrama
updateLayout(false);
