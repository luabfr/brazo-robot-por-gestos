// Control del LED del pin 13 por comunicación serial.
// Comandos (terminados en salto de línea): ENCENDER | APAGAR

const byte LED_PIN = 13;        // LED integrado en Arduino Uno/Nano
const long BAUD_RATE = 9600;    // debe coincidir con el Monitor Serial

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);   // estado inicial seguro: apagado

  Serial.begin(BAUD_RATE);
  Serial.setTimeout(50);        // espera máximo 50 ms por el fin de línea
  Serial.println("Listo. Envia ENCENDER o APAGAR");
}

void loop() {
  if (Serial.available() == 0) {
    return;                     // no hay datos, no hace nada
  }

  String command = Serial.readStringUntil('\n');
  command.trim();               // quita espacios y el '\r' de los saltos "\r\n"
  command.toUpperCase();        // acepta "encender", "Encender", etc.

  if (command.length() == 0) {
    return;                     // línea vacía, se ignora
  }

  if (command == "ENCENDER") {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("OK: LED encendido");
  } else if (command == "APAGAR") {
    digitalWrite(LED_PIN, LOW);
    Serial.println("OK: LED apagado");
  } else {
    Serial.print("ERROR: comando desconocido -> ");
    Serial.println(command);
  }
}