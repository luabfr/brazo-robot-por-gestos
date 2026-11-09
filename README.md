# Brazo robot por gestos

Un alumno mueve la mano frente a su webcam y, a miles de kilómetros, un Arduino responde.

Proyecto del curso de robótica con Arduino: control remoto de un robot con gestos de la mano, usando solo tecnologías web.

- **MediaPipe** detecta los 21 puntos de la mano en el navegador y los convierte en posición (X, Y), cantidad de dedos y gesto.
- **MQTT** lleva esos datos por internet, de un país a otro, a través de un broker en la nube (EMQX).
- **Web Serial** envía los datos desde el navegador del profesor al Arduino por USB.

El Arduino puede tener uno de dos sketches, y las páginas se adaptan solas al que esté cargado:

- **LEDs:** enciende 1, 2 o 3 LEDs según la cantidad de dedos.
- **Brazo robot de 2 motores:** con la mano cerrada los dos motores se mueven a la izquierda; con la mano abierta, a la derecha.

## Páginas

| Página | Para quién | Qué hace |
|---|---|---|
| [`index.html`](index.html) | Todos | Portada: elegir el rol. |
| [`emisor.html`](emisor.html) | Alumnos | Detecta la mano con la webcam y publica los datos cuando el profesor le da el control. |
| [`receptor.html`](receptor.html) | Profesor | Lista a los alumnos conectados, elige quién controla el robot y reenvía sus datos al Arduino. |
| [`hand-tracking.html`](hand-tracking.html) | Pruebas | Versión local: cámara y Arduino en la misma PC, sin internet de por medio. |

El receptor y la versión local necesitan **Chrome o Edge de escritorio** (Web Serial no está en otros navegadores). Todas las páginas tienen que abrirse desde `https://` o `http://localhost`, porque la cámara y Web Serial solo funcionan en orígenes seguros.

## Cómo funciona

```
 Alumno (emisor.html)              Broker MQTT (EMQX Cloud)            Profesor (receptor.html)
┌──────────────────────┐   wss   ┌────────────────────────────┐  wss  ┌──────────────────────┐  USB  ┌─────────┐
│ webcam + MediaPipe   │────────▶│ robotica/<sala>/alumnos/…  │──────▶│ valida el mensaje    │──────▶│ Arduino │
│ "X:52 Y:31 D:2 G:V"  │         │ robotica/<sala>/control    │       │ y lo envía por       │       │ 3 LEDs  │
│ ve si tiene control  │◀────────│ robotica/<sala>/leds       │◀──────│ Web Serial           │◀──────│         │
└──────────────────────┘         └────────────────────────────┘       └──────────────────────┘       └─────────┘
```

1. Cada alumno se conecta con un alias y anuncia que está `online`.
2. El profesor ve la lista y pulsa **Dar control** en uno.
3. Solo ese alumno publica sus datos. Los demás quedan *en espera*, sin gastar el cupo del broker.
4. El receptor valida cada mensaje y lo envía al Arduino. El Arduino confirma cuántos LEDs encendió y esa confirmación les llega a todos los alumnos.

### Protocolo

Una línea de texto por mensaje. Es el mismo formato en todo el recorrido: navegador → broker → navegador → Arduino.

| Mensaje | Significado |
|---|---|
| `X:52 Y:31 D:2 G:V` | X e Y de 0 a 100 (Y crece hacia arriba), D = dedos extendidos (0 a 5), G = gesto |
| `SIN_MANO` | No hay mano, se perdió la conexión o no hay nadie con el control: el robot vuelve a reposo |

Gestos: `ABIERTA`, `CERRADA`, `PINZA`, `INDICE`, `V`, `OTRO`. Se reconocen midiendo los 21 puntos de la mano: no usan un segundo modelo de IA.

### Topics MQTT

| Topic | Publica | Contenido |
|---|---|---|
| `robotica/<sala>/alumnos/<alias>/estado` | Emisor (y el broker, con el *Last Will*) | `online` / `offline`, retenido |
| `robotica/<sala>/alumnos/<alias>/mano` | Emisor, solo con el control | Mensaje del protocolo |
| `robotica/<sala>/control` | Receptor | Alias de quien controla (vacío = nadie), retenido |
| `robotica/<sala>/leds` | Receptor | `OK: LEDS n` confirmado por el Arduino, retenido |
| `robotica/<sala>/brazo` | Receptor | `OK: BRAZO <estado> <ángulo 1> <ángulo 2>` informado por el brazo, retenido |
| `robotica/<sala>/receptor` | Receptor (y el broker, con el *Last Will*) | `online` / `offline`, retenido |

### Seguridad y fallas

- **Sin secretos en el código.** El sitio es público, así que el usuario y la contraseña del broker se escriben en la página al conectarse. Nunca se guardan en el repositorio.
- **Permisos por rol en el broker.** El usuario `emisor` no puede publicar en `control`, así que ningún alumno puede darse el control a sí mismo.
- **Validación en dos capas.** El receptor descarta todo mensaje que no respete el formato exacto, y el sketch del Arduino vuelve a validar.
- **Sala y alias restringidos.** Solo aceptan minúsculas, números y guiones. Así no se pueden usar los comodines de MQTT (`+`, `#`) para meterse en los topics de otros.
- **Si algo falla, el robot recibe `SIN_MANO`.** Pasa cuando un alumno cierra la pestaña o pierde internet (el broker publica su *Last Will*), cuando la pestaña del alumno queda en segundo plano y cuando el receptor pierde el broker.
- **"Hombre muerto" en dos niveles.** Las páginas repiten el estado actual aunque la mano esté quieta. El emisor lo repite cada 1 s y el receptor se lo repite al Arduino cada 0,4 s.
  - Si el alumno con el control deja de enviar durante 3 s, el receptor detiene el robot.
  - Si el Arduino del brazo deja de recibir mensajes durante 2 s, frena los motores por su cuenta.
- **Dejar visible la pestaña del receptor.** El navegador frena los temporizadores de las pestañas ocultas: el latido hacia el Arduino baja a 1 por segundo y queda menos margen antes del frenado.

## Puesta en marcha

### 1. Broker (EMQX Cloud Serverless, plan gratuito)

