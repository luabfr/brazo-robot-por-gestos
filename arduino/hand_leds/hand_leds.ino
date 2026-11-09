/*
  Control de 3 LEDs con la cantidad de dedos que detecta hand-tracking.html (Web Serial).

  Conexión (montaje de la clase):
    - Pata negativa (cátodo, la más corta) de cada LED a los pines 8, 9 y 10.
    - Pata positiva (ánodo, la más larga) a 5V, cada una con su resistencia de 220 a 330 ohm.
    Con este montaje el LED se enciende cuando el pin está en LOW: el pin "absorbe" la corriente.
    Si se conectan al revés (ánodo al pin y cátodo a GND), cambia LED_ACTIVE_LOW a false.

  Protocolo: 9600 baudios, un mensaje por línea terminado en salto de línea (\n).
    Recibe:
      X:52 Y:31 D:2 G:V   -> enciende D LEDs (con 4 o 5 dedos quedan encendidos los 3)
      SIN_MANO            -> apaga todos
      LEDS 2              -> prueba manual desde el Monitor Serie del IDE
    Responde:
      LISTO: ...          al arrancar (la página espera este mensaje para empezar a enviar)
      OK: LEDS n          solo cuando cambia la cantidad de LEDs encendidos
      ERROR: ...          si el mensaje no se entiende
*/

const long BAUD_RATE = 9600;  // Debe coincidir con BAUD_RATE de hand-tracking.html

const byte LED_PINS[] = {8, 9, 10};
const byte LED_COUNT = sizeof(LED_PINS) / sizeof(LED_PINS[0]);
const bool LED_ACTIVE_LOW = true;  // true: cátodo al pin (este montaje). false: ánodo al pin
const byte LED_ON_LEVEL = LED_ACTIVE_LOW ? LOW : HIGH;
const byte LED_OFF_LEVEL = LED_ACTIVE_LOW ? HIGH : LOW;

const int MAX_FINGERS = 5;
const unsigned int STARTUP_TEST_MS = 150;  // Tiempo encendido de cada LED en la prueba de cableado

// El mensaje más largo esperado ("X:100 Y:100 D:5 G:ABIERTA") tiene 25 caracteres
const byte MAX_LINE_LENGTH = 48;
const byte MAX_GESTURE_LENGTH = 11;

char lineBuffer[MAX_LINE_LENGTH + 1];  // +1 para el '\0' que cierra el texto
byte lineLength = 0;
bool isDiscardingLine = false;  // true si la línea actual ya superó MAX_LINE_LENGTH

int litLeds = -1;  // -1 = todavía no hay estado, así el primer mensaje siempre se confirma

// Enciende los primeros "count" LEDs y apaga el resto. Avisa solo si la cantidad cambió
void setLeds(int count) {
  count = constrain(count, 0, LED_COUNT);

  for (byte i = 0; i < LED_COUNT; i++) {
    digitalWrite(LED_PINS[i], i < count ? LED_ON_LEVEL : LED_OFF_LEVEL);
  }

  if (count != litLeds) {
    litLeds = count;
    Serial.print(F("OK: LEDS "));
    Serial.println(count);
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
  int count;
  char gesture[MAX_GESTURE_LENGTH + 1];

  if (strcmp(line, "SIN_MANO") == 0) {
    setLeds(0);
    return;
  }

  // X, Y y el gesto se leen para validar el formato; quedan disponibles para más adelante (p. ej. un servo).
  // %11s limita el gesto a MAX_GESTURE_LENGTH caracteres: si cambias uno, cambia el otro
  if (sscanf(line, "X:%d Y:%d D:%d G:%11s", &x, &y, &fingers, gesture) == 4) {
    if (fingers < 0 || fingers > MAX_FINGERS) {
      Serial.print(F("ERROR: cantidad de dedos fuera de rango: "));
      Serial.println(fingers);
      return;
    }
    setLeds(fingers);
    return;
  }

  if (sscanf(line, "LEDS %d", &count) == 1) {
    if (count < 0 || count > LED_COUNT) {
      Serial.print(F("ERROR: LEDS va de 0 a "));
      Serial.println(LED_COUNT);
      return;
    }
    setLeds(count);
    return;
  }

  reportUnknown(line);
}

void setup() {
  for (byte i = 0; i < LED_COUNT; i++) {
    // Primero se fija el nivel de "apagado" y recién después el pin pasa a salida.
    // Al revés, el pin arrancaría en LOW y con este montaje los LEDs parpadearían al encender la placa.
    digitalWrite(LED_PINS[i], LED_OFF_LEVEL);
    pinMode(LED_PINS[i], OUTPUT);
  }

  Serial.begin(BAUD_RATE);

  // Prueba de cableado: cada LED se enciende un instante, en orden. Si alguno no prende, revisar su conexión
  for (byte i = 0; i < LED_COUNT; i++) {
    digitalWrite(LED_PINS[i], LED_ON_LEVEL);
    delay(STARTUP_TEST_MS);
    digitalWrite(LED_PINS[i], LED_OFF_LEVEL);
  }

  // "LISTO" va primero: la página toma la primera línea recibida como señal de que el sketch arrancó
  Serial.print(F("LISTO: "));
  Serial.print(LED_COUNT);
  Serial.print(F(" LEDs en pines"));
  for (byte i = 0; i < LED_COUNT; i++) {
    Serial.print(' ');
    Serial.print(LED_PINS[i]);
  }
  Serial.println(F(". Mensajes: X:.. Y:.. D:n G:.., SIN_MANO o LEDS n"));

  setLeds(0);  // Informa el estado inicial: "OK: LEDS 0"
}

void loop() {
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
