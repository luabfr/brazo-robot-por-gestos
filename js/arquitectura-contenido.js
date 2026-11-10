// Contenidos de la infografía de arquitectura (arquitectura.html). Fuente: docs/arquitectura-guion.md.
// Separado del dibujo (js/arquitectura.js) para poder corregir textos sin tocar la lógica.
// Si cambia el sketch de Arduino o la conexión del hardware, actualizar acá: esos datos no se pueden importar.

export var REPO_URL = "https://github.com/luabfr/brazo-robot-por-gestos/blob/main/";

// Zonas del recorrido, con los colores de la portada en su variante para fondo oscuro (el lienzo siempre es oscuro)
export var ZONES = [
  { id: "student", label: "PC del alumno", color: "#8fa3ff" },
  { id: "cloud", label: "Internet", color: "#df8ff2" },
  { id: "teacher", label: "PC del profesor", color: "#4fcacc" },
  { id: "robot", label: "Robot", color: "#f7b04a" }
];

// Íconos de línea (viewBox 24 × 24, trazo de 2). El de la mano agrega puntos rellenos (los nodos que detecta MediaPipe)
export var ICONS = {
  webcam: '<circle cx="12" cy="10" r="8"/><circle cx="12" cy="10" r="3"/><path d="M7 22h10M12 22v-4"/>',
  hand: '<path stroke-width="1.5" d="M12 21 8.5 17.5 5 13.5M12 21 8.5 11.5 8 4.5M8.5 11.5 12 11 12 3M12 11 15.5 11.5 16 4.5M15.5 11.5 18 13.5 19.5 8M18 13.5 12 21"/>' +
        '<g fill="currentColor" stroke="none"><circle cx="12" cy="21" r="1.6"/><circle cx="5" cy="13.5" r="1.6"/><circle cx="8" cy="4.5" r="1.6"/><circle cx="12" cy="3" r="1.6"/><circle cx="16" cy="4.5" r="1.6"/><circle cx="19.5" cy="8" r="1.6"/></g>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  monitorPlay: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m10 7.5 4 2.5-4 2.5z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  usb: '<circle cx="12" cy="19.5" r="2"/><path d="M12 17.5V3M9.5 5.5 12 3l2.5 2.5M12 14l-5-3V8.8M12 11.5l5-2.5V7.5"/><circle cx="7" cy="7.6" r="1.2"/><path d="M15.8 5.1h2.4v2.4h-2.4z"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  servo: '<rect x="2.5" y="9" width="15" height="10" rx="1.5"/><path d="M5.5 9V7.5h9V9"/><circle cx="13.5" cy="7.5" r="2.5"/><path d="m13.5 7.5 7.5-4"/>',
  arm: '<path d="M13 21h8M14.5 21v-2a2.5 2.5 0 0 1 5 0v2M17 16.5V7M15.5 5H7M5 5v3.5M3.5 11V8.5h3V11"/><circle cx="17" cy="5" r="2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  led: '<path d="M8 14V9a4 4 0 0 1 8 0v5M6.5 14h11M10 14v7M14 14v5M4.5 5.5 3 4M19.5 5.5 21 4M12 2.5V1"/>'
};