1. Crear un deployment *Serverless* en [EMQX Cloud](https://www.emqx.com/en/cloud/serverless-mqtt).
2. En **Access Control → Authentication**, crear dos usuarios: `emisor` (lo comparten los alumnos) y `receptor` (solo el profesor).
3. En **Access Control → Authorization**, cargar estas reglas. En cada usuario, las reglas se evalúan en orden y la última deniega todo lo demás.

   | Usuario | Acción | Topic | Permiso |
   |---|---|---|---|
   | `emisor` | Publicar | `robotica/+/alumnos/+/estado` | Permitir |
   | `emisor` | Publicar | `robotica/+/alumnos/+/mano` | Permitir |
   | `emisor` | Suscribirse | `robotica/+/control` | Permitir |
   | `emisor` | Suscribirse | `robotica/+/leds` | Permitir |
   | `emisor` | Suscribirse | `robotica/+/receptor` | Permitir |
   | `emisor` | Suscribirse | `robotica/+/brazo` | Permitir |
   | `emisor` | Publicar y suscribirse | `#` | Denegar |
   | `receptor` | Suscribirse | `robotica/+/alumnos/+/estado` | Permitir |
   | `receptor` | Suscribirse | `robotica/+/alumnos/+/mano` | Permitir |
   | `receptor` | Publicar | `robotica/+/control` | Permitir |
   | `receptor` | Publicar | `robotica/+/leds` | Permitir |
   | `receptor` | Publicar | `robotica/+/receptor` | Permitir |
   | `receptor` | Publicar | `robotica/+/brazo` | Permitir |
   | `receptor` | Publicar y suscribirse | `#` | Denegar |

4. En [`js/config.js`](js/config.js), reemplazar `<EMQX_HOST>` por la dirección (*Address*) del deployment. Queda así: `wss://<EMQX_HOST>:8084/mqtt`.

**Límites del plan gratuito a tener en cuenta:**
- 10 publicaciones por segundo por cliente. El emisor envía como máximo 5.
- Una cuota mensual de minutos de sesión y de tráfico. Conviene cerrar las pestañas al terminar la clase.

### 2. Arduino

Hay dos sketches. Los dos usan el mismo mensaje, así que las páginas no cambian: se carga uno u otro en el Arduino.

**LEDs:** [`arduino/hand_leds/hand_leds.ino`](arduino/hand_leds/hand_leds.ino)

- 3 LEDs con la pata negativa (cátodo) en los pines 8, 9 y 10, y la positiva a 5V con una resistencia de 220 a 330 Ω cada uno. Con este montaje el LED se enciende con `LOW`.
- Si los LEDs están conectados al revés, cambiar `LED_ACTIVE_LOW` a `false`.
- Para probar sin la web, escribir `LEDS 2` en el Monitor Serie a 9600 baudios.

**Brazo robot de 2 motores:** [`arduino/brazo_2_motores/brazo_2_motores.ino`](arduino/brazo_2_motores/brazo_2_motores.ino)

| Gesto | Movimiento |
|---|---|
| Mano cerrada (`G:CERRADA`) | Los dos motores giran de a poco hacia la izquierda mientras se mantiene el gesto |
| Mano abierta (`G:ABIERTA`) | Los dos motores giran de a poco hacia la derecha |
| Cualquier otro gesto, o `SIN_MANO` | Quietos donde están |

- **Conexión:**
  - La señal de cada servo va a los pines 5 y 6.
  - Los servos se alimentan con una **fuente externa de 5 a 6 V**, con el GND unido al del Arduino. El USB no alcanza para dos servos en movimiento y el Arduino se reinicia.
- **Ajustes en el sketch:**
  - Topes de cada motor: `MIN_ANGLE` / `MAX_ANGLE`. Conviene empezar con un rango chico.
  - Posición de reposo: `HOME_ANGLE`.
  - Velocidad: `DEGREES_PER_SECOND`.
  - Si un motor gira al revés por cómo está montado: `REVERSED`.
- **Para probar sin la web,** escribir en el Monitor Serie `IZQUIERDA`, `DERECHA`, `QUIETO` o `CENTRO`.
- **El brazo informa su estado** (`OK: BRAZO IZQUIERDA 72 72`). El receptor y el emisor lo muestran en lugar de los LEDs.
- **Requiere la librería `Servo`,** que viene con el IDE de Arduino.

### 3. Probar en la PC

```bash
python -m http.server 8000
```

Abrir `http://localhost:8000` en Chrome o Edge.

Para probar sin cuenta de EMQX, en **Servidor (avanzado)** se puede usar el broker público de pruebas `wss://broker.emqx.io:8084/mqtt`. Es abierto, así que conviene elegir una sala con un nombre poco común.

### 4. Publicar (GitHub Pages)

El sitio es estático: no necesita compilación. En el repositorio, ir a **Settings → Pages → Deploy from a branch → `main` / raíz**.

## Estructura

```
index.html, emisor.html, receptor.html, hand-tracking.html   páginas
css/app.css            estilos compartidos (diseño de dos columnas sin scroll en escritorio)
js/hand-tracker.js     cámara, MediaPipe, gestos y datos de control
js/serial-link.js      conexión con el Arduino por Web Serial
js/mqtt-link.js        conexión con el broker (MQTT.js sobre wss)
js/protocol.js         formato y validación de los mensajes
js/logger.js           registro de eventos en pantalla
js/config.js           dirección del broker y parámetros (sin credenciales)
arduino/hand_leds/     sketch de LEDs: 1 a 3 LEDs según los dedos
arduino/brazo_2_motores/  sketch del brazo: 2 servos, mano cerrada = izquierda, abierta = derecha
arduino/led_13/        sketch de la primera clase: LED del pin 13 con ENCENDER / APAGAR desde el Monitor Serie
```

## Tecnologías

[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) · [MQTT.js](https://github.com/mqttjs/MQTT.js) · [EMQX Cloud](https://www.emqx.com/en/cloud) · [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API) · Arduino. Sin frameworks ni compilación: HTML, CSS y JavaScript.

## Próximos pasos

- Control proporcional del brazo: X/Y → base y hombro, pinza → garra.
- Video en vivo del robot para que el alumno vea el resultado de sus gestos.
- Medir la demora entre países con un ping de ida y vuelta.
