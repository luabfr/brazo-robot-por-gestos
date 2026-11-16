// Banco de trabajo 3D de la infografía (arquitectura.html): las piezas del robot a tamaño real, con three.js.
// - Escala: 1 unidad = 1 mm, la misma para todas las piezas: así se comparan entre sí.
// - Placa: data/placa-*.json, generado con tools/eagle-a-json.mjs desde el CAD oficial de Arduino (CC-BY-SA 4.0):
//   contorno, agujeros y posición y tamaño en planta de cada componente. Las alturas son aproximadas, salvo
//   los headers (8,5 mm, del CAD).
// - SG90: cotas del dibujo de TowerPro. Fuente: formato ATX (150 × 86 × 140 mm); el ventilador y el conector
//   son aproximados. La cuadrícula de la mesa es de 1 cm: sirve de referencia de tamaño.
// - Brazo: esquemático. Los servos están a escala; las piezas de plástico son una versión propia simplificada.
// - three.js se descarga recién al abrir el banco (import dinámico, ver el importmap de arquitectura.html).
// - Se dibuja solo cuando algo cambia (cámara, brazo, vista explotada): no hay un bucle permanente.

// ================= Constantes =================

var BOARDS = {
  uno: {
    file: "data/placa-uno-r3.json", label: "Arduino UNO R3", sku: "A000066",
    mcu: "ATmega328P en encapsulado DIP-28, en un zócalo (se puede cambiar)",
    headers: { digitalLow: "IOL", digitalHigh: "IOH", power: "POWER" }
  },
  mega: {
    file: "data/placa-mega-2560.json", label: "Arduino Mega 2560 Rev3", sku: "A000067",
    mcu: "ATmega2560 en encapsulado TQFP-100, soldado a la placa",
    headers: { digitalLow: "PWML", digitalHigh: "JP6", power: "POWER" }
  }
};

var PIN_PITCH = 2.54;        // Separación entre pines de los headers (0,1 pulgada)
var PCB_THICKNESS = 1.6;     // Espesor estándar de una placa de circuito (aproximado: el CAD no lo dice)
var BOARD_LIFT = 1.5;        // Las soldaduras de los componentes asoman por debajo: la placa no apoya plana

// Servo TowerPro SG90 (dibujo de cotas de towerpro.com.tw: A 30,3 · B 22,7 · C 27 · D 12,2 · E 32,3 · F 17)
var SG90 = {
  length: 22.7,       // B: largo del cuerpo
  width: 12.2,        // D: ancho
  coverTop: 27,       // C: alto hasta la tapa
  shaftTop: 30.3,     // A: alto hasta la punta del eje
  tabSpan: 32.3,      // E: largo con las orejas de montaje
  tabBottom: 17,      // F: de la base a la cara de abajo de las orejas
  tabThickness: 2.5,  // Aproximado (no figura en la ficha)
  shaftOffset: 17,    // Distancia del eje a la punta opuesta del cuerpo (aproximada, del dibujo)
  shaftRadius: 2.3    // Aproximado
};

// Sketch del brazo (arduino/brazo_2_motores): topes, reposo y velocidad
var ARM_MIN = 20;
var ARM_MAX = 160;
var ARM_HOME = 90;
var ARM_DEGREES_PER_SECOND = 40;

// Fuente ATX: formato estándar. Conector principal de 24 pines: medidas aproximadas
var PSU_SIZE = { w: 150, h: 86, d: 140 };
var CONNECTOR_SIZE = { w: 22, h: 11, d: 52 };

var EXPLODE_MS = 650;
var EXPLODE_LIFT = 26;       // mm que se levantan los componentes de la placa en la vista explotada
var CAMERA_MS = 600;
var CLICK_TOLERANCE = 5;     // Más movimiento que esto es un arrastre de la cámara, no un clic
var MIN_FRAME_DISTANCE = 170; // mm: al elegir una pieza chica, la cámara no se acerca más que esto
var NARROW_WIDTH = 760;      // Igual que el resto de la página: por debajo, disposición de celular
var HIGHLIGHT_COLOR = 0x4fcacc;

// Dónde va cada cosa sobre la mesa (mm). El Arduino queda en el centro
var LAYOUT = {
  board: { x: 0, z: -15 },
  psu: { x: -215, z: -40 },
  arm: { x: 150, z: -25 },
  mat: { w: 700, d: 380 }
};

// ================= Estado =================

var THREE = null;
var OrbitControls = null;
var RoomEnvironment = null;

var dom = {};
var renderer = null;
var scene = null;
var camera = null;
var controls = null;
var raycaster = null;
var materials = {};
var boardCache = {};
var boardKey = "uno";
var boardData = null;
var objects = {};             // Grupos de cada pieza: placa, servo, brazo, fuente y cables
var armParts = {};            // Piezas móviles del brazo
var explodables = [];         // [{ object, base, offset }]
var selection = { piece: null, part: null, helper: null };
var explode = { value: 0, from: 0, to: 0, start: 0 };
var arm = { angle: ARM_HOME, direction: 0, last: 0 };
var cameraTween = null;
var freeView = { insets: { left: 0, right: 0, top: 0, bottom: 0 }, fullWidth: 1, fullHeight: 1 }; // Lo que tapan los paneles (px)
var frameRequested = false;
var loading = null;
var isReady = false;
var opener = null;
var pointerStart = null;
var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ================= Utilidades =================

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function mm(value, decimals) {
  return value.toLocaleString("es-AR", { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals === undefined ? 2 : decimals });
}

