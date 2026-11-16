// Convierte el CAD oficial de una placa Arduino (archivo .brd de Eagle, XML) en un JSON chico para el banco 3D
// de la infografía (js/arquitectura-3d.js). Extrae el contorno de la placa, los agujeros de montaje y cada
// componente con su posición, su tamaño en planta y su tipo. Todo en milímetros, con el origen en la esquina
// inferior izquierda de la placa.
//
// Uso:   node tools/eagle-a-json.mjs <archivo.brd> <salida.json> "<descripción de la fuente>"
// Ej.:   node tools/eagle-a-json.mjs UNO-TH_Rev3e.brd data/placa-uno-r3.json "Arduino UNO R3 (A000066)"
//
// Licencia: el CAD de Arduino es CC-BY-SA 4.0; el JSON generado es una obra derivada y se comparte con la misma
// licencia (ver data/LICENCIA-CAD.md).
// Lectura con expresiones regulares, sin dependencias: alcanza para el XML de Eagle, que es regular y plano.

import { readFileSync, writeFileSync } from "node:fs";

var ARC_STEPS = 8;          // Segmentos con que se aproxima cada arco del contorno
var JOIN_TOLERANCE = 0.01;  // mm: dos extremos más cerca que esto se consideran el mismo punto
var DECIMALS = 2;

// ================= Lectura del XML =================

