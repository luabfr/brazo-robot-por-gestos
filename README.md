# Brazo robot por gestos

Un alumno mueve la mano frente a su webcam y, a miles de kilómetros, un Arduino responde.

Proyecto del curso de robótica con Arduino: control remoto de un robot con gestos de la mano, usando solo tecnologías web.

- **MediaPipe** detecta los 21 puntos de la mano en el navegador y los convierte en posición (X, Y), cantidad de dedos y gesto.
- **MQTT** lleva esos datos por internet, de un país a otro, a través de un broker en la nube (EMQX).
- **Web Serial** envía los datos desde el navegador del profesor al Arduino por USB.

Hoy el Arduino enciende 1, 2 o 3 LEDs según la cantidad de dedos. El objetivo siguiente es mover un brazo robot.

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
| `robotica/<sala>/receptor` | Receptor (y el broker, con el *Last Will*) | `online` / `offline`, retenido |

### Seguridad y fallas

- **Sin secretos en el código.** El sitio es público, así que el usuario y la contraseña del broker se escriben en la página al conectarse. Nunca se guardan en el repositorio.
- **Permisos por rol en el broker.** El usuario `emisor` no puede publicar en `control`, así que ningún alumno puede darse el control a sí mismo.
- **Validación en dos capas.** El receptor descarta todo mensaje que no respete el formato exacto, y el sketch del Arduino vuelve a validar.
- **Sala y alias restringidos.** Solo aceptan minúsculas, números y guiones. Así no se pueden usar los comodines de MQTT (`+`, `#`) para meterse en los topics de otros.
- **Si algo falla, el robot recibe `SIN_MANO`.** Pasa cuando un alumno cierra la pestaña o pierde internet (el broker publica su *Last Will*), cuando la pestaña del alumno queda en segundo plano y cuando el receptor pierde el broker.

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
   | `emisor` | Publicar y suscribirse | `#` | Denegar |
   | `receptor` | Suscribirse | `robotica/+/alumnos/+/estado` | Permitir |
   | `receptor` | Suscribirse | `robotica/+/alumnos/+/mano` | Permitir |
   | `receptor` | Publicar | `robotica/+/control` | Permitir |
   | `receptor` | Publicar | `robotica/+/leds` | Permitir |
   | `receptor` | Publicar | `robotica/+/receptor` | Permitir |
   | `receptor` | Publicar y suscribirse | `#` | Denegar |

4. En [`js/config.js`](js/config.js), reemplazar `<EMQX_HOST>` por la dirección (*Address*) del deployment. Queda así: `wss://<EMQX_HOST>:8084/mqtt`.

**Límites del plan gratuito a tener en cuenta:**
- 10 publicaciones por segundo por cliente. El emisor envía como máximo 5.
- Una cuota mensual de minutos de sesión y de tráfico. Conviene cerrar las pestañas al terminar la clase.

### 2. Arduino

Sketch: [`arduino/hand_leds/hand_leds.ino`](arduino/hand_leds/hand_leds.ino).

- 3 LEDs con la pata negativa (cátodo) en los pines 8, 9 y 10, y la positiva a 5V con una resistencia de 220 a 330 Ω cada uno. Con este montaje el LED se enciende con `LOW`.
- Si los LEDs están conectados al revés, cambiar `LED_ACTIVE_LOW` a `false`.
- Para probar sin la web, escribir `LEDS 2` en el Monitor Serie a 9600 baudios.

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
arduino/hand_leds/     sketch del Arduino para este proyecto (3 LEDs según los dedos)
arduino/led_13/        sketch de la primera clase: LED del pin 13 con ENCENDER / APAGAR desde el Monitor Serie
```

## Tecnologías

[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) · [MQTT.js](https://github.com/mqttjs/MQTT.js) · [EMQX Cloud](https://www.emqx.com/en/cloud) · [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API) · Arduino. Sin frameworks ni compilación: HTML, CSS y JavaScript.

## Próximos pasos

- Reemplazar los LEDs por un brazo robot con servos: X/Y → base y hombro, pinza → garra.
- Video en vivo del robot para que el alumno vea el resultado de sus gestos.
- Medir la demora entre países con un ping de ida y vuelta.