function degrees(value) {
  return (value * Math.PI) / 180;
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function setStatus(text, isError) {
  dom.status.textContent = text || "";
  dom.status.hidden = !text;
  dom.status.classList.toggle("is-error", Boolean(isError));
}

// Marca un objeto y sus hijos como parte de una pieza (para el clic) y les activa las sombras
function tag(object, piece, part) {
  object.traverse(function (child) {
    child.userData.piece = piece;
    if (part) {
      child.userData.part = part;
    }
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

function cylinder(radius, height, material, segments) {
  return new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments || 24), material);
}

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function addExplodable(object, offset) {
  explodables.push({ object: object, base: object.position.clone(), offset: offset });
}

function disposeObject(object) {
  object.traverse(function (child) {
    if (child.geometry) {
      child.geometry.dispose();
    }
  });
}

// ================= Materiales =================

function buildMaterials() {
  var standard = function (color, roughness, metalness, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: roughness, metalness: metalness || 0 }, extra || {}));
  };
  materials = {
    mat: standard(0x141922, 0.95),
    // Colores oscuros y mates: con la luz del entorno, los tonos claros se lavaban
    pcb: standard(0x005e63, 0.75),
    hole: standard(0x0b0d10, 0.9),
    plastic: standard(0x1d2026, 0.7),
    metal: standard(0xc6ccd6, 0.32, 0.9),
    gold: standard(0xd8ab4a, 0.3, 1),
    chip: standard(0x16181c, 0.5),
    ceramic: standard(0xc8a97a, 0.6),
    resonator: standard(0xd9c9a3, 0.6),
    ledGreen: standard(0x3ddc84, 0.3, 0, { emissive: 0x0d4a2a }),
    ledYellow: standard(0xffd54f, 0.3, 0, { emissive: 0x4a3a08 }),
    // Servo: el azul del SG90. Brazo: un azul acero, distinto del de los servos para que se distingan
    servo: standard(0x1d3a99, 0.45),
    servoDark: standard(0x142a73, 0.5),
    horn: standard(0xd9d6cc, 0.6),
    printed: standard(0x285a85, 0.7),
    printedDark: standard(0x1b4061, 0.7),
    psu: standard(0x3a3f47, 0.45, 0.6),
    fan: standard(0x101215, 0.8),
    connector: standard(0xe8e4da, 0.7),
    wireOrange: standard(0xf39c4a, 0.55),
    wireRed: standard(0xe53935, 0.55),
    wireBrown: standard(0x7b4a2a, 0.55),
    wireBlack: standard(0x24272d, 0.55),
    wireGreen: standard(0x43a047, 0.55),
    usbCable: standard(0x9aa3b5, 0.6),
    sleeve: standard(0x15171b, 0.8)
  };
}

// ================= Mesa y luces =================

function buildBench() {
  var mat = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.mat.w, LAYOUT.mat.d), materials.mat);
  mat.rotation.x = -Math.PI / 2;
  mat.receiveShadow = true;
  scene.add(mat);

  // Cuadrícula de 1 cm, más marcada cada 5 cm (como una base de corte): es la referencia de tamaño
  var minor = [];
  var major = [];
  var halfW = LAYOUT.mat.w / 2;
  var halfD = LAYOUT.mat.d / 2;
  for (var x = -halfW; x <= halfW; x += 10) {
    (Math.round(x) % 50 === 0 ? major : minor).push(x, 0.05, -halfD, x, 0.05, halfD);
  }
  for (var z = -halfD; z <= halfD; z += 10) {
    (Math.round(z) % 50 === 0 ? major : minor).push(-halfW, 0.05, z, halfW, 0.05, z);
  }
  [[minor, 0.09], [major, 0.2]].forEach(function (set) {
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(set[0], 3));
    scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x9fb3d1, transparent: true, opacity: set[1] })));
  });

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1e26, 0.6));
  var sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(180, 420, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -360;
  sun.shadow.camera.right = 360;
  sun.shadow.camera.top = 220;
  sun.shadow.camera.bottom = -220;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 900;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}

// ================= Placa Arduino (desde el JSON del CAD) =================

function headerLayout(part) {
  // Filas y columnas según el encapsulado: "1X08" = 1 × 8, "2X03" = 2 × 3. La fila larga va sobre el lado largo
  var match = /(\d+)X(\d+)/i.exec(part.package) || [null, 1, Math.max(1, Math.round(Math.max(part.w, part.d) / PIN_PITCH))];
  var rows = Number(match[1]);
  var cols = Number(match[2]);
  var alongX = part.w >= part.d;
  return { rows: rows, cols: cols, alongX: alongX };
}

// Puntos de los pines de un header (pocitos de la hembra o pines del macho), centrados en el componente
function pinPoints(part) {
  var layout = headerLayout(part);
  var points = [];
  for (var r = 0; r < layout.rows; r++) {
    for (var c = 0; c < layout.cols; c++) {
      var a = (c - (layout.cols - 1) / 2) * PIN_PITCH;
      var b = (r - (layout.rows - 1) / 2) * PIN_PITCH;
      points.push(layout.alongX ? [a, b] : [b, a]);
    }
  }
  return points;
}

function instancedAt(geometry, material, points, y) {
  var mesh = new THREE.InstancedMesh(geometry, material, points.length);
  var matrix = new THREE.Matrix4();
  points.forEach(function (point, index) {
    matrix.makeTranslation(point[0], y, -point[1]);
    mesh.setMatrixAt(index, matrix);
  });
  return mesh;
}

var SMD_HEIGHTS = [
  [/SOT223/i, 1.7], [/SOT-?23|SOT23/i, 1.1], [/MSOP|SO08|SOIC/i, 1.1], [/SMB|SMA/i, 2.2], [/MINIMELF|MELF/i, 1.6],
  [/1812|1206/i, 1.2], [/CAY16/i, 0.5], [/0603/i, 0.45], [/0805/i, 0.6]
];

function smdHeight(pkg) {
  for (var i = 0; i < SMD_HEIGHTS.length; i++) {
    if (SMD_HEIGHTS[i][0].test(pkg)) {
      return SMD_HEIGHTS[i][1];
    }
  }
  return 0.7;
}

function smdMaterial(part) {
  if (/^C\d/.test(part.name)) {
    return materials.ceramic;
  }
  return materials.chip;
}

// Cada componente es un grupo con la base apoyada en la cara de arriba de la placa
function buildPart(part) {
  var group = new THREE.Group();
  var w = part.w;
  var d = part.d;
  var height;
  switch (part.kind) {
    case "usb-b":
      height = 11;
      group.add(at(box(w, height, d, materials.metal), 0, height / 2, 0));
      // Boca del conector, hacia afuera de la placa (lado izquierdo)
      group.add(at(box(0.6, 7, 8, materials.hole), -w / 2 - 0.25, height / 2, 0));
      break;
    case "dc-jack":
      height = 11;
      group.add(at(box(w, height, d, materials.plastic), 0, height / 2, 0));
      var socket = cylinder(3.2, 0.6, materials.hole);
      socket.rotation.z = Math.PI / 2;
      group.add(at(socket, -w / 2 - 0.25, 6.5, 0));
      break;
    case "header-female":
      height = part.h || 8.5;
      group.add(at(box(w - 0.15, height, d - 0.15, materials.plastic), 0, height / 2, 0));
      group.add(instancedAt(new THREE.BoxGeometry(1, 0.1, 1), materials.hole, pinPoints(part), height + 0.03));
      break;
    case "header-male":
      height = 8.5;
      group.add(at(box(w - 0.15, 2.5, d - 0.15, materials.plastic), 0, 1.25, 0));
      group.add(instancedAt(new THREE.BoxGeometry(0.64, 6, 0.64), materials.gold, pinPoints(part), 2.5 + 3));
      break;
    case "dip":
      // Zócalo y, encima, el chip (34,7 × 7,4 × 3,3 mm aprox.)
      height = 6.3;
      var alongX = w >= d;
      var socketW = alongX ? w - 1 : 9;
      var socketD = alongX ? 9 : d - 1;
      group.add(at(box(socketW, 3, socketD, materials.plastic), 0, 1.5, 0));
      var chipLong = Math.max(w, d) - 2.5;
      group.add(at(box(alongX ? chipLong : 7.4, 3.3, alongX ? 7.4 : chipLong, materials.chip), 0, 3 + 1.65, 0));
      break;
    case "ic-flat":
      var size = Math.max(w, d) >= 10 ? Math.max(w, d) * 0.8 : Math.max(w, d) - 0.6;
      height = Math.max(w, d) >= 10 ? 1.2 : 0.9;
      group.add(at(box(size, height, size, materials.chip), 0, height / 2 + 0.1, 0));
      group.add(at(box(w * 0.92, 0.12, d * 0.92, materials.metal), 0, 0.06, 0));
      break;
    case "cap-electrolytic":
      height = 5.8;
      group.add(at(box(w * 0.92, 1, d * 0.85, materials.plastic), 0, 0.5, 0));
      group.add(at(cylinder(Math.min(w, d) * 0.48, height - 1, materials.metal), 0, 1 + (height - 1) / 2, 0));
      break;
    case "crystal":
      if (Math.max(w, d) > 5) {
        height = 3.5;
        group.add(at(box(w * 0.95, height, d * 0.85, materials.metal), 0, height / 2, 0));
      } else {
        height = 1;
        group.add(at(box(w * 0.95, height, d * 0.8, materials.resonator), 0, height / 2, 0));
      }
      break;
    case "button":
      height = 2.4;
      group.add(at(box(w * 0.5, 1.6, d * 0.75, materials.metal), 0, 0.8, 0));
      group.add(at(cylinder(0.9, 0.8, materials.chip), 0, 2, 0));
      break;
    case "led-smd":
      height = 0.8;
      group.add(at(box(Math.max(w * 0.65, 1), height, Math.max(d * 0.75, 1), /GREEN/i.test(part.value) ? materials.ledGreen : materials.ledYellow), 0, height / 2, 0));
      break;
    default:
      height = smdHeight(part.package);
      group.add(at(box(Math.max(w * 0.7, 0.8), height, Math.max(d * 0.7, 0.6), smdMaterial(part)), 0, height / 2, 0));
  }
  group.userData.height = height;
  return group;
}

function buildBoardMesh(data) {
  var shape = new THREE.Shape();
  data.outline.forEach(function (point, index) {
    if (index === 0) {
      shape.moveTo(point[0], point[1]);
    } else {
      shape.lineTo(point[0], point[1]);
    }
  });
  data.holes.forEach(function (hole) {
    var path = new THREE.Path();
    path.absarc(hole.x, hole.y, hole.d / 2, 0, Math.PI * 2, true);
    shape.holes.push(path);
  });
  var geometry = new THREE.ExtrudeGeometry(shape, { depth: PCB_THICKNESS, bevelEnabled: false, curveSegments: 24 });
  var mesh = new THREE.Mesh(geometry, materials.pcb);
  // La forma está en el plano del CAD (x, y): se acuesta sobre la mesa y queda centrada
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(-data.size[0] / 2, 0, data.size[1] / 2);
  return mesh;
}

// Punto del CAD (x, y en mm) en las coordenadas del grupo de la placa
function boardLocal(x, y, height) {
  return new THREE.Vector3(x - boardData.size[0] / 2, height, boardData.size[1] / 2 - y);
}

function buildBoard() {
  var group = new THREE.Group();
  var pcb = buildBoardMesh(boardData);
  tag(pcb, "placa");
  group.add(pcb);
  boardData.parts.forEach(function (part) {
    var mesh = buildPart(part);
    var position = boardLocal(part.x, part.y, part.bottom ? -mesh.userData.height : PCB_THICKNESS);
    mesh.position.copy(position);
    tag(mesh, "placa", part);
    group.add(mesh);
    // En la vista explotada los componentes se levantan de la placa (bien por encima de los headers de 8,5 mm)
    addExplodable(mesh, new THREE.Vector3(0, part.bottom ? -14 : EXPLODE_LIFT, 0));
  });
  group.position.set(LAYOUT.board.x, BOARD_LIFT, LAYOUT.board.z);
  return group;
}

// Punto de un pin de la placa, en coordenadas de la mesa: arriba del header, donde entra el cable
function boardPin(headerName, index, fromRight) {
  var header = boardData.parts.find(function (part) {
    return part.name === headerName;
  });
  if (!header) {
    return null;
  }
  var count = headerLayout(header).cols;
  var offset = fromRight ? (count - 1) / 2 - index : index - (count - 1) / 2;
  var local = boardLocal(header.x + offset * PIN_PITCH, header.y, PCB_THICKNESS + (header.h || 8.5));
  return local.add(objects.placa.position);
}

function digitalPin(pin) {
  var headers = BOARDS[boardKey].headers;
  // Pines 0 a 7 y 8 a 13: el de número más bajo de cada header está a la derecha (como en la placa real)
  return pin < 8 ? boardPin(headers.digitalLow, pin, true) : boardPin(headers.digitalHigh, pin - 8, true);
}

function groundPin() {
  // Header de alimentación, de izquierda a derecha: NC, IOREF, RESET, 3V3, 5V, GND, GND, VIN
  return boardPin(BOARDS[boardKey].headers.power, 5, false);
}

// ================= Servo SG90 =================

// Devuelve el grupo del servo (eje hacia +y, base en y = 0) y el pivote del brazo de plástico (horn)
function buildServo() {
  var group = new THREE.Group();
  var half = SG90.length / 2;
  var shaftX = -half + SG90.shaftOffset;
  group.add(at(box(SG90.length, SG90.tabBottom, SG90.width, materials.servo), 0, SG90.tabBottom / 2, 0));
  var tabTop = SG90.tabBottom + SG90.tabThickness;
  group.add(at(box(SG90.tabSpan, SG90.tabThickness, SG90.width, materials.servoDark), 0, SG90.tabBottom + SG90.tabThickness / 2, 0));
  [-1, 1].forEach(function (side) {
    group.add(at(cylinder(1, SG90.tabThickness + 0.1, materials.hole, 12), side * (SG90.tabSpan / 2 - 2.3), SG90.tabBottom + SG90.tabThickness / 2, 0));
  });
  var upperTop = 23;
  group.add(at(box(SG90.length, upperTop - tabTop, SG90.width, materials.servo), 0, (tabTop + upperTop) / 2, 0));
  // Tapa de los engranajes, del lado del eje
  var capLength = 15.2;
  group.add(at(box(capLength, SG90.coverTop - upperTop, SG90.width, materials.servoDark), half - capLength / 2, (upperTop + SG90.coverTop) / 2, 0));
  group.add(at(cylinder(SG90.shaftRadius, SG90.shaftTop - SG90.coverTop, materials.horn, 16), shaftX, (SG90.coverTop + SG90.shaftTop) / 2, 0));
  // Brazo de plástico (horn): gira con el ángulo del servo
  var horn = new THREE.Group();
  horn.position.set(shaftX, SG90.shaftTop + 0.8, 0);
  horn.add(cylinder(3.2, 1.6, materials.horn, 20));
  horn.add(at(box(16, 1.6, 4.6, materials.horn), 7, 0, 0));
  group.add(horn);
  return { group: group, horn: horn, shaftX: shaftX };
}