function attributes(tag) {
  var result = {};
  var pattern = /([\w:-]+)="([^"]*)"/g;
  var match;
  while ((match = pattern.exec(tag)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

// Etiquetas <name .../> o <name ...> dentro de un texto
function tags(text, name) {
  var list = [];
  var pattern = new RegExp("<" + name + "\\s[^>]*>", "g");
  var match;
  while ((match = pattern.exec(text)) !== null) {
    list.push(attributes(match[0]));
  }
  return list;
}

function section(text, name) {
  var start = text.indexOf("<" + name + ">");
  var end = text.indexOf("</" + name + ">");
  if (start < 0 || end < 0) {
    throw new Error("El archivo no tiene la sección <" + name + ">: ¿es un .brd de Eagle 6 o posterior?");
  }
  return text.slice(start, end);
}

function round(value) {
  var factor = Math.pow(10, DECIMALS);
  return Math.round(value * factor) / factor;
}

// ================= Contorno de la placa (capa 20, Dimension) =================

// Puntos de un arco de Eagle: va de (x1, y1) a (x2, y2) girando "curve" grados (positivo = antihorario)
function arcPoints(x1, y1, x2, y2, curveDegrees) {
  var angle = (curveDegrees * Math.PI) / 180;
  var chord = Math.hypot(x2 - x1, y2 - y1);
  var radius = chord / (2 * Math.sin(Math.abs(angle) / 2));
  var midX = (x1 + x2) / 2;
  var midY = (y1 + y2) / 2;
  var distance = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
  // El centro queda a la izquierda de la cuerda si el giro es antihorario
  var sign = angle > 0 ? 1 : -1;
  var normalX = -(y2 - y1) / chord;
  var normalY = (x2 - x1) / chord;
  var centerX = midX + sign * normalX * distance;
  var centerY = midY + sign * normalY * distance;
  var start = Math.atan2(y1 - centerY, x1 - centerX);
  var points = [];
  for (var i = 1; i <= ARC_STEPS; i++) {
    var a = start + (angle * i) / ARC_STEPS;
    points.push([centerX + radius * Math.cos(a), centerY + radius * Math.sin(a)]);
  }
  return points;
}

// Une los tramos sueltos de la capa 20 en un polígono cerrado
function buildOutline(wires) {
  var segments = wires.map(function (wire) {
    var x1 = Number(wire.x1);
    var y1 = Number(wire.y1);
    var x2 = Number(wire.x2);
    var y2 = Number(wire.y2);
    var points = wire.curve ? arcPoints(x1, y1, x2, y2, Number(wire.curve)) : [[x2, y2]];
    return { start: [x1, y1], end: [x2, y2], points: points, curve: wire.curve ? Number(wire.curve) : 0 };
  });
  if (segments.length === 0) {
    throw new Error("No hay contorno en la capa 20 (Dimension).");
  }
  var near = function (a, b) {
    return Math.abs(a[0] - b[0]) < JOIN_TOLERANCE && Math.abs(a[1] - b[1]) < JOIN_TOLERANCE;
  };
  var polygon = [segments[0].start].concat(segments[0].points);
  var current = segments[0].end;
  var pending = segments.slice(1);
  while (pending.length) {
    var index = pending.findIndex(function (segment) {
      return near(segment.start, current) || near(segment.end, current);
    });
    if (index < 0) {
      // Contorno con más de una figura (recortes internos): se usa solo la primera, que es el borde exterior
      console.warn("Aviso: quedaron " + pending.length + " tramos del contorno sin unir; se ignoran.");
      break;
    }
    var segment = pending.splice(index, 1)[0];
    if (near(segment.start, current)) {
      polygon = polygon.concat(segment.points);
      current = segment.end;
    } else {
      // Tramo al revés: si es un arco, se recalcula en el otro sentido
      var reversed = segment.curve
        ? arcPoints(segment.end[0], segment.end[1], segment.start[0], segment.start[1], -segment.curve)
        : [segment.start];
      polygon = polygon.concat(reversed);
      current = segment.start;
    }
  }
  // El último punto repite el primero: se quita
  if (near(polygon[0], polygon[polygon.length - 1])) {
    polygon.pop();
  }
  return polygon;
}

// ================= Encapsulados (packages) =================

// Capas que dibujan el cuerpo del componente: serigrafía (21/22), documentación (51/52) y cobre de los pads (1/16)
var BODY_LAYERS = { "1": true, "16": true, "21": true, "22": true, "51": true, "52": true };

function rotatePoint(x, y, degrees) {
  var a = (degrees * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

function packageBounds(body) {
  var box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  function add(x, y, margin) {
    box.minX = Math.min(box.minX, x - margin);
    box.maxX = Math.max(box.maxX, x + margin);
    box.minY = Math.min(box.minY, y - margin);
    box.maxY = Math.max(box.maxY, y + margin);
  }
  tags(body, "wire").forEach(function (wire) {
    if (BODY_LAYERS[wire.layer]) {
      var half = Number(wire.width || 0) / 2;
      add(Number(wire.x1), Number(wire.y1), half);
      add(Number(wire.x2), Number(wire.y2), half);
    }
  });
  tags(body, "rectangle").forEach(function (rect) {
    if (BODY_LAYERS[rect.layer]) {
      add(Number(rect.x1), Number(rect.y1), 0);
      add(Number(rect.x2), Number(rect.y2), 0);
    }
  });
  tags(body, "circle").forEach(function (circle) {
    if (BODY_LAYERS[circle.layer]) {
      add(Number(circle.x), Number(circle.y), Number(circle.radius) + Number(circle.width || 0) / 2);
    }
  });
  tags(body, "smd").forEach(function (smd) {
    var rotation = Number(String(smd.rot || "R0").replace(/[^\d.]/g, "")) || 0;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (corner) {
      var p = rotatePoint((corner[0] * Number(smd.dx)) / 2, (corner[1] * Number(smd.dy)) / 2, rotation);
      add(Number(smd.x) + p[0], Number(smd.y) + p[1], 0);
    });
  });
  tags(body, "pad").forEach(function (pad) {
    // Sin diámetro explícito, Eagle usa uno automático: alcanza con el agujero más un anillo
    var diameter = Number(pad.diameter) || Number(pad.drill) * 1.6;
    add(Number(pad.x), Number(pad.y), diameter / 2);
  });
  return box.minX === Infinity ? null : box;
}

function readPackages(text) {
  var packages = {};
  var libraries = section(text, "libraries");
  var libraryPattern = /<library\s([^>]*)>([\s\S]*?)<\/library>/g;
  var library;
  while ((library = libraryPattern.exec(libraries)) !== null) {
    var libraryName = attributes(library[1]).name;
    var packagePattern = /<package\s([^>]*)>([\s\S]*?)<\/package>/g;
    var pkg;
    while ((pkg = packagePattern.exec(library[2])) !== null) {
      var key = libraryName + "/" + attributes(pkg[1]).name;
      if (!packages[key]) {
        packages[key] = packageBounds(pkg[2]);
      }
    }
  }
  return packages;
}

// ================= Tipo de cada componente =================
// Se decide por el encapsulado y el valor. La altura de los headers sale del valor (p. ej. "8x1F-H8.5")

function classify(element) {
  var pkg = element.package.toUpperCase();
  var value = (element.value || "").toUpperCase();
  if (/FIDUCIA/.test(pkg) || pkg === "SJ" || /\bNM\b/.test(value) || /LOGO|DOC|MARK/.test(pkg)) {
    return null; // Marcas de fabricación, puentes de soldadura y componentes que no se montan
  }
  if (/PN61729|USB-?B/.test(pkg)) {
    return "usb-b";
  }
  if (/POWERSUPPLY_DC|DC-?21/.test(pkg)) {
    return "dc-jack";
  }
  if (/^1X\d+|^2X\d+/.test(pkg)) {
    return /F/.test(value.replace(/X\d+/, "")) ? "header-female" : "header-male";
  }
  if (/DIL|DIP/.test(pkg)) {
    return "dip";
  }
  if (/TQFP|QFP|MLF|QFN/.test(pkg)) {
    return "ic-flat";
  }
  if (/PANASONIC|ELKO|CPOL/.test(pkg)) {
    return "cap-electrolytic";
  }
  if (/HC49|RESONATOR|CRYSTAL|QS/.test(pkg)) {
    return "crystal";
  }
  if (/TS42|PUSH|BUTTON|TACT/.test(pkg)) {
    return "button";
  }
  if (/LED/.test(pkg)) {
    return "led-smd";
  }
  return "smd";
}

// Altura de un header según su valor. Hay dos formas en los CAD de Arduino:
// "8x1F-H8.5" (Uno) → 8,5 mm, y el código de pieza "FH254-108DF08500V" (Mega) → F08500 = 8,500 mm
function headerHeight(value) {
  var text = value || "";
  var simple = /-H(\d+(?:\.\d+)?)$/i.exec(text);
  if (simple) {
    return Number(simple[1]);
  }
  var partCode = /F(\d{2})(\d{3})V$/i.exec(text);
  if (partCode) {
    return Number(partCode[1]) + Number(partCode[2]) / 1000;
  }
  return null;
}

// ================= Conversión =================

function convert(text, sourceLabel) {
  var plain = section(text, "plain");
  var outline = buildOutline(tags(plain, "wire").filter(function (wire) {
    return wire.layer === "20";
  }));
  var minX = Math.min.apply(null, outline.map(function (p) { return p[0]; }));
  var minY = Math.min.apply(null, outline.map(function (p) { return p[1]; }));
  var maxX = Math.max.apply(null, outline.map(function (p) { return p[0]; }));
  var maxY = Math.max.apply(null, outline.map(function (p) { return p[1]; }));

  var holes = tags(plain, "hole").map(function (hole) {
    return { x: round(Number(hole.x) - minX), y: round(Number(hole.y) - minY), d: Number(hole.drill) };
  });

  var packages = readPackages(text);
  var parts = [];
  var skipped = 0;
  tags(section(text, "elements"), "element").forEach(function (element) {
    var kind = classify(element);
    var bounds = packages[element.library + "/" + element.package];
    if (!kind || !bounds) {
      skipped++;
      return;
    }
    var rotation = String(element.rot || "R0");
    var mirrored = rotation.indexOf("M") >= 0;
    var degrees = Number(rotation.replace(/[^\d.]/g, "")) || 0;
    // Esquinas del encapsulado llevadas a la placa: espejo (si va abajo), giro y traslado
    var corners = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]
      .map(function (corner) {
        var p = rotatePoint(mirrored ? -corner[0] : corner[0], corner[1], degrees);
        return [Number(element.x) + p[0], Number(element.y) + p[1]];
      });
    var xs = corners.map(function (c) { return c[0]; });
    var ys = corners.map(function (c) { return c[1]; });
    var part = {
      name: element.name,
      kind: kind,
      value: element.value || "",
      package: element.package,
      // Centro y tamaño en planta (mm), relativos a la esquina de la placa
      x: round((Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 - minX),
      y: round((Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 - minY),
      w: round(Math.max.apply(null, xs) - Math.min.apply(null, xs)),
      d: round(Math.max.apply(null, ys) - Math.min.apply(null, ys))
    };
    var height = headerHeight(element.value);
    if (height) {
      part.h = height;
    }
    if (mirrored) {
      part.bottom = true;
    }
    parts.push(part);
  });

  return {
    source: sourceLabel,
    license: "CC-BY-SA 4.0 (derivado del CAD oficial de Arduino)",
    units: "mm",
    size: [round(maxX - minX), round(maxY - minY)],
    outline: outline.map(function (p) {
      return [round(p[0] - minX), round(p[1] - minY)];
    }),
    holes: holes,
    parts: parts,
    skipped: skipped
  };
}

// ================= Línea de comandos =================

var args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Uso: node tools/eagle-a-json.mjs <archivo.brd> <salida.json> "<descripción de la fuente>"');
  process.exit(1);
}
try {
  var result = convert(readFileSync(args[0], "utf8"), args[2]);
  var skipped = result.skipped;
  delete result.skipped;
  writeFileSync(args[1], JSON.stringify(result) + "\n");
  console.log(args[1] + ": placa de " + result.size.join(" × ") + " mm, " + result.outline.length + " puntos de contorno, " +
    result.holes.length + " agujeros, " + result.parts.length + " componentes (" + skipped + " omitidos).");
} catch (error) {
  console.error("No se pudo convertir " + args[0] + ": " + error.message);
  process.exit(1);
}
