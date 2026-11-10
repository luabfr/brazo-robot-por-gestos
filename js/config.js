// Configuración de la versión remota (emisor.html y receptor.html).
//
// brokerUrl: dirección WebSocket segura de tu deployment de EMQX. Se arma con los datos de
// EMQX Cloud → Overview: "Address" y el puerto "WebSocket over TLS/SSL" (8084 en Serverless), más la ruta /mqtt.
// No es un secreto (igual queda visible en la página publicada), pero las credenciales NUNCA van acá:
// cada persona escribe su usuario y contraseña en la página al conectarse.
export var CONFIG = {
  brokerUrl: "wss://d1a110a8.ala.us-east-1.emqxsl.com:8084/mqtt",
  topicRoot: "robotica",     // Primer nivel de todos los topics; las reglas de permisos de EMQX usan este nombre
  defaultRoom: "clase",      // Sala que propone el formulario; cada curso puede usar la suya
  remoteSendIntervalMs: 200, // EMQX Serverless permite 10 publicaciones/s por cliente: 5 por segundo deja margen
  keepaliveSeconds: 10,      // Si una PC se cae, el broker lo nota en unos 15 s (1,5 × keepalive) y publica su "offline"

  // Video en vivo del brazo con VDO.Ninja (WebRTC entre navegadores, sin servidor propio).
  // Es P2P: la PC del profesor sube un stream por cada alumno que mira. Con 5 alumnos a 1000 kbps
  // son unos 5 Mbps de subida; si la conexión no alcanza, bajar este tope
  videoBaseUrl: "https://vdo.ninja/",
  videoMaxBitrateKbps: 1000
};