// ================= Brazo esquemático (dos SG90) =================

function buildArm() {
  var group = new THREE.Group();
  group.position.set(LAYOUT.arm.x, 0, LAYOUT.arm.z);
  var base = cylinder(38, 5, materials.printedDark, 48);
  group.add(at(base, 0, 2.5, 0));

  // Motor 1: vertical, gira la torreta
  var servo1 = buildServo();
  servo1.group.position.set(-servo1.shaftX, 5, 0);
  group.add(servo1.group);

  var turret = new THREE.Group();
  turret.position.set(0, 5 + SG90.shaftTop + 1.6, 0);
  turret.add(at(cylinder(22, 3, materials.printed, 40), 0, 1.5, 0));

  // Motor 2: acostado, con el eje hacia +z; mueve el brazo. Apoya sobre un pedestal de la torreta
  var servo2 = buildServo();
  servo2.group.rotation.x = Math.PI / 2;
  var shoulderHeight = 24;
  servo2.group.position.set(-servo2.shaftX, shoulderHeight, -15);
  var pedestalTop = shoulderHeight - SG90.width / 2;
  turret.add(at(box(26, pedestalTop - 3, 29, materials.printed), 0, (pedestalTop + 3) / 2, -1.5));
  turret.add(servo2.group);

  var shoulder = new THREE.Group();
  shoulder.position.set(0, shoulderHeight, -15 + SG90.shaftTop + 1.6);
  shoulder.add(at(box(12, 82, 3, materials.printed), 0, 36, 1.5));
  shoulder.add(at(box(18, 12, 8, materials.printedDark), 0, 80, 1.5));
  shoulder.add(at(box(4, 16, 4, materials.printedDark), -5, 92, 1.5));
  shoulder.add(at(box(4, 16, 4, materials.printedDark), 5, 92, 1.5));
  turret.add(shoulder);
  group.add(turret);

  tag(group, "brazo");
  tag(servo1.group, "servo");
  tag(servo2.group, "servo");
  // Al tocar un servo se resalta ese (y no siempre el mismo)
  servo1.group.userData.servoRoot = true;
  servo2.group.userData.servoRoot = true;
  armParts = { turret: turret, shoulder: shoulder, horn1: servo1.horn, horn2: servo2.horn, servo2: servo2.group };
  objects.servo = servo2.group;
  // Vista explotada: la torreta y el brazo se separan del motor que los mueve
  addExplodable(turret, new THREE.Vector3(0, 26, 0));
  addExplodable(shoulder, new THREE.Vector3(0, 0, 30));
  applyArmAngle();
  return group;
}

function applyArmAngle() {
  // Los dos motores reciben el mismo ángulo (el sketch los mueve juntos)
  var turn = degrees(arm.angle - ARM_HOME);
  armParts.turret.rotation.y = turn;
  armParts.shoulder.rotation.z = -turn;
  armParts.horn1.rotation.y = turn;
  armParts.horn2.rotation.y = turn;
}

// ================= Fuente ATX =================

function buildPsu() {
  var group = new THREE.Group();
  group.position.set(LAYOUT.psu.x, 0, LAYOUT.psu.z);
  group.add(at(box(PSU_SIZE.w, PSU_SIZE.h, PSU_SIZE.d, materials.psu), 0, PSU_SIZE.h / 2, 0));
  // Rejilla del ventilador, arriba (aproximada)
  var fanY = PSU_SIZE.h + 0.3;
  var disc = new THREE.Mesh(new THREE.CircleGeometry(57, 48), materials.fan);
  disc.rotation.x = -Math.PI / 2;
  group.add(at(disc, 0, fanY, 0));
  [14, 27, 40, 53].forEach(function (radius) {
    var ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.9, 6, 64), materials.metal);
    ring.rotation.x = Math.PI / 2;
    group.add(at(ring, 0, fanY + 0.6, 0));
  });
  [0, Math.PI / 2].forEach(function (angle) {
    var spoke = box(108, 1.2, 1.8, materials.metal);
    spoke.rotation.y = angle;
    group.add(at(spoke, 0, fanY + 0.6, 0));
  });

  // Mazo de cables y conector principal de 24 pines (paso de 4,2 mm; medidas aproximadas)
  var exit = new THREE.Vector3(PSU_SIZE.w / 2, 30, PSU_SIZE.d / 2 - 22);
  var plug = new THREE.Vector3(PSU_SIZE.w / 2 + 40, 6, PSU_SIZE.d / 2 + 10);
  var bundlePath = new THREE.CatmullRomCurve3([
    exit, new THREE.Vector3(exit.x + 15, 18, exit.z + 8), new THREE.Vector3(plug.x - 25, 6, plug.z - 4), new THREE.Vector3(plug.x - 11, 6, plug.z)
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(bundlePath, 40, 5, 12), materials.sleeve));
  var connector = new THREE.Group();
  connector.position.copy(plug);
  connector.add(at(box(CONNECTOR_SIZE.w, CONNECTOR_SIZE.h, CONNECTOR_SIZE.d, materials.connector), 0, 0, 0));
  // Puente del cable verde (PS_ON#) a GND: hace que la fuente arranque sola
  var bridge = new THREE.Mesh(new THREE.TorusGeometry(5, 0.8, 8, 24, Math.PI), materials.wireGreen);
  bridge.rotation.y = Math.PI / 2;
  connector.add(at(bridge, 11.5, 0, 14));
  group.add(connector);
  addExplodable(connector, new THREE.Vector3(30, 0, 18));

  tag(group, "fuente");
  objects.psuConnector = connector;
  return group;
}

// ================= Cables =================

function wire(points, material, radius) {
  var curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 72, radius || 0.8, 8), material);
}