// Nodos del diagrama. title y tech van en la tarjeta; tooltip es la explicación de una línea (§3 del guion).
// details es el panel que se abre al elegir el componente. security: true lo resalta en la capa "Seguridad"
export var NODES = [
  {
    id: "webcam", zone: "student", icon: "webcam", title: "Webcam", tech: "getUserMedia",
    tooltip: "Filma la mano. El video nunca sale de la PC del alumno.",
    details: {
      what: "La cámara web del alumno. La página la abre con getUserMedia, a 1280 × 720 si la cámara lo permite.",
      why: "Privacidad: la imagen se procesa en la misma PC y nunca viaja por internet. Lo único que sale son unos 20 caracteres de texto.",
      facts: [
        "Exige un origen seguro: https o localhost.",
        "La vista espejo es solo visual: no cambia los datos.",
        "Si no entrega imagen en 10 s, la página avisa."
      ],
      failure: "Permiso denegado, cámara usada por otra aplicación o sin imagen: la página explica qué hacer en cada caso.",
      files: ["js/hand-tracker.js"]
    }
  },
  {
    id: "mediapipe", zone: "student", icon: "hand", title: "MediaPipe", tech: "21 puntos · GPU",
    tooltip: "Encuentra 21 puntos de la mano en cada cuadro del video.",
    details: {
      what: "Un modelo de Google (Hand Landmarker) que ubica 21 puntos de cada mano: muñeca, nudillos y puntas de los dedos. Corre dentro del navegador, con WebAssembly y la GPU.",
      why: "No hace falta servidor ni instalar nada. Si la GPU falla, pasa sola a la CPU.",
      facts: [
        "Modelo de unos 7,8 MB, que el navegador guarda en caché.",
        "Detecta hasta 2 manos.",
        "Los gestos salen sin un segundo modelo de IA: se comparan proporciones entre los puntos (abierta, cerrada, pinza, índice, V).",
        "Para que no tiemble: suavizado del 40 %, zona muerta de 2 unidades y un gesto nuevo tiene que sostenerse 150 ms."
      ],
      failure: "Perder la mano menos de 300 ms se toma como un parpadeo. Si dura más, el mensaje pasa a SIN_MANO.",
      files: ["js/hand-tracker.js"]
    }
  },
  {
    id: "emisor", zone: "student", icon: "browser", title: "Emisor", tech: "HTML · CSS · JS", security: true,
    tooltip: "Convierte la mano en un mensaje y lo publica solo si tenés el control.",
    details: {
      what: "La página del alumno: une la cámara, MediaPipe y la conexión MQTT. Convierte la mano en una línea de texto como X:52 Y:31 D:2 G:V.",
      why: "Publica solo cuando el profesor le da el control: así no gasta el cupo del broker ni confunde al robot.",
      facts: [
        "Como máximo 5 mensajes por segundo (el broker permite 10 por cliente).",
        "Publica solo cuando algo cambia y, con la mano quieta, repite el estado cada 1 s (latido).",
        "Si la pestaña queda en segundo plano, manda SIN_MANO."
      ],
      failure: "Si se cierra o pierde internet, el broker avisa a todos con su Last Will y el profesor le quita el control.",
      files: ["emisor.html", "js/mqtt-link.js", "js/protocol.js"]
    }
  },
  {
    id: "visor", zone: "student", icon: "monitorPlay", title: "Visor del brazo", tech: "iframe sin cámara", security: true,
    tooltip: "Muestra el brazo en vivo. No tiene permiso para usar tu cámara.",
    details: {
      what: "Un iframe de VDO.Ninja que muestra en vivo la cámara del brazo, al lado de la cámara del alumno.",
      why: "El iframe se declara sin permiso de cámara ni de micrófono: es una garantía del navegador, no una promesa del código.",
      facts: [
        "Recibe el ID y la clave del video por MQTT: el alumno no copia ningún link.",
        "Solo se muestra con el profesor en línea y su cámara encendida.",
        "Sin audio."
      ],
      files: ["emisor.html", "js/video-link.js"]
    }
  },
  {
    id: "hosting", zone: "cloud", icon: "globe", title: "GitHub Pages", tech: "sitio estático · CDN",
    tooltip: "Las páginas son archivos: no hay servidor propio.",
    details: {
      what: "GitHub Pages sirve las páginas por https. MediaPipe y MQTT.js se descargan del CDN jsDelivr.",
      why: "No hay servidor propio que mantener: el sitio son archivos estáticos. Las versiones de las librerías están fijadas para que una actualización no rompa nada.",
      facts: [
        "HTML, CSS y JavaScript sin frameworks ni compilación.",
        "Módulos de JavaScript nativos: lo que está en el repositorio es lo que corre.",
        "Las credenciales nunca están en el código: se escriben en la página al conectarse."
      ],
      files: ["index.html", "README.md"]
    }
  },
  {
    id: "broker", zone: "cloud", icon: "cloud", title: "Broker MQTT", tech: "EMQX Cloud · wss", security: true,
    tooltip: "El cartero: recibe cada mensaje y lo entrega a quien esté suscrito.",
    details: {
      what: "El servidor MQTT de EMQX Cloud. Cada página publica en un topic y recibe lo que otras publican en los topics a los que se suscribió.",
      why: "Nadie se conecta directo con nadie: alumnos y profesor solo hablan con el broker. Así se cruzan firewalls y países sin configurar redes.",
      facts: [
        "MQTT 5 sobre WebSocket seguro (wss, puerto 8084).",
        "QoS 0 para los datos de la mano; QoS 1 y mensajes retenidos para los estados.",
        "Last Will: si alguien se cae, el broker publica su offline en unos 15 s.",
        "Permisos por usuario: un alumno no puede darse el control a sí mismo.",
        "Plan gratuito: 1 GB por mes, 10 publicaciones por segundo por cliente y 1000 conexiones."
      ],
      failure: "Si la PC del profesor pierde el broker, el robot recibe SIN_MANO y los alumnos ven «Profesor desconectado».",
      files: ["js/mqtt-link.js", "js/config.js"]
    }
  },
  {
    id: "vdo", zone: "cloud", icon: "video", title: "VDO.Ninja", tech: "WebRTC · TURN", security: true,
    tooltip: "Presenta a las dos PCs para que el video viaje directo entre ellas.",
    details: {
      what: "Un servicio gratuito y de código abierto que conecta dos navegadores con WebRTC para mandar video.",
      why: "El video pesa cientos de veces más que los datos de la mano: no podía ir por el broker, que tiene 1 GB por mes.",
      facts: [
        "El video viaja directo entre las PCs (P2P). Si la red no lo permite, pasa por un servidor de relevo (TURN).",
        "WebRTC cifra siempre el video (DTLS-SRTP).",
        "ID y clave nuevos en cada encendido.",
        "Tope de 1000 kbps por alumno que mira."
      ],
      files: ["js/video-link.js"],
      links: [{ label: "Documentación de VDO.Ninja", url: "https://docs.vdo.ninja/" }]
    }
  },
  {
    id: "receptor", zone: "teacher", icon: "browser", title: "Receptor", tech: "HTML · CSS · JS", security: true,
    tooltip: "Elige quién controla, revisa cada mensaje y lo reenvía al Arduino.",
    details: {
      what: "La página del profesor: elige qué alumno controla el robot, revisa cada mensaje y lo reenvía al Arduino.",
      why: "Es la única puerta entre internet y el robot: todo lo que llega se valida antes de tocar el cable.",
      facts: [
        "Solo escucha al alumno con el control.",
        "Descarta cualquier mensaje que no respete el formato exacto.",
        "Repite el estado al Arduino cada 0,4 s.",
        "Si el alumno calla 3 s, el robot pasa a SIN_MANO."
      ],
      failure: "Si el alumno con el control se desconecta, le quita el control y frena el robot.",
      files: ["receptor.html", "js/protocol.js"]
    }
  },
  {
    id: "webserial", zone: "teacher", icon: "usb", title: "Web Serial", tech: "USB · 9600 baudios",
    tooltip: "El navegador le habla al Arduino por el cable USB.",
    details: {
      what: "La API del navegador que permite usar el puerto serie USB para hablar con el Arduino, sin instalar programas.",
      why: "Todo el proyecto corre en el navegador: Web Serial completa el camino hasta el hardware.",
      facts: [
        "Chrome o Edge de escritorio.",
        "9600 baudios; un mensaje por línea, terminado en salto de línea.",
        "El usuario autoriza el puerto una sola vez.",
        "Espera el saludo LISTO del sketch (hasta 3 s) antes de enviar."
      ],
      failure: "Si se desconecta el USB, la página lo detecta y borra los estados retenidos del brazo y los LEDs.",
      files: ["js/serial-link.js"]
    }
  },
  {
    id: "camarabrazo", zone: "teacher", icon: "webcam", title: "Cámara del brazo", tech: "webcam USB",
    tooltip: "La cámara que filma el brazo para los alumnos.",
    details: {
      what: "La webcam de la PC del profesor que filma el brazo. La página del receptor la publica con VDO.Ninja.",
      why: "Los alumnos remotos ven el resultado de sus gestos casi en el momento.",
      facts: [
        "Si hay más de una cámara, se elige por nombre.",
        "Sin audio.",
        "Un stream por cada alumno que mira (P2P)."
      ],
      files: ["receptor.html", "js/video-link.js"]
    }
  },
  {
    id: "arduino", zone: "robot", icon: "cpu", title: "Arduino", tech: "Uno R3 · Mega 2560", security: true,
    tooltip: "Lee cada mensaje y decide cómo mover los motores.",
    details: {
      what: "Una placa con microcontrolador: lee cada línea que llega por USB y genera las señales de los motores. El proyecto funciona con el Uno R3 o con el Mega 2560.",
      why: "Separa el mundo web del eléctrico: la página manda texto y el Arduino lo convierte en pulsos que entienden los servos.",
      facts: [
        "Uno R3: ATmega328P a 16 MHz, 32 KB de flash, 14 pines digitales; placa de 68,58 × 53,34 mm.",
        "Mega 2560: ATmega2560 a 16 MHz, 256 KB de flash, 54 pines digitales; placa de 101,60 × 53,34 mm.",
        "Mano cerrada → izquierda; abierta → derecha; otro gesto → quieto.",
        "Topes de 20° a 160°, a 40° por segundo.",
        "Si pasan 2 s sin mensajes, frena solo."
      ],
      failure: "Vuelve a validar cada mensaje (formato y largo máximo de 48 caracteres) y responde ERROR si no lo entiende.",
      files: ["arduino/brazo_2_motores/brazo_2_motores.ino"],
      links: [
        { label: "Arduino Uno R3 (documentación oficial)", url: "https://docs.arduino.cc/hardware/uno-rev3/" },
        { label: "Arduino Mega 2560 Rev3 (documentación oficial)", url: "https://docs.arduino.cc/hardware/mega-2560/" }
      ]
    }
  },
  {
    id: "servos", zone: "robot", icon: "servo", title: "Servos SG90", tech: "× 2 · pines 5 y 6",
    tooltip: "Motores que giran a un ángulo exacto según el ancho de un pulso.",
    details: {
      what: "Dos micro servos TowerPro SG90: motores que van a un ángulo exacto según el ancho de un pulso eléctrico.",
      why: "Son baratos, livianos y precisos: justo lo que necesita un brazo chico.",
      facts: [
        "Señal en los pines 5 y 6 del Arduino.",
        "Un pulso cada 20 ms (50 Hz), de 544 a 2400 µs con la librería Servo.",
        "Según TowerPro: 1,8 kg·cm y 0,1 s cada 60° a 4,8 V.",
        "Alimentación: 5 V desde la fuente ATX. La corriente no figura en la ficha del fabricante."
      ],
      files: ["arduino/brazo_2_motores/brazo_2_motores.ino"],
      links: [{ label: "TowerPro SG90 (fabricante)", url: "https://www.towerpro.com.tw/product/sg90-7/" }]
    }
  },
  {
    id: "brazo", zone: "robot", icon: "arm", title: "Brazo robot", tech: "impreso en 3D",
    tooltip: "La estructura: un diseño de MakerWorld impreso en el curso.",
    details: {
      what: "La estructura del robot, impresa en 3D a partir de un diseño publicado en MakerWorld.",
      why: "Un modelo abierto y reproducible: cualquier curso puede imprimirlo.",
      facts: [
        "El diseño es de 3 ejes; el sketch actual mueve 2.",
        "Cada servo mueve una articulación."
      ],
      links: [{ label: "Modelo en MakerWorld", url: "https://makerworld.com/es/models/1101858-robotic-arm-3-axis-connected#profileId-1097227" }]
    }
  },
  {
    id: "fuente", zone: "robot", icon: "zap", title: "Fuente ATX", tech: "5 V · reciclada",
    tooltip: "Da la corriente que el USB no alcanza para dos motores.",
    details: {
      what: "Una fuente de PC (ATX) reciclada que alimenta a los servos con 5 V.",
      why: "Dos servos en movimiento piden más corriente de la que da el USB: sin una fuente aparte, el Arduino se reinicia.",
      facts: [
        "Salida de +5 V (cables rojos) y GND (cables negros).",
        "El cable verde va con un puente a GND: así la fuente arranca al enchufarla.",
        "GND común con el Arduino: sin eso, el servo no entiende la señal."
      ],
      failure: "No abrir la fuente: adentro hay tensión de red y capacitores que quedan cargados."
    }
  },
  {
    id: "leds", zone: "robot", icon: "led", title: "LEDs", tech: "pines 8, 9 y 10",
    tooltip: "Sketch alternativo: 1, 2 o 3 LEDs según la cantidad de dedos.",
    details: {
      what: "El sketch alternativo: en lugar de mover el brazo, enciende 1, 2 o 3 LEDs según la cantidad de dedos.",
      why: "Es la primera prueba del recorrido completo, sin motores ni fuente externa.",
      facts: [
        "Pines 8, 9 y 10, con el cátodo al pin: se encienden con LOW.",
        "Resistencias de 220 a 330 Ω a 5 V.",
        "Responde OK: LEDS n, y los alumnos lo ven en su página."
      ],
      files: ["arduino/hand_leds/hand_leds.ino"]
    }
  }
];

// Conexiones. kind define el estilo de la línea; layer, la capa a la que pertenece; detail, el tooltip.
// lane separa las idas (−1) de las vueltas (+1) cuando dos líneas unen los mismos nodos.
// label: texto de la línea. labelNarrow: false lo oculta en el celular; narrowLabel muestra un texto solo en el celular.
// En los tramos horizontales el texto va arriba de la fila (ida) o debajo (vuelta); labelAt: "mid" lo deja sobre la línea
export var EDGES = [
  { id: "e-video-local", from: "webcam", to: "mediapipe", kind: "data", layer: "datos", label: "video",
    detail: "Cuadros de video dentro del navegador: no salen de la PC." },
  { id: "e-puntos", from: "mediapipe", to: "emisor", kind: "data", layer: "datos", label: "21 puntos", labelNarrow: false,
    detail: "En cada cuadro, los 21 puntos se convierten en X, Y, dedos y gesto." },
  { id: "e-mensaje", from: "emisor", to: "broker", kind: "data", layer: "datos", lane: -1, label: "X:52 Y:31 D:2 G:V", mono: true, labelNarrow: false,
    detail: "El texto viaja por MQTT sobre WebSocket seguro (wss), con QoS 0: hasta 5 por segundo y un latido cada 1 s." },
  { id: "e-reparto", from: "broker", to: "receptor", kind: "data", layer: "datos", lane: -1, narrowLabel: "X:52 Y:31 D:2 G:V", mono: true,
    detail: "El broker entrega el mensaje a quien está suscrito: la página del profesor." },
  { id: "e-validado", from: "receptor", to: "webserial", kind: "data", layer: "datos", lane: -1,
    detail: "Solo pasa si respeta el formato exacto y los rangos." },
  { id: "e-usb", from: "webserial", to: "arduino", kind: "data", layer: "datos", lane: -1, label: "USB · 9600 baudios",
    detail: "El mismo texto por el cable USB, a 9600 baudios. El cable además alimenta al Arduino con 5 V." },
  { id: "e-pwm", from: "arduino", to: "servos", kind: "data", layer: "datos", label: "PWM 50 Hz",
    detail: "Un pulso de 544 a 2400 µs cada 20 ms: el ancho del pulso indica el ángulo." },
  { id: "e-mueve", from: "servos", to: "brazo", kind: "data", layer: "datos",
    detail: "Cada servo mueve una articulación del brazo." },
  { id: "e-leds", from: "arduino", to: "leds", kind: "data", layer: "datos", label: "o LEDs", labelNarrow: false,
    detail: "Con el sketch de LEDs: 1, 2 o 3 encendidos según los dedos." },

  { id: "s-arduino", from: "arduino", to: "webserial", kind: "status", layer: "estado", lane: 1, label: "OK: BRAZO…", mono: true, labelNarrow: false,
    detail: "«OK: BRAZO IZQUIERDA 72 72»: lo que hizo el brazo de verdad." },
  { id: "s-serial", from: "webserial", to: "receptor", kind: "status", layer: "estado", lane: 1,
    detail: "La respuesta del Arduino llega a la página del profesor." },
  { id: "s-receptor", from: "receptor", to: "broker", kind: "status", layer: "estado", lane: 1,
    detail: "Estado del brazo y de los LEDs, quién controla y el ID del video, como mensajes retenidos (QoS 1)." },
  { id: "s-emisor", from: "broker", to: "emisor", kind: "status", layer: "estado", lane: 1, label: "estado · control", labelNarrow: false,
    detail: "El alumno ve si tiene el control, si el profesor está en línea y qué hizo el brazo." },

  { id: "v-webrtc", from: "camarabrazo", to: "vdo", kind: "video", layer: "video", label: "WebRTC",
    detail: "Video por WebRTC: directo entre las PCs o por un servidor de relevo (TURN)." },
  { id: "v-visor", from: "vdo", to: "visor", kind: "video", layer: "video", label: "≤ 1000 kbps", labelNarrow: false,
    detail: "Hasta 1000 kbps por cada alumno que mira." },

  { id: "p-servos", from: "fuente", to: "servos", kind: "energy", layer: "energia", label: "5 V",
    detail: "5 V y GND desde la fuente ATX." },
  { id: "p-gnd", from: "fuente", to: "arduino", kind: "energy", layer: "energia", label: "GND común", arrow: false, labelAt: "mid",
    detail: "El GND de la fuente unido al del Arduino: la referencia común que necesita la señal de los servos." },

  { id: "w-emisor", from: "hosting", to: "emisor", kind: "web", layer: "web", label: "https", labelNarrow: false,
    detail: "La página y sus librerías se descargan por https al abrirla." },
  { id: "w-receptor", from: "hosting", to: "receptor", kind: "web", layer: "web",
    detail: "La página y sus librerías se descargan por https al abrirla." }
];

