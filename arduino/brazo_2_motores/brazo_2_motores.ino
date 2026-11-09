/*
  Brazo robot de 2 motores (servos) controlado con gestos de la mano desde la web.

  Movimiento:
    - Mano cerrada (G:CERRADA) -> los dos motores se mueven de a poco hacia la IZQUIERDA.
    - Mano abierta (G:ABIERTA) -> los dos motores se mueven de a poco hacia la DERECHA.
    - Cualquier otro gesto o SIN_MANO -> los motores se quedan quietos donde están.
    Cada motor se frena solo al llegar a su tope (MIN_ANGLE / MAX_ANGLE).

  Conexión (servos tipo SG90, MG90S o MG996R):
    - Señal (cable naranja o amarillo) de cada servo a los pines 5 y 6.
    - Alimentación (rojo y marrón/negro) desde una FUENTE EXTERNA de 5 a 6 V, no desde el pin 5V del Arduino:
      dos servos en movimiento piden más corriente de la que da el USB y el Arduino se reinicia.
    - Unir el GND de la fuente con el GND del Arduino (sin GND común el servo no entiende la señal).

  Seguridad ("hombre muerto"): si los mensajes de la web dejan de llegar durante COMMAND_TIMEOUT_MS (2 s),
  los motores se detienen. La web repite el estado actual varias veces por segundo mientras está conectada.

  Protocolo: 9600 baudios, un mensaje por línea terminado en \n (el mismo que usa hand_leds.ino).
    Recibe:
      X:52 Y:31 D:0 G:CERRADA   -> gesto de la mano (solo importa G)
      SIN_MANO                  -> quieto
      IZQUIERDA | DERECHA | QUIETO | CENTRO   -> prueba manual desde el Monitor Serie
        (los comandos manuales no se frenan por falta de mensajes, sí en los topes; CENTRO vuelve a HOME_ANGLE)
    Responde:
      LISTO: ...                al arrancar (la página espera este mensaje para empezar a enviar)
      OK: BRAZO <ESTADO> <ángulo motor 1> <ángulo motor 2>   cuando cambia el estado
        ESTADO: IZQUIERDA | DERECHA | QUIETO | TOPE (no puede seguir) | CENTRANDO
      AVISO: ...                si se frenó por falta de mensajes
      ERROR: ...                si el mensaje no se entiende
*/

#include <Servo.h>

const long BAUD_RATE = 9600;  // Debe coincidir con BAUD_RATE de la web (js/serial-link.js)

const byte MOTOR_COUNT = 2;
const byte SERVO_PINS[MOTOR_COUNT] = {5, 6};

// Topes de cada motor en grados. Conviene empezar con un rango chico y ampliarlo de a poco:
// si el brazo choca contra algo, el servo se fuerza, se calienta y puede romper los engranajes.
const int MIN_ANGLE[MOTOR_COUNT] = {20, 20};
const int MAX_ANGLE[MOTOR_COUNT] = {160, 160};
const int HOME_ANGLE[MOTOR_COUNT] = {90, 90};  // Posición al encender y con el comando CENTRO

// "Izquierda" baja el ángulo. Si por cómo está montado un motor gira al revés, poner true en ese motor.
const bool REVERSED[MOTOR_COUNT] = {false, false};

const unsigned int DEGREES_PER_SECOND = 40;                          // Velocidad: más alto = más rápido
const unsigned long STEP_INTERVAL_MS = 1000UL / DEGREES_PER_SECOND;  // Tiempo entre pasos de 1 grado
// "Hombre muerto": sin mensajes durante este tiempo, se frena. La web repite el estado cada 0,4 s; si su pestaña
// queda en segundo plano el navegador la frena a 1 vez por segundo, por eso el margen es de 2 s
const unsigned long COMMAND_TIMEOUT_MS = 2000;

// El mensaje más largo esperado ("X:100 Y:100 D:5 G:ABIERTA") tiene 25 caracteres
const byte MAX_LINE_LENGTH = 48;
const byte MAX_GESTURE_LENGTH = 11;

enum Direction { LEFT = -1, STOPPED = 0, RIGHT = 1 };

Servo servos[MOTOR_COUNT];
int angles[MOTOR_COUNT];

Direction direction = STOPPED;
bool isCentering = false;          // true mientras vuelve a HOME_ANGLE (comando CENTRO)
bool isManual = false;             // true si el movimiento lo pidió un comando manual (no aplica el hombre muerto)
bool isAtLimit = false;            // true si ya se avisó que ningún motor puede seguir
unsigned long lastCommandTime = 0; // millis() del último mensaje de la web
unsigned long lastStepTime = 0;

char lineBuffer[MAX_LINE_LENGTH + 1];  // +1 para el '\0' que cierra el texto
byte lineLength = 0;
bool isDiscardingLine = false;  // true si la línea actual ya superó MAX_LINE_LENGTH

void reportState(const __FlashStringHelper* state) {
  Serial.print(F("OK: BRAZO "));
  Serial.print(state);
  for (byte i = 0; i < MOTOR_COUNT; i++) {
    Serial.print(' ');
    Serial.print(angles[i]);
  }
  Serial.println();
}

void reportDirection() {
  if (isCentering) {
    reportState(F("CENTRANDO"));
  } else if (direction == LEFT) {
    reportState(F("IZQUIERDA"));
  } else if (direction == RIGHT) {
    reportState(F("DERECHA"));
  } else {
    reportState(F("QUIETO"));
  }
}

// Cambia el sentido de movimiento. Solo avisa si realmente cambió (la web repite el mismo mensaje seguido)
void setDirection(Direction next, bool manual) {
  isManual = manual;
  if (next == direction && !isCentering) {
    return;
  }
  isCentering = false;
  direction = next;
  isAtLimit = false;
  reportDirection();
}