function vector(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

// Un cable que llega desde "from" y baja vertical hasta entrar en un pin del Arduino
function intoPin(pin, from) {
  return [from, vector(pin.x, pin.y + 16, pin.z), vector(pin.x, pin.y + 3, pin.z), vector(pin.x, pin.y - 1, pin.z)];
}

function buildWires() {
  var group = new THREE.Group();
  var armBase = vector(LAYOUT.arm.x - 36, 2, LAYOUT.arm.z + 6);
  var pin5 = digitalPin(5);
  var pin6 = digitalPin(6);
  var gnd = groundPin();
  var plug = objects.fuente.position.clone().add(objects.psuConnector.position);
  // Los cables entran al conector de costado (por la cara que mira a la placa, a media altura) y terminan
  // adentro: así la punta del tubo no asoma por ninguna cara. El puente verde ocupa z = +9 a +19
  var connectorFace = plug.x + CONNECTOR_SIZE.w / 2;
  var intoConnector = function (offsetZ) {
    var z = plug.z + offsetZ;
    return [vector(connectorFace + 8, plug.y, z), vector(connectorFace, plug.y, z), vector(connectorFace - 6, plug.y, z)];
  };

  // Señal de cada servo (naranja) al pin 5 y al pin 6
  [[pin5, 0], [pin6, 3]].forEach(function (entry) {
    var pin = entry[0];
    var start = armBase.clone().add(vector(0, 0, entry[1]));
    group.add(wire([start, vector(start.x - 20, 2, start.z - 20 + entry[1])].concat(intoPin(pin, vector(pin.x + 18, 16, pin.z - 22))), materials.wireOrange));
  });
  // 5 V (rojo) y GND (marrón) de los servos, por delante de la placa, hasta el conector de la fuente
  [[materials.wireRed, 6, -6], [materials.wireBrown, 9, 2]].forEach(function (entry) {
    var start = armBase.clone().add(vector(0, 0, entry[1]));
    // Pasan por delante de la placa (z ≈ 34) y entran al conector por su costado
    group.add(wire([
      start, vector(start.x - 10, 1.5, start.z + 30), vector(40, 1.5, 28 + entry[1]), vector(-40, 1.5, 28 + entry[1]),
      vector(connectorFace + 20, 1.5, plug.z + entry[2])
    ].concat(intoConnector(entry[2])), entry[0]));
  });
  // GND común (negro): del conector de la fuente al GND del Arduino
  group.add(wire(intoConnector(-16).reverse().concat([vector(connectorFace + 20, 1.5, plug.z - 24)])
    .concat(intoPin(gnd, vector(gnd.x - 16, 10, gnd.z + 18))), materials.wireBlack));
  // Cable USB hacia la PC del profesor (sale de la mesa)
  var usb = boardData.parts.find(function (part) {
    return part.kind === "usb-b";
  });
  if (usb) {
    var mouth = boardLocal(usb.x - usb.w / 2, usb.y, PCB_THICKNESS + 5.5).add(objects.placa.position);
    group.add(wire([
      mouth.clone().add(vector(1, 0, 0)), mouth.clone().add(vector(-14, -1, 0)), vector(mouth.x - 40, 3, mouth.z - 30),
      vector(-110, 2.5, -150), vector(-230, 2.5, -185)
    ], materials.usbCable, 2.2));
  }
  return tag(group, "cables");
}

// ================= Piezas: fichas técnicas =================

function boardInfo() {
  var board = BOARDS[boardKey];
  return {
    title: board.label,
    facts: [
      ["Placa", mm(boardData.size[0]) + " × " + mm(boardData.size[1]) + " mm"],
      ["Microcontrolador", board.mcu],
      ["Componentes dibujados", String(boardData.parts.length) + " (del CAD, en su lugar real)"],
      ["Pines que usa el proyecto", "5 y 6 (servos) o 8, 9 y 10 (LEDs), GND y USB"],
      ["Para comparar", "la fuente mide " + PSU_SIZE.w + " mm de ancho; cada cuadrado de la mesa, 1 cm"]
    ],
    source: "CAD oficial de Arduino (" + board.sku + ", Eagle, CC-BY-SA 4.0): contorno, agujeros y posición de cada componente.",
    note: "Alturas aproximadas, salvo los headers (8,5 mm, del CAD). Espesor de la placa: 1,6 mm (estándar)."
  };
}

var PART_KINDS = {
  "usb-b": "Conector USB-B: datos y 5 V desde la PC",
  "dc-jack": "Conector de alimentación (jack de 2,1 mm)",
  "header-female": "Header hembra: acá se enchufan los cables",
  "header-male": "Header macho (pines)",
  "dip": "Microcontrolador en encapsulado DIP, en su zócalo",
  "ic-flat": "Chip de montaje superficial",
  "cap-electrolytic": "Capacitor electrolítico",
  "crystal": "Cristal o resonador: marca el ritmo (16 MHz)",
  "button": "Botón de reset",
  "led-smd": "LED indicador",
  "smd": "Componente de montaje superficial"
};

var INFO = {
  servo: function () {
    return {
      title: "Servo TowerPro SG90 (× 2)",
      facts: [
        ["Cuerpo", mm(SG90.length) + " × " + mm(SG90.width) + " mm"],
        ["Alto", mm(SG90.coverTop) + " mm hasta la tapa · " + mm(SG90.shaftTop) + " mm con el eje"],
        ["Con las orejas", mm(SG90.tabSpan) + " mm (a " + mm(SG90.tabBottom) + " mm de la base)"],
        ["Peso", "9 g"],
        ["Torque", "1,8 kg·cm a 4,8 V"],
        ["Velocidad", "0,1 s cada 60° a 4,8 V"]
      ],
      source: "Ficha y dibujo de cotas de TowerPro (towerpro.com.tw).",
      note: "Espesor de las orejas, forma de la tapa y brazo de plástico: aproximados."
    };
  },
  brazo: function () {
    return {
      title: "Brazo (esquemático)",
      facts: [
        ["Motores", "2 SG90, que el sketch mueve juntos"],
        ["Recorrido", ARM_MIN + "° a " + ARM_MAX + "°, arranca en " + ARM_HOME + "°"],
        ["Velocidad", ARM_DEGREES_PER_SECOND + "° por segundo, de a 1°"]
      ],
      source: "Sketch arduino/brazo_2_motores.",
      note: "Los servos están a escala; las piezas de plástico son una versión simplificada, no el modelo real de MakerWorld.",
      link: { label: "Modelo real en MakerWorld", url: "https://makerworld.com/es/models/1101858-robotic-arm-3-axis-connected#profileId-1097227" }
    };
  },
  fuente: function () {
    return {
      title: "Fuente ATX reciclada",
      facts: [
        ["Medidas", PSU_SIZE.w + " × " + PSU_SIZE.h + " × " + PSU_SIZE.d + " mm (formato ATX)"],
        ["Qué aporta", "5 V para los servos"],
        ["Encendido", "cable verde (PS_ON#) unido a GND con un puente"],
        ["Conector", "de 20 o 24 pines, con paso de 4,2 mm"]
      ],
      source: "Formato ATX estándar (Wikipedia: ATX).",
      note: "Ventilador y conector: aproximados. No abrir la fuente: adentro hay tensión de red."
    };
  },
  cables: function () {
    return {
      title: "Cables",
      facts: [
        ["Naranja", "señal de cada servo, a los pines 5 y 6"],
        ["Rojo", "5 V de la fuente a los servos"],
        ["Marrón", "GND de los servos a la fuente"],
        ["Negro", "GND común: fuente y Arduino unidos"],
        ["Gris", "USB a la PC del profesor"]
      ],
      source: "Esquema de conexión del proyecto (pestaña Hardware de Temas a fondo).",
      note: "Recorridos esquemáticos. En la vista explotada se ocultan."
    };
  }
};

var PIECE_ORDER = [
  { id: "placa", label: function () { return BOARDS[boardKey].label; } },
  { id: "servo", label: function () { return "Servo SG90 (× 2)"; } },
  { id: "brazo", label: function () { return "Brazo (esquemático)"; } },
  { id: "fuente", label: function () { return "Fuente ATX"; } },
  { id: "cables", label: function () { return "Cables"; } }
];

function renderInfo() {
  var id = selection.piece;
  dom.pieceBody.textContent = "";
  if (!id) {
    dom.pieceTitle.textContent = "Elegí una pieza";
    dom.pieceBody.appendChild(el("p", "bench-hint", "Tocá una pieza en el banco o elegila de la lista para ver su ficha y sus medidas."));
  } else {
    var info = id === "placa" ? boardInfo() : INFO[id]();
    dom.pieceTitle.textContent = info.title;
    if (id === "placa" && selection.part) {
      var part = selection.part;
      var partBox = el("p", "bench-part");
      partBox.append(
        el("strong", "", (part.value || part.name) + " (" + part.name + ")"),
        el("span", "", PART_KINDS[part.kind] + " · " + mm(part.w, 1) + " × " + mm(part.d, 1) + " mm en planta")
      );
      dom.pieceBody.appendChild(partBox);
    }
    var list = el("dl", "bench-facts");
    info.facts.forEach(function (fact) {
      var row = el("div");
      row.append(el("dt", "", fact[0]), el("dd", "", fact[1]));
      list.appendChild(row);
    });
    dom.pieceBody.appendChild(list);
    if (info.note) {
      dom.pieceBody.appendChild(el("p", "bench-note", info.note));
    }
    if (info.source) {
      dom.pieceBody.appendChild(el("p", "bench-source", "Fuente: " + info.source));
    }
    if (info.link) {
      var link = el("a", "bench-link", info.link.label + " ↗");
      link.href = info.link.url;
      link.target = "_blank";
      link.rel = "noopener";
      dom.pieceBody.appendChild(link);
    }
  }
  dom.pieceList.querySelectorAll("button").forEach(function (button) {
    button.textContent = PIECE_ORDER.find(function (piece) {
      return piece.id === button.dataset.piece;
    }).label();
    button.setAttribute("aria-pressed", String(button.dataset.piece === id));
  });
}

function buildPieceList() {
  PIECE_ORDER.forEach(function (piece) {
    var button = el("button", "bench-piece", piece.label());
    button.type = "button";
    button.dataset.piece = piece.id;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", function () {
      if (!isReady) {
        return;
      }
      select(piece.id, null, true);
    });
    var item = el("li");
    item.appendChild(button);
    dom.pieceList.appendChild(item);
  });
}