// Capas: resaltan un recorrido. "seguridad" no es un tipo de línea: resalta los componentes con security: true
export var LAYERS = [
  { id: "todo", label: "Todo", caption: "El mapa completo. Elegí un componente para ver sus detalles." },
  { id: "datos", label: "Datos de la mano", caption: "Unos 20 caracteres de texto recorren cuatro tramos: navegador, internet, navegador y cable USB." },
  { id: "estado", label: "Estado y control", caption: "Lo que vuelve: el profesor decide quién controla y el Arduino cuenta lo que hizo de verdad." },
  { id: "video", label: "Video", caption: "El video no pasa por el broker: va directo entre las dos PCs. Por el broker solo viaja la llave para conectarse." },
  { id: "energia", label: "Energía", caption: "Dos fuentes: el USB alimenta al Arduino y la ATX a los motores, unidas por un GND común." },
  { id: "web", label: "Carga de la página", caption: "Las páginas son archivos estáticos de GitHub Pages; las librerías llegan de un CDN." },
  { id: "seguridad", label: "Seguridad", caption: "Cada punta desconfía de la otra: permisos en el broker, validación doble, iframe sin cámara y tres «hombres muertos»." }
];

// Disposiciones del diagrama, en píxeles del lienzo a zoom 100 %. card es el tamaño de referencia de las tarjetas
// (las líneas se apoyan en sus bordes). sides fuerza los lados de salida y llegada cuando el automático haría pasar
// la línea por encima de otra tarjeta; laneShift corre los extremos a lo largo del lado: [salida, llegada]
export var LAYOUTS = {
  // Escritorio: zonas en columnas, el recorrido principal en una fila de izquierda a derecha
  wide: {
    width: 1620,
    height: 620,
    card: { w: 176, h: 70 },
    zones: { student: [0, 460], cloud: [460, 700], teacher: [700, 1160], robot: [1160, 1620] },
    pos: {
      webcam: [115, 125], mediapipe: [115, 285], emisor: [345, 285], visor: [345, 555],
      hosting: [580, 125], broker: [580, 285], vdo: [580, 555],
      receptor: [815, 285], webserial: [1045, 285], camarabrazo: [815, 555],
      arduino: [1275, 285], servos: [1505, 285], brazo: [1505, 125], fuente: [1505, 435], leds: [1275, 555]
    },
    sides: {
      "w-emisor": ["left", "top"],
      "w-receptor": ["right", "top"],
      "p-gnd": ["left", "bottom"],
      "e-leds": ["bottom", "top"]
    },
    laneShift: { "p-gnd": [30, 30], "e-leds": [-30, -30] }
  },
  // Celular: zonas apiladas de arriba hacia abajo y dos columnas de tarjetas.
  // El margen izquierdo (32) es para los nombres de zona, escritos en vertical: así no pisan las líneas
  narrow: {
    width: 460,
    height: 1150,
    card: { w: 176, h: 66 },
    zoneLabels: "side",
    zones: { student: [0, 350], cloud: [350, 580], teacher: [580, 810], robot: [810, 1150] },
    pos: {
      webcam: [120, 80], mediapipe: [120, 190], emisor: [120, 300], visor: [340, 300],
      hosting: [230, 420], broker: [120, 520], vdo: [340, 520],
      receptor: [120, 650], camarabrazo: [340, 650], webserial: [120, 760],
      brazo: [340, 870], servos: [340, 980], arduino: [120, 980], fuente: [340, 1090], leds: [120, 1090]
    },
    sides: {
      "w-emisor": ["top", "right"],
      "w-receptor": ["bottom", "right"],
      "p-gnd": ["left", "right"]
    },
    laneShift: { "p-gnd": [-20, 20] }
  }
};

// Leyenda: estilos de línea (los colores de zona se explican con las propias zonas)
export var LINE_KINDS = [
  { kind: "data", label: "Datos de la mano" },
  { kind: "status", label: "Estado y control (vuelta)" },
  { kind: "video", label: "Video en vivo" },
  { kind: "energy", label: "Energía" },
  { kind: "web", label: "Carga de la página" }
];