// Mueve un motor 1 grado en el sentido pedido, sin pasar sus topes. Devuelve false si ya estaba en el tope
bool stepMotor(byte i, int delta) {
  int next = angles[i] + (REVERSED[i] ? -delta : delta);
  if (next < MIN_ANGLE[i] || next > MAX_ANGLE[i]) {
    return false;
  }
  angles[i] = next;
  servos[i].write(next);
  return true;
}

// Mueve un motor 1 grado hacia HOME_ANGLE. Devuelve false si ya llegó
bool stepTowardHome(byte i) {
  if (angles[i] == HOME_ANGLE[i]) {
    return false;
  }
  angles[i] += angles[i] < HOME_ANGLE[i] ? 1 : -1;
  servos[i].write(angles[i]);
  return true;
}

void updateMotion() {
  // Movimiento sin delay(): un paso cada STEP_INTERVAL_MS, así el Arduino sigue leyendo mensajes mientras se mueve
  if (millis() - lastStepTime < STEP_INTERVAL_MS) {
    return;
  }
  lastStepTime = millis();

  if (isCentering) {
    bool isMoving = false;
    for (byte i = 0; i < MOTOR_COUNT; i++) {
      isMoving = stepTowardHome(i) || isMoving;
    }
    if (!isMoving) {
      isCentering = false;
      reportState(F("QUIETO"));
    }
    return;
  }

  if (direction == STOPPED) {
    return;
  }

  bool isMoving = false;
  for (byte i = 0; i < MOTOR_COUNT; i++) {
    isMoving = stepMotor(i, direction) || isMoving;
  }
  // Todos los motores llegaron a su tope: se avisa una sola vez, aunque la mano siga en el mismo gesto
  if (!isMoving && !isAtLimit) {
    isAtLimit = true;
    reportState(F("TOPE"));
  }
}

void checkCommandTimeout() {
  bool isMovingByWeb = (direction != STOPPED || isCentering) && !isManual;
  if (isMovingByWeb && millis() - lastCommandTime > COMMAND_TIMEOUT_MS) {
    Serial.println(F("AVISO: sin mensajes de la web; motores detenidos"));
    setDirection(STOPPED, false);
  }
}

void reportUnknown(const char* line) {
  Serial.print(F("ERROR: no entiendo \""));
  Serial.print(line);
  Serial.println('"');
}

// Interpreta una línea completa
void handleLine(const char* line) {
  int x;
  int y;
  int fingers;
  char gesture[MAX_GESTURE_LENGTH + 1];

  if (strcmp(line, "SIN_MANO") == 0) {
    lastCommandTime = millis();
    setDirection(STOPPED, false);
    return;
  }

  // %11s limita el gesto a MAX_GESTURE_LENGTH caracteres: si cambias uno, cambia el otro
  if (sscanf(line, "X:%d Y:%d D:%d G:%11s", &x, &y, &fingers, gesture) == 4) {
    lastCommandTime = millis();
    if (strcmp(gesture, "CERRADA") == 0) {
      setDirection(LEFT, false);
    } else if (strcmp(gesture, "ABIERTA") == 0) {
      setDirection(RIGHT, false);
    } else {
      setDirection(STOPPED, false);
    }
    return;
  }

  // Comandos manuales para probar el montaje desde el Monitor Serie
  if (strcmp(line, "IZQUIERDA") == 0) {
    setDirection(LEFT, true);
  } else if (strcmp(line, "DERECHA") == 0) {
    setDirection(RIGHT, true);
  } else if (strcmp(line, "QUIETO") == 0) {
    setDirection(STOPPED, true);
  } else if (strcmp(line, "CENTRO") == 0) {
    direction = STOPPED;
    isManual = true;
    isAtLimit = false;
    isCentering = true;
    reportDirection();
  } else {
    reportUnknown(line);
  }
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    // El Monitor Serie puede terminar las líneas con \r\n: el \r se ignora
    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      if (isDiscardingLine) {
        Serial.println(F("ERROR: linea demasiado larga, se descarta"));
        isDiscardingLine = false;
      } else if (lineLength > 0) {
        lineBuffer[lineLength] = '\0';
        handleLine(lineBuffer);
      }
      lineLength = 0;
      continue;
    }

    if (isDiscardingLine) {
      continue;
    }

    // Caso borde: datos sin salto de línea que llenarían la memoria; se descarta la línea entera
    if (lineLength >= MAX_LINE_LENGTH) {
      isDiscardingLine = true;
      lineLength = 0;
      continue;
    }

    lineBuffer[lineLength++] = c;
  }
}

void setup() {
  for (byte i = 0; i < MOTOR_COUNT; i++) {
    // write() antes de attach(): el servo arranca directo en HOME_ANGLE, sin pasar antes por 90 grados
    angles[i] = constrain(HOME_ANGLE[i], MIN_ANGLE[i], MAX_ANGLE[i]);
    servos[i].write(angles[i]);
    servos[i].attach(SERVO_PINS[i]);
  }

  Serial.begin(BAUD_RATE);

  // "LISTO" va primero: la página toma la primera línea recibida como señal de que el sketch arrancó
  Serial.print(F("LISTO: brazo de "));
  Serial.print(MOTOR_COUNT);
  Serial.print(F(" motores en pines"));
  for (byte i = 0; i < MOTOR_COUNT; i++) {
    Serial.print(' ');
    Serial.print(SERVO_PINS[i]);
  }
  Serial.println(F(". Mano cerrada = izquierda, abierta = derecha. Prueba: IZQUIERDA, DERECHA, QUIETO, CENTRO"));

  reportState(F("QUIETO"));  // Informa la posición inicial
}

void loop() {
  readSerial();
  checkCommandTimeout();
  updateMotion();
}