// ================= Selección y cámara =================

// target (opcional): el objeto a resaltar, si no es el grupo de la pieza (p. ej. el servo que se tocó)
function select(pieceId, part, frame, target) {
  selection.piece = pieceId;
  selection.part = part || null;
  if (selection.helper) {
    scene.remove(selection.helper);
    selection.helper.geometry.dispose();
    selection.helper = null;
  }
  target = target || null;
  if (target) {
    // Ya viene elegido
  } else if (pieceId === "placa" && part) {
    target = objects.placa.children.find(function (child) {
      return child.userData.part === part;
    });
  } else if (pieceId) {
    target = objects[pieceId];
  }
  if (target) {
    selection.helper = new THREE.BoxHelper(target, HIGHLIGHT_COLOR);
    scene.add(selection.helper);
    if (frame) {
      frameObject(target);
    }
  }
  renderInfo();
  requestRender();
}

function boundsOf(object) {
  return new THREE.Box3().setFromObject(object);
}

// Distancia mínima para que la caja entre completa en el espacio libre entre los paneles, mirando desde
// "direction": proyecta las 8 esquinas con una cámara de prueba y busca la distancia por bisección
function fitBox(bounds, direction, margin) {
  var center = bounds.getCenter(new THREE.Vector3());
  var corners = [];
  [bounds.min.x, bounds.max.x].forEach(function (x) {
    [bounds.min.y, bounds.max.y].forEach(function (y) {
      [bounds.min.z, bounds.max.z].forEach(function (z) {
        corners.push(new THREE.Vector3(x, y, z));
      });
    });
  });
  var probe = camera.clone();
  var width = dom.canvasBox.clientWidth;
  var height = dom.canvasBox.clientHeight;
  var limits = {
    left: freeView.insets.left + margin,
    right: width - freeView.insets.right - margin,
    top: freeView.insets.top + margin,
    bottom: height - freeView.insets.bottom - margin
  };
  var fits = function (distance) {
    probe.position.copy(center).addScaledVector(direction, distance);
    probe.lookAt(center);
    probe.updateMatrixWorld();
    return corners.every(function (corner) {
      var p = corner.clone().project(probe);
      var x = ((p.x + 1) / 2) * width;
      var y = ((1 - p.y) / 2) * height;
      return p.z < 1 && x >= limits.left && x <= limits.right && y >= limits.top && y <= limits.bottom;
    });
  };
  var near = 20;
  var far = controls.maxDistance;
  for (var i = 0; i < 30; i++) {
    var middle = (near + far) / 2;
    if (fits(middle)) {
      far = middle;
    } else {
      near = middle;
    }
  }
  return { center: center, distance: far };
}

// Mueve la cámara para ver un objeto completo, sin cambiar la dirección desde la que se mira
function frameObject(object) {
  var direction = camera.position.clone().sub(controls.target).normalize();
  var fit = fitBox(boundsOf(object), direction, 24);
  // Las piezas chicas (un servo) no se acercan tanto que se pierda el contexto
  var distance = Math.max(fit.distance, MIN_FRAME_DISTANCE);
  moveCamera(fit.center, fit.center.clone().add(direction.multiplyScalar(distance)));
}

