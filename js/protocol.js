// Protocolo de mensajes del proyecto: una línea de texto por mensaje, por ejemplo "X:52 Y:31 D:2 G:V" o "SIN_MANO".
// Es el mismo formato en todo el camino: web → Arduino por USB, y emisor → broker MQTT → receptor → Arduino.
// El sketch arduino/hand_leds/hand_leds.ino lee exactamente este formato.

export var OUTPUT_MAX = 100; // X e Y van como enteros de 0 a OUTPUT_MAX. Usa 180 para un servo o 255 para PWM
export var MAX_FINGERS = 5;
export var NO_HAND_MESSAGE = "SIN_MANO";

// Códigos en mayúsculas y sin acentos para el mensaje (fáciles de comparar en el sketch); etiquetas para la pantalla
export var GESTURE_LABELS = {
  ABIERTA: "Mano abierta",
  CERRADA: "Mano cerrada",
  PINZA: "Pinza",
  INDICE: "Índice",
  V: "V",
  OTRO: "Otro"
};

var DATA_PATTERN = /^X:(\d{1,3}) Y:(\d{1,3}) D:(\d) G:([A-Z]{1,11})$/;

// Respuesta del sketch del brazo (arduino/brazo_2_motores): "OK: BRAZO <ESTADO> <ángulo motor 1> <ángulo motor 2>"
var ARM_STATUS_PATTERN = /^OK: BRAZO (IZQUIERDA|DERECHA|QUIETO|TOPE|CENTRANDO) (\d{1,3}) (\d{1,3})$/;
var ARM_STATE_LABELS = {
  IZQUIERDA: "moviéndose a la izquierda",
  DERECHA: "moviéndose a la derecha",
  QUIETO: "quieto",
  TOPE: "en el tope (no puede seguir)",
  CENTRANDO: "volviendo al centro"
};

// Texto para la pantalla a partir de la respuesta del brazo, o null si la línea no es del brazo
export function describeArmStatus(line) {
  var match = ARM_STATUS_PATTERN.exec(String(line).trim());
  if (!match) {
    return null;
  }
  return "Brazo " + ARM_STATE_LABELS[match[1]] + " · motor 1: " + match[2] + "° · motor 2: " + match[3] + "°";
}

// Arma la línea a partir de los datos de la mano; en el sketch se puede leer con sscanf
export function formatMessage(data) {
  if (!data.hasHand) {
    return NO_HAND_MESSAGE;
  }
  return "X:" + data.x + " Y:" + data.y + " D:" + data.fingers + " G:" + data.gesture;
}

// Interpreta una línea recibida. Devuelve null si no respeta el formato exacto o algún valor está fuera de rango:
// el receptor nunca reenvía al Arduino texto libre llegado por internet.
export function parseMessage(text) {
  var line = String(text).trim();
  if (line === NO_HAND_MESSAGE) {
    return { hasHand: false };
  }

  var match = DATA_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  var data = {
    hasHand: true,
    x: Number(match[1]),
    y: Number(match[2]),
    fingers: Number(match[3]),
    gesture: match[4]
  };
  var isInRange = data.x <= OUTPUT_MAX && data.y <= OUTPUT_MAX && data.fingers <= MAX_FINGERS;
  return isInRange && Object.prototype.hasOwnProperty.call(GESTURE_LABELS, data.gesture) ? data : null;
}