function moveCamera(target, position) {
  if (reducedMotion.matches) {
    controls.target.copy(target);
    camera.position.copy(position);
    controls.update();
    requestRender();
    return;
  }
  cameraTween = {
    start: performance.now(),
    fromTarget: controls.target.clone(),
    fromPosition: camera.position.clone(),
    toTarget: target,
    toPosition: position
  };
  requestRender();
}

function fitAll() {
  var direction = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
  var everything = new THREE.Box3();
  ["placa", "fuente", "brazo"].forEach(function (id) {
    if (objects[id]) {
      everything.union(boundsOf(objects[id]));
    }
  });
  var fit = fitBox(everything, direction, 16);
  moveCamera(fit.center, fit.center.clone().add(direction.multiplyScalar(fit.distance)));
}

function pick(clientX, clientY) {
  var rect = renderer.domElement.getBoundingClientRect();
  var pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  var hits = raycaster.intersectObjects(scene.children, true).filter(function (hit) {
    return hit.object.userData.piece && hit.object.visible && !hit.object.isLineSegments;
  });
  if (!hits.length) {
    select(null, null, false);
    return;
  }
  var data = hits[0].object.userData;
  var target = null;
  if (data.piece === "servo") {
    target = hits[0].object;
    while (target && !target.userData.servoRoot) {
      target = target.parent;
    }
  }
  select(data.piece, data.part || null, false, target);
}

// ================= Animación (solo mientras algo se mueve) =================

function requestRender() {
  if (!frameRequested && renderer) {
    frameRequested = true;
    requestAnimationFrame(renderFrame);
  }
}

function renderFrame(now) {
  frameRequested = false;
  var busy = false;

  if (cameraTween) {
    var t = Math.min(1, (now - cameraTween.start) / CAMERA_MS);
    var eased = easeOut(t);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
    camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
    controls.update();
    if (t >= 1) {
      cameraTween = null;
    } else {
      busy = true;
    }
  }

  if (explode.value !== explode.to) {
    // El primer cuadro puede tener una marca de tiempo anterior al clic: nunca por debajo de 0
    var progress = reducedMotion.matches ? 1 : Math.min(1, Math.max(0, (now - explode.start) / EXPLODE_MS));
    explode.value = explode.from + (explode.to - explode.from) * easeOut(progress);
    if (progress >= 1) {
      explode.value = explode.to;
    } else {
      busy = true;
    }
    explodables.forEach(function (item) {
      item.object.position.copy(item.base).addScaledVector(item.offset, explode.value);
    });
    if (objects.cables) {
      objects.cables.visible = explode.value < 0.02;
    }
    if (selection.helper) {
      selection.helper.update();
    }
  }

  if (arm.direction !== 0) {
    // Movimiento por tiempo real (40°/s), con un tope por cuadro: si el navegador se pausa, el brazo no salta
    var elapsed = arm.last ? Math.min(0.1, (now - arm.last) / 1000) : 0;
    arm.last = now;
    var next = Math.min(ARM_MAX, Math.max(ARM_MIN, arm.angle + arm.direction * ARM_DEGREES_PER_SECOND * elapsed));
    // Solo cuenta el tope hacia el que se mueve: desde 160°, "mano cerrada" tiene que poder volver
    var reachedLimit = (arm.direction < 0 && next <= ARM_MIN) || (arm.direction > 0 && next >= ARM_MAX);
    arm.angle = next;
    applyArmAngle();
    if (selection.helper) {
      selection.helper.update();
    }
    renderArmState(reachedLimit);
    if (reachedLimit) {
      arm.direction = 0;
      arm.last = 0;
      updateArmButtons();
    } else {
      busy = true;
    }
  }

  renderer.render(scene, camera);
  if (busy) {
    requestRender();
  }
}

// ================= Brazo: controles =================

function renderArmState(atLimit) {
  dom.armAngle.textContent = Math.round(arm.angle) + "°";
  dom.armState.textContent = atLimit
    ? "en el tope (no puede seguir)"
    : arm.direction < 0 ? "moviéndose a la izquierda" : arm.direction > 0 ? "moviéndose a la derecha" : "quieto";
}

function updateArmButtons() {
  dom.armButtons.forEach(function (button) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.direction) === arm.direction));
  });
}

function setArmDirection(direction) {
  if (!isReady) {
    return;
  }
  arm.direction = direction;
  arm.last = 0;
  updateArmButtons();
  renderArmState(false);
  requestRender();
}

// ================= Placa: cambio entre Uno y Mega =================

async function loadBoardData(key) {
  if (!boardCache[key]) {
    var response = await fetch(BOARDS[key].file);
    if (!response.ok) {
      throw new Error("No se pudo leer " + BOARDS[key].file + " (" + response.status + ")");
    }
    boardCache[key] = await response.json();
  }
  return boardCache[key];
}

async function showBoard(key) {
  boardData = await loadBoardData(key);
  boardKey = key;
  // La placa y los cables se rearman: cambian el tamaño y la posición de los pines
  explodables = explodables.filter(function (item) {
    return !objects.placa || !isInside(item.object, objects.placa);
  });
  ["placa", "cables"].forEach(function (id) {
    if (objects[id]) {
      scene.remove(objects[id]);
      disposeObject(objects[id]);
      objects[id] = null;
    }
  });
  objects.placa = buildBoard();
  scene.add(objects.placa);
  objects.cables = buildWires();
  objects.cables.visible = explode.value < 0.02;
  scene.add(objects.cables);
  // Si estaba explotada, la placa nueva aparece igual
  explodables.forEach(function (item) {
    item.object.position.copy(item.base).addScaledVector(item.offset, explode.value);
  });
  dom.boardButtons.forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.dataset.board === key));
  });
  if (selection.piece === "placa" || selection.piece === "cables") {
    select(selection.piece, null, false);
  } else {
    renderInfo();
  }
  requestRender();
}

function isInside(object, parent) {
  var current = object;
  while (current) {
    if (current === parent) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// ================= Arranque de la escena =================

async function loadThree() {
  // Import dinámico: three.js (unos 2 MB sin comprimir) se descarga solo si alguien abre el banco
  var modules = await Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
    import("three/addons/environments/RoomEnvironment.js")
  ]);
  THREE = modules[0];
  OrbitControls = modules[1].OrbitControls;
  RoomEnvironment = modules[2].RoomEnvironment;
}

function createRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (error) {
    throw new Error("WebGL");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Tono neutro: ACES aclaraba y desaturaba los colores de las piezas
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  dom.canvasBox.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
}

// Los paneles flotan sobre el lienzo. Para que la escena quede centrada en el espacio libre (y no detrás de
// la ficha), se corre el centro de la proyección con setViewOffset: la cámara "ve" una imagen más grande y
// el lienzo muestra solo la parte que corresponde. El lienzo sigue ocupando toda la pantalla
function panelInsets(width, height) {
  var box = dom.canvasBox.getBoundingClientRect();
  var info = dom.info.getBoundingClientRect();
  var header = dom.header.getBoundingClientRect();
  if (info.top - box.top > height / 2) {
    // Celular: encabezado arriba y ficha abajo, a todo el ancho
    return { left: 0, right: 0, top: header.bottom - box.top, bottom: box.bottom - info.top };
  }
  // Escritorio: la ficha ocupa la derecha de punta a punta; el encabezado tapa solo la parte izquierda de arriba
  return { left: 0, right: box.right - info.left, top: (header.bottom - box.top) / 2, bottom: 0 };
}

function resize() {
  if (!renderer) {
    return;
  }
  var width = dom.canvasBox.clientWidth;
  var height = dom.canvasBox.clientHeight;
  if (!width || !height) {
    return;
  }
  renderer.setSize(width, height, false);
  // En pantallas angostas el espacio libre es una franja baja: un lente más abierto evita alejar demasiado la cámara
  camera.fov = width < NARROW_WIDTH ? 50 : 35;
  var insets = panelInsets(width, height);
  var shiftX = (insets.left - insets.right) / 2;
  var shiftY = (insets.top - insets.bottom) / 2;
  var fullWidth = width + 2 * Math.abs(shiftX);
  var fullHeight = height + 2 * Math.abs(shiftY);
  camera.aspect = fullWidth / fullHeight;
  camera.setViewOffset(fullWidth, fullHeight, Math.abs(shiftX) - shiftX, Math.abs(shiftY) - shiftY, width, height);
  camera.updateProjectionMatrix();
  freeView = { insets: insets, fullWidth: fullWidth, fullHeight: fullHeight };
  requestRender();
}

async function setup() {
  setStatus("Cargando three.js y las piezas…");
  await loadThree();
  createRenderer();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;   // El reflejo del entorno, suave: si no, lava los colores oscuros
  pmrem.dispose();
  camera = new THREE.PerspectiveCamera(35, 1, 2, 4000);
  camera.position.set(140, 360, 520);
  raycaster = new THREE.Raycaster();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-40, 20, 0);
  controls.minDistance = 40;
  controls.maxDistance = 2600;
  controls.maxPolarAngle = degrees(86);   // No se puede mirar desde abajo de la mesa
  controls.listenToKeyEvents(dom.canvasBox);
  controls.addEventListener("change", requestRender);
  controls.addEventListener("start", function () {
    cameraTween = null;
  });

  buildMaterials();
  buildBench();
  objects.fuente = buildPsu();
  scene.add(objects.fuente);
  objects.brazo = buildArm();
  scene.add(objects.brazo);
  await showBoard(boardKey);

  // El lienzo y los paneles: si cambia el alto de la ficha (en el celular), cambia el espacio libre
  var observer = new ResizeObserver(resize);
  [dom.canvasBox, dom.info, dom.header].forEach(function (element) {
    observer.observe(element);
  });
  resize();
  bindCanvasEvents();
  isReady = true;
  dom.dialog.classList.add("is-ready");
  setStatus("");
  fitAll();
}

function bindCanvasEvents() {
  var canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", function (event) {
    pointerStart = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", function (event) {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < CLICK_TOLERANCE) {
      pick(event.clientX, event.clientY);
    }
    pointerStart = null;
  });
}

// ================= Diálogo =================

function bindDom() {
  dom.dialog = document.getElementById("archBench");
  dom.canvasBox = document.getElementById("benchCanvas");
  dom.status = document.getElementById("benchStatus");
  dom.header = dom.dialog.querySelector(".bench-header");
  dom.info = dom.dialog.querySelector(".bench-info");
  dom.pieceTitle = document.getElementById("benchPieceTitle");
  dom.pieceBody = document.getElementById("benchPieceBody");
  dom.pieceList = document.getElementById("benchPieceList");
  dom.armAngle = document.getElementById("benchArmAngle");
  dom.armState = document.getElementById("benchArmState");
  dom.explode = document.getElementById("benchExplode");
  dom.boardButtons = Array.prototype.slice.call(dom.dialog.querySelectorAll("[data-board]"));
  dom.armButtons = Array.prototype.slice.call(dom.dialog.querySelectorAll("[data-direction]"));

  document.getElementById("benchClose").addEventListener("click", closeBench);
  document.getElementById("benchFit").addEventListener("click", function () {
    if (isReady) {
      fitAll();
    }
  });
  dom.explode.addEventListener("click", function () {
    if (!isReady) {
      return;
    }
    var isOn = dom.explode.getAttribute("aria-pressed") !== "true";
    dom.explode.setAttribute("aria-pressed", String(isOn));
    explode.from = explode.value;
    explode.to = isOn ? 1 : 0;
    explode.start = performance.now();
    requestRender();
  });
  dom.boardButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (isReady && button.dataset.board !== boardKey) {
        showBoard(button.dataset.board).catch(function (error) {
          setStatus("No se pudo cargar la placa: " + error.message, true);
        });
      }
    });
  });
  dom.armButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setArmDirection(Number(button.dataset.direction));
    });
  });
  // Escape: lo maneja el propio <dialog> (evento cancel); acá solo se ordena el cierre
  dom.dialog.addEventListener("close", function () {
    arm.direction = 0;
    updateArmButtons();
    if (isReady) {
      renderArmState(false);
    }
    document.documentElement.classList.remove("is-bench-open");
    if (opener && document.contains(opener)) {
      opener.focus({ preventScroll: true });
    }
    opener = null;
  });
  buildPieceList();
  renderInfo();
}

// ================= API =================

// options.piece: pieza a mostrar al abrir (placa, servo, brazo, fuente o cables).
// options.opener: elemento que recibe el foco al cerrar
export function openBench(options) {
  options = options || {};
  if (!dom.dialog) {
    bindDom();
  }
  opener = options.opener || document.activeElement;
  if (!dom.dialog.open) {
    dom.dialog.showModal();
    document.documentElement.classList.add("is-bench-open");
  }
  var start = function () {
    if (options.piece) {
      select(options.piece, null, true);
    }
  };
  if (isReady) {
    resize();
    start();
    return;
  }
  if (!loading) {
    loading = setup().catch(function (error) {
      loading = null;
      setStatus(error.message === "WebGL"
        ? "Este navegador no puede mostrar gráficos 3D (WebGL desactivado o no disponible)."
        : "No se pudo cargar el banco 3D. Revisá la conexión a internet y volvé a abrirlo.", true);
      console.error(error);
    });
  }
  loading.then(function () {
    if (isReady) {
      start();
    }
  });
}

export function closeBench() {
  if (dom.dialog && dom.dialog.open) {
    dom.dialog.close();
  }
}

export function isBenchOpen() {
  return Boolean(dom.dialog && dom.dialog.open);
}
