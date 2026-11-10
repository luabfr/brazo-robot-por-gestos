# Guion de la infografía «Cómo funciona por dentro»

**Estado:** borrador para revisar (Fase 0) · 10/11/2026
**Página:** `arquitectura.html`, enlazada desde la portada.

Este documento define **qué dice y qué muestra** la infografía antes de dibujarla. Cada dato técnico lleva su fuente. Lo marcado **(a confirmar)** necesita un dato tuyo o una fuente mejor. Lo marcado **(estimado)** es un cálculo y la página lo va a mostrar como tal.

---

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Público | Alumnos del curso. Además es pieza de portfolio de UX/UI y frontend, así que el nivel visual tiene que ser alto |
| Diagrama y gráficos | SVG + JavaScript propio, sin dependencias ni build (como el resto del sitio) |
| 3D | three.js para un **banco de trabajo 3D** a escala real, cargado solo al llegar a esa sección (ver §10) |
| Hardware | Arduino **Uno R3 o Mega 2560 Rev3** (la página deja elegir), 2 servos **SG90**, fuente **ATX reciclada**, 3 LEDs en el sketch alternativo |
| Datos que cambian con el código | Se importan de los módulos reales (`config.js`, `protocol.js`, `buildTopics`); los del sketch van en un archivo de contenidos |

---

## 1. Dirección visual (propuesta)

- **Concepto: «plano técnico vivo».** El diagrama vive en un lienzo oscuro con una retícula tenue, como un plano de ingeniería. Es oscuro en los dos modos, igual que el video. Los nodos son tarjetas con ícono y los recorridos son líneas por las que viajan paquetes luminosos.
- **Color con significado.** Se usan los mismos colores de zona de la portada:
  - **índigo:** alumno;
  - **violeta:** internet;
  - **verde azulado:** profesor;
  - **ámbar:** robot.
  Rojo y verde quedan solo para fallas y estados correctos.
- **Tipografía.** La del sitio para el texto y monoespaciada para mensajes, topics y valores. *Opcional:* una tipografía propia para los títulos, autoalojada (sin depender de Google Fonts).
- **Movimiento.**
  - Los paquetes viajan como en la portada.
  - Al pasar el mouse o el foco sobre un nodo, se resaltan él y sus conexiones, y el resto se atenúa.
  - Las capas cambian con una transición de 200 a 300 ms.
  - Sin animaciones si el sistema pide reducir el movimiento.
- **Accesibilidad.**
  - Cada nodo es un botón con nombre.
  - Los tooltips también aparecen con el teclado.
  - Contraste AA verificado.
  - El recorrido guiado se maneja con las flechas.
  - El texto es real: se puede seleccionar, traducir y leer con un lector de pantalla.

---

## 2. Estructura de la página

1. **Encabezado:** ícono y título «Cómo funciona por dentro». Bajada: *«Del gesto de un alumno al motor de un robot, a miles de kilómetros: todo lo que pasa en el medio.»*
2. **Diagrama principal**, con la barra de capas y el botón **▶ Recorrido guiado**.
3. **Panel de detalle:** a la derecha en escritorio, como hoja inferior en el celular.
4. **Banco de trabajo 3D:** los componentes a escala real (§10).
5. **Secciones desplegables** (§7).
6. **Créditos y licencias:** CAD de Arduino (CC-BY-SA 4.0), MediaPipe, MQTT.js, EMQX, VDO.Ninja, three.js y el modelo del brazo de MakerWorld.

---

## 3. Diagrama principal: nodos

Cada nodo tiene un **tooltip** (una línea) y un **panel**, que responde qué es, por qué está así, los datos clave, los archivos y qué pasa si falla.

### Zona alumno (índigo)

**1. Webcam del alumno**
- *Tooltip:* Filma la mano. El video nunca sale de la PC del alumno.
- *Qué es:* la cámara web, que se abre con `getUserMedia` a 1280 × 720 ideal. La vista espejo es solo visual.
- *Por qué:* privacidad. Por internet viajan unos 20 caracteres de texto, no la imagen.
- *Datos:* exige https o `localhost` (orígenes seguros).
- *Archivo:* `js/hand-tracker.js`.
- *Si falla:* permiso denegado, cámara usada por otra aplicación o sin imagen en 10 s. La página explica qué hacer en cada caso.

**2. MediaPipe Hand Landmarker**
- *Tooltip:* Encuentra 21 puntos de la mano en cada cuadro del video.
- *Qué es:* un modelo de Google de unos 7,8 MB, que el navegador guarda en caché. Corre dentro del navegador con WebAssembly y la GPU; si la GPU falla, pasa solo a CPU. Detecta hasta 2 manos.
- *Qué entrega:* x, y, z de cada punto, la posición 3D en metros y si es la mano izquierda o derecha.
- *Cómo se reconoce el gesto:* sin un segundo modelo de IA. Se comparan proporciones de distancias entre los puntos (por ejemplo, la punta del dedo contra la articulación media). Gestos: abierta, cerrada, pinza, índice, V y otro.
- *Para que no tiemble:*
  - suavizado (40 % de cada medición nueva);
  - zona muerta de 2 unidades;
  - un gesto nuevo tiene que mantenerse 150 ms;
  - perder la mano menos de 300 ms se toma como un parpadeo.
- *Archivo:* `js/hand-tracker.js`.

**3. Página del emisor** · pila: HTML · CSS · JS · MQTT.js
- *Tooltip:* Convierte la mano en un mensaje y lo publica solo si tenés el control.
- *Datos:*
  - como máximo 5 mensajes por segundo (el broker permite 10 por cliente);
  - publica solo cuando algo cambia;
  - con la mano quieta repite el estado cada 1 s (latido);
  - si la pestaña queda en segundo plano, envía `SIN_MANO`.
- *Archivos:* `emisor.html`, `js/mqtt-link.js`, `js/protocol.js`.

**4. Visor del brazo** (iframe de VDO.Ninja)
- *Tooltip:* Muestra el brazo en vivo. No tiene permiso para usar tu cámara.
- *Por qué:* el iframe se declara sin permiso de cámara ni de micrófono. Es una garantía del navegador, no una promesa del código.

### Zona internet (violeta)

**5. Broker MQTT** · EMQX Cloud Serverless
- *Tooltip:* El cartero: recibe cada mensaje y lo entrega a quien esté suscrito.
- *Qué es:* publicación y suscripción. Nadie se conecta directo con nadie: todos hablan con el broker. MQTT 5 sobre WebSocket seguro (`wss`, puerto 8084).
- *Conceptos que explica el panel:*
  - topic;
  - QoS 0 (datos de la mano) y QoS 1 (estados);
  - mensaje retenido;
  - *Last Will* (el aviso que el broker publica si alguien se cae);
  - keepalive;
  - permisos por usuario (ACL).
- *Límites del plan gratuito* (verificados): 1 GB de tráfico por mes, 10 publicaciones/s por cliente, mensajes de hasta 1 MB, 1000 conexiones.

**6. VDO.Ninja** · señalización y relevo
- *Tooltip:* Presenta a las dos PCs para que el video viaje directo entre ellas.
- *Qué es:* WebRTC. El video va directo (P2P) y, si la red no lo permite, pasa por un servidor de relevo (TURN). WebRTC cifra siempre el video (DTLS-SRTP).
- *Datos:* ID y clave nuevos en cada encendido; tope de 1000 kbps por alumno.

**7. Hosting estático** · GitHub Pages + CDN
- *Tooltip:* Las páginas son archivos: no hay servidor propio.
- *Datos:* GitHub Pages sirve el sitio por https. MediaPipe y MQTT.js se cargan desde `cdn.jsdelivr.net`, con versiones fijadas para que una actualización no rompa nada.

### Zona profesor (verde azulado)

**8. Página del receptor** · pila: HTML · CSS · JS · MQTT.js
- *Tooltip:* Elige quién controla, revisa cada mensaje y lo reenvía al Arduino.
- *Datos:*
  - solo escucha al alumno con el control;
  - descarta todo mensaje que no respete el formato exacto;
  - repite el estado al Arduino cada 0,4 s;
  - si el alumno calla 3 s, el robot pasa a `SIN_MANO`;
  - si el alumno se desconecta, le quita el control.
- *Archivo:* `receptor.html`.

**9. Web Serial API**
- *Tooltip:* El navegador le habla al Arduino por el cable USB.
- *Datos:*
  - Chrome o Edge de escritorio;
  - 9600 baudios;
  - un mensaje por línea, terminado en salto de línea (`\n`);
  - el usuario autoriza el puerto una vez;
  - la página espera el saludo `LISTO` del sketch (hasta 3 s) antes de enviar.
- *Para explicar:* en el Uno y el Mega, abrir el puerto reinicia la placa (auto-reset), y por eso existe el saludo. **(a confirmar en la documentación oficial; no pude leer la página)**
- *Archivo:* `js/serial-link.js`.

**10. Webcam del brazo**
- *Tooltip:* La cámara que filma el brazo para los alumnos.
- *Datos:* se elige por nombre; sin audio; un stream por alumno que mira (P2P).

### Zona robot (ámbar)

**11. Arduino** · Uno R3 o Mega 2560 Rev3 (selector en la página)
- *Tooltip:* Lee cada mensaje y decide cómo mover los motores.
- *Comparación* (fichas oficiales; medidas del CAD oficial):

| | Uno R3 | Mega 2560 Rev3 |
|---|---|---|
| Microcontrolador | ATmega328P, 16 MHz | ATmega2560, 16 MHz |
| Flash / SRAM / EEPROM | 32 KB / 2 KB / 1 KB | 256 KB (8 KB de bootloader) / 8 KB / 4 KB |
| Pines digitales | 14 (6 con PWM) | 54 (15 con PWM) |
| Entradas analógicas | 6 | 16 |
| Puertos serie de hardware | 1 | 4 |
| USB | Conector USB-B; chip ATmega16U2 | Conector USB-B; chip ATmega16U2 |
| Placa (contorno del CAD) | 68,58 × 53,34 mm, 4 agujeros de 3,2 mm | 101,60 × 53,34 mm, 6 agujeros de 3,2 mm |

- *Qué hace el sketch* (`arduino/brazo_2_motores`):
  - gesto CERRADA → izquierda; ABIERTA → derecha; cualquier otro → quieto;
  - frena solo en los topes (20° a 160°);
  - si pasan **2 s sin mensajes**, frena por su cuenta;
  - responde `OK: BRAZO <estado> <ángulo 1> <ángulo 2>`.
- *Librería Servo* (código fuente oficial):
  - pulsos de 544 a 2400 µs por defecto, renovados cada 20 ms (50 Hz);
  - en el Uno usa el Timer1 y en el Mega empieza por el Timer5;
  - al usarla, se desactiva el PWM de los pines de ese timer. En el Uno serían el 9 y el 10 **(a confirmar el número de pin)**. El sketch de los LEDs usa esos pines, pero solo para prender y apagar, sin PWM, así que no afecta.

**12. Servos SG90** (× 2)
- *Tooltip:* Motores que giran a un ángulo exacto según el ancho de un pulso.
- *Datos del fabricante* (TowerPro; la ficha leída es la del **SG90 digital**):
  - 4,8 V;
  - 1,8 kg·cm a 4,8 V;
  - 0,1 s cada 60° a 4,8 V;
  - zona muerta de 1 µs;
  - medidas: 23 × 12,2 × 29 mm.
- *Peso:* la misma página dice 9 g en un lugar y 0,019 kg en otro **(a confirmar)**.
- *Dónde se usa más lento:* el sketch lo mueve a 40°/s para que el brazo sea suave y predecible, muy por debajo de su velocidad máxima.
- *Corriente:* no figura en la ficha. Es justamente el motivo de la fuente externa.

**13. Fuente ATX reciclada** (salida de 5 V)
- *Tooltip:* Da la corriente que el USB no alcanza para dos motores.
- *Conector de 24 pines* **(fuente secundaria: a confirmar con la guía de Intel)**:
  - rojo: +5 V;
  - negro: GND;
  - verde: PS_ON#; la fuente arranca cuando se une a GND;
  - morado: +5 V de reposo (siempre activo);
  - gris: PWR_OK («todo en orden»);
  - amarillo: +12 V; naranja: +3,3 V.
- *Seguridad* (esto también es contenido didáctico):
  - no abrir la fuente: adentro hay tensión de red y capacitores que quedan cargados;
  - entrega mucha corriente, así que un cortocircuito puede quemar un cable; conviene un fusible;
  - el GND de la fuente se une con el del Arduino: sin GND común, el servo no entiende la señal.
- *Por qué:* dos servos en movimiento piden más corriente de la que da el USB, y el Arduino se reinicia (README).

**14. Brazo impreso en 3D**
- *Tooltip:* La estructura: un diseño de MakerWorld impreso en el curso.
- *Datos:* el diseño es de 3 ejes; el sketch actual mueve 2. Hay un enlace al modelo.

**15. LEDs** (sketch alternativo `hand_leds`)
- *Tooltip:* 1, 2 o 3 LEDs según la cantidad de dedos.
- *Datos:* pines 8, 9 y 10, con el cátodo al pin (se encienden con LOW) y resistencias de 220 a 330 Ω a 5 V.
- *Para el cálculo:* un LED rojo típico de 5 mm (Kingbright WP7113ID) tiene 1,9 V típicos (2,3 V máx.) a 10 mA, y 30 mA como máximo continuo. Con 220 Ω pasan unos 14 mA y con 330 Ω unos 9 mA **(estimado)**.

---

## 4. Conexiones (qué viaja por cada línea)

| # | De → a | Qué viaja | Cómo | Cada cuánto | Capa |
|---|---|---|---|---|---|
| 1 | Webcam → MediaPipe | Cuadros de video | Dentro del navegador | Lo que entregue la cámara | Datos de la mano |
| 2 | MediaPipe → Emisor | 21 puntos → X, Y, dedos y gesto | En memoria | Cada cuadro | Datos de la mano |
| 3 | Emisor → Broker | `X:52 Y:31 D:2 G:V` | MQTT sobre `wss`, QoS 0 | Hasta 5/s; latido cada 1 s | Datos de la mano |
| 4 | Broker → Receptor | El mismo texto | MQTT sobre `wss` | Ídem | Datos de la mano |
| 5 | Receptor → Arduino | El mismo texto + `\n` | Web Serial por USB, 9600 baudios | Al cambiar; latido cada 0,4 s | Datos de la mano |
| 6 | Arduino → Servos | Pulsos de 544 a 2400 µs | Cable de señal (pines 5 y 6) | Cada 20 ms (50 Hz) | Datos de la mano |
| 7 | Arduino → Receptor | `OK: BRAZO IZQUIERDA 72 72` / `OK: LEDS 2` | Web Serial | Al cambiar | Estado y control |
| 8 | Receptor → Broker → Emisor | Estado del brazo y de los LEDs, quién tiene el control, profesor en línea | MQTT, QoS 1, retenido | Al cambiar | Estado y control |
| 9 | Emisor → Broker | `online` / `offline` del alumno (*Last Will*) | MQTT, QoS 1, retenido | Al conectar y desconectar | Estado y control |
| 10 | Receptor → Broker → Emisor | `VIDEO <id> <clave>` | MQTT, QoS 1, retenido | Al encender o apagar la cámara | Video |
| 11 | Webcam del brazo → Visor del emisor | Video | WebRTC P2P (o relevo TURN) | Hasta 1000 kbps por alumno | Video |
| 12 | Fuente ATX → Servos | +5 V y GND | Cables rojo y negro | — | Energía |
| 13 | PC del profesor → Arduino | 5 V | Cable USB | — | Energía |
| 14 | Fuente ↔ Arduino | GND común | Cable negro | — | Energía |
| 15 | GitHub Pages / CDN → navegadores | Páginas y librerías | https | Al cargar | (ninguna: se ve en «La web») |

---

## 5. Capas

Al elegir una capa se resaltan sus nodos y conexiones, y aparece una frase arriba del diagrama.

- **Todo:** el mapa completo.
- **Datos de la mano:** *«Unos 20 caracteres de texto recorren cuatro tramos: navegador, internet, navegador y cable USB.»*
- **Video:** *«El video no pasa por el broker: va directo entre las dos PCs, y por el broker solo viaja la llave para conectarse.»*
- **Estado y control:** *«Lo que vuelve: el profesor decide quién controla y el Arduino cuenta lo que hizo de verdad.»*
- **Energía:** *«Dos fuentes: el USB alimenta al Arduino y la ATX a los motores, unidas por un GND común.»*
- **Seguridad:** *«Cada punta desconfía de la otra: permisos en el broker, validación doble, iframe sin cámara y tres "hombres muertos".»*

---

## 6. Recorrido guiado (13 pasos)

1. **Todo empieza con una mano.** La webcam del alumno filma. El video no sale de su PC.
2. **21 puntos.** MediaPipe ubica la muñeca, los nudillos y las puntas de los dedos.
3. **Un gesto se vuelve texto.** Las proporciones de la mano se convierten en `X:52 Y:31 D:5 G:ABIERTA`.
4. **Solo si tenés el control.** El emisor publica nada más cuando el profesor lo eligió.
5. **Viaje por internet.** El broker recibe y reparte: publicación y suscripción, por sala.
6. **El profesor revisa.** El receptor compara el mensaje con el formato exacto. Si no coincide, lo descarta.
7. **Del navegador al cable.** Web Serial lo envía por USB a 9600 baudios.
8. **El Arduino decide.** ABIERTA → derecha. Revisa de nuevo el formato y respeta los topes.
9. **Energía aparte.** La fuente ATX alimenta a los motores, con GND común.
10. **El servo gira.** Un pulso cada 20 ms indica el ángulo, y el sketch avanza de a 1° (40°/s).
11. **El brazo responde.** `OK: BRAZO DERECHA 96 96` vuelve hasta el alumno.
12. **Y el alumno lo ve.** El video llega directo por WebRTC.
13. **Si algo se corta…** Tres "hombres muertos" frenan el robot (enlace a §9).

---

## 7. Secciones desplegables

### 7.1 Hardware: Arduino, servos y alimentación
- Tabla Uno vs. Mega (§3, nodo 11), con selector para el 3D.
- **Esquema de conexión interactivo** (SVG): Arduino, servos, fuente y LEDs. Al pasar sobre un cable se ve qué lleva: «señal, pin 5», «+5 V desde la fuente», «GND común».
- **Cómo funciona un servo:** pulso de 1 a 2 ms cada 20 ms → ángulo (animación con el pulso y el brazo del servo).
- Seguridad eléctrica (§3, nodo 13).

### 7.2 El mensaje: anatomía y validación
- Anatomía de `X:52 Y:31 D:2 G:V` (como en la portada, ampliada).
- **Simulador:** controles de X, Y, dedos y gesto. Se ve:
  - el mensaje armado con `formatMessage()`;
  - si lo acepta `parseMessage()`, el código real;
  - qué haría el brazo.
  También permite escribir un mensaje a mano para ver por qué se rechaza.
- **Validación doble:** el receptor (expresión regular y rangos) y después el sketch (largo máximo de 48 caracteres y formato).

### 7.3 MQTT: topics, retenidos, Last Will y permisos
- Conceptos, con mini-ilustraciones.
- **Tabla de topics generada desde `buildTopics()`**, para que no quede desactualizada.
- Permisos: qué puede publicar o leer `emisor` y qué `receptor`, y por qué un alumno no puede darse el control a sí mismo.
- Límites del plan gratuito (§3, nodo 5) y gráfico G3.

### 7.4 Video: WebRTC, P2P y ancho de banda
- Directo vs. relevo (TURN), con una animación.
- Gráfico G1 (ancho de banda).
- Privacidad: permisos del iframe y clave nueva en cada encendido.

### 7.5 Seguridad y «hombre muerto»
- Gráfico G2 (línea de tiempo).
- Escenarios de falla interactivos (§9).

### 7.6 La web: HTML, CSS y JS sin frameworks
- Módulos ES nativos, sin build: lo que está en el repositorio es lo que corre.
- Orígenes seguros: por qué la cámara y Web Serial exigen https.
- Librerías desde CDN con versión fijada.
- Sin secretos en el código: las credenciales se escriben en la página. `localStorage` guarda solo datos que no son secretos.
- Accesibilidad y modo oscuro: tokens de color con contraste verificado.

---

## 8. Gráficos

**G1 · Ancho de banda: datos de la mano vs. video** (barras con etiquetas)
- *Datos de la mano:*
  - el mensaje `X:52 Y:31 D:5 G:ABIERTA` tiene 23 caracteres y el topic `robotica/clase/alumnos/ana/mano`, 31;
  - con el sobrecosto de MQTT, WebSocket y TLS (unas decenas de bytes), son unos 0,3 a 0,5 KB/s a 5 mensajes por segundo **(estimado)**.
- *Video:* tope de 1000 kbps = 125 KB/s por alumno.
- *Mensaje del gráfico:* el video pesa **unas 250 a 400 veces más** **(estimado)**. Por eso va por otro camino.

**G2 · Línea de tiempo de los «hombre muerto»** (escala logarítmica; valores exactos del código)

| Tiempo | Qué pasa | Dónde |
|---|---|---|
| 0,15 s | Un gesto nuevo se acepta | `hand-tracker.js` |
| 0,3 s | Se da la mano por perdida | `hand-tracker.js` |
| 0,4 s | Latido del receptor al Arduino | `receptor.html` |
| 1 s | Latido del emisor | `emisor.html` |
| 2 s | El Arduino frena solo | `brazo_2_motores.ino` |
| 3 s | El receptor detiene el robot | `receptor.html` |
| ~15 s | El broker publica el *Last Will* (1,5 × keepalive de 10 s) | `config.js` y la especificación de MQTT |

**G3 · Cuota del plan gratuito de EMQX** (opcional)
- Consumo de una clase de 1 h con datos de la mano y estados (unos pocos MB, **estimado**) frente a 1 GB por mes.
- Muestra por qué el video **no** podía ir por MQTT: con fotos JPEG se agotaba en menos de una clase.

**G4 · Escala** (dentro del 3D): Uno, Mega y SG90 lado a lado, con una regla en mm.

---

## 9. Escenarios de falla (interactivos)

Cada escenario se reproduce sobre el diagrama, con sus tiempos.

1. **El alumno cierra la pestaña.** Avisa `offline`; si no llega, el broker publica su *Last Will* (en unos 15 s). El receptor le quita el control → `SIN_MANO` → robot quieto.
2. **El alumno pierde internet.** Deja de enviar. A los 3 s el receptor detiene el robot; a los ~15 s el broker lo da por desconectado.
3. **La pestaña del alumno queda en segundo plano.** `SIN_MANO` inmediato: si no, el último gesto quedaría «congelado».
4. **El profesor pierde el broker.** El receptor manda `SIN_MANO` al Arduino. Los alumnos ven «Profesor desconectado» y el video desaparece.
5. **Se desconecta el USB.** El receptor lo detecta y borra los estados retenidos del brazo y los LEDs.
6. **La página del receptor se cuelga.** Sin latidos, el Arduino frena solo a los 2 s.
7. **Llega un mensaje inválido o malicioso.** El receptor lo descarta (formato exacto) y el sketch vuelve a validar.
8. **Un alumno intenta darse el control.** El broker lo impide: el usuario `emisor` no tiene permiso para publicar en `control`.

---

## 10. Banco de trabajo 3D (evaluación de tu propuesta)

**Objetivo:** que un alumno remoto, que nunca vio la placa en persona, vea cada componente **en su tamaño real y en proporción con los demás**, con modelos basados en especificaciones de los fabricantes. Tiene que poder ampliarse con potenciómetros, un display, etc.

**Fuentes evaluadas**

| Fuente | Qué aporta | Limitaciones |
|---|---|---|
| **CAD oficial de Arduino** (Eagle `.brd`, CC-BY-SA 4.0) | Contorno exacto (Uno 68,58 × 53,34 mm; Mega 101,60 × 53,34 mm), agujeros y **posición de cada componente** (p. ej. ATmega328P en 46,4 / 16,4 mm, conector de alimentación, headers, ICSP, LEDs) | No trae modelo 3D, pero sí todo lo necesario para generarlo. Pide atribución, y lo derivado se comparte con la misma licencia |
| **Modelos 3D de KiCad** (CC-BY-SA 4.0) | Componentes estándar modelados a partir de datasheets | Hay que convertir de STEP a glTF con herramientas externas. Formatos y catálogo exactos **(a confirmar)**. Misma licencia |
| **Datasheets** (TowerPro, Kingbright, ATX) | Medidas para modelar SG90, LED, resistencia y conector | Algunos datos con dudas (§11) |
| **Modelo del brazo** (MakerWorld) | El diseño real | La licencia del autor no está confirmada: **no redistribuir el archivo**. Hacer una versión simplificada propia |

**Propuesta: una maqueta técnica generada por código** (three.js, 1 unidad = 1 mm)
- **Placa Arduino:** un script lee el `.brd` oficial y genera un JSON chico (contorno, agujeros y componentes principales con su posición). La página arma la placa con eso. **Uno y Mega intercambiables.**
- **SG90, LED, resistencia, conector ATX** y, más adelante, **potenciómetro y display**: modelos paramétricos con las medidas de sus fichas.
- **Brazo:** versión simplificada con los 2 ejes reales (20° a 160°, 40°/s). Se mueve con el simulador de gestos de §7.2.
- **Interacción:**
  - girar y acercar la vista;
  - clic en una pieza → su ficha técnica;
  - una regla en mm;
  - vista «explotada» para ver cómo se conecta todo.
- **Carga diferida:** three.js (r187 es la última publicada en GitHub) se descarga solo al llegar a esta sección.
- **Ampliable:** cada pieza es un módulo que devuelve un objeto 3D. Cambiar más adelante una pieza generada por un modelo real (glTF) no toca el resto.

**Complejidad:** **media**. Lo más trabajoso es el script que lee el `.brd` y el modelado paramétrico de 5 o 6 piezas. **Importar modelos CAD reales** (de STEP a glTF), con texturas y detalle fotográfico, sí es complejo: herramientas externas, archivos pesados y licencias por revisar. Por eso **queda para una etapa posterior**.

**Conclusión:** el 3D a escala real **es viable en esta etapa** con piezas generadas a partir del CAD oficial y de las fichas técnicas. Los modelos fotorrealistas importados, más adelante.

---

## 11. Datos a confirmar

**Respuestas del 10/11/2026** (ya aplicadas a la página):
- **Servos:** SG90 de TowerPro, alimentados a 5 V. La corriente no se publica: la infografía dice que no figura en la ficha.
- **Fuente ATX:** el cable verde (PS_ON#) va con un puente a GND, así que la fuente arranca al enchufarla. No se detalla nada más; la seguridad eléctrica queda en un aviso breve.
- **Tipografía:** una sola para todo el sitio, Space Grotesk (Google Fonts): grotesca geométrica de aire técnico y muy legible. El código y los mensajes siguen en monoespaciada.
- **Créditos:** enlaces a LinkedIn (https://www.linkedin.com/in/lucianofritschy/) y a GitHub (https://github.com/luabfr).

Preguntas originales:

1. **SG90:** ¿son los clásicos analógicos (carcasa azul translúcida)? La ficha de TowerPro que pude leer es la de la versión digital. Además, la misma página da dos pesos (9 g y 0,019 kg).
2. **Corriente de los SG90:** no figura en la ficha. ¿La medimos con un multímetro, o la infografía dice «no figura en la ficha» y explica por qué igual hace falta la fuente?
3. **Fuente ATX:**
   - ¿tu conector es de 20 o de 24 pines?
   - ¿cómo la encendés: el cable verde a GND con un interruptor o con un puente?
   - ¿tiene fusible?
   - Los colores solo los verifiqué en una fuente secundaria.
4. **Auto-reset al abrir el puerto serie:** no pude leer la página oficial que lo documenta.
5. **Pines del Timer1 en el Uno** (9 y 10): el código oficial confirma el timer, pero no nombra los pines.
6. **Tipografía de títulos:** ¿la del sitio, o una propia para la infografía?
7. **Firma del portfolio:** ¿querés tu nombre o un enlace (por ejemplo, LinkedIn) en los créditos de esta página?

---

## Fuentes consultadas (10/11/2026)

- Arduino UNO R3: https://docs.arduino.cc/hardware/uno-rev3/ · ficha A000066 · CAD A000066 (Eagle, CC-BY-SA 4.0)
- Arduino Mega 2560 Rev3: https://docs.arduino.cc/hardware/mega-2560/ · ficha A000067 · CAD A000067 (Eagle, CC-BY-SA 4.0)
- Librería Servo: https://github.com/arduino-libraries/Servo (`src/Servo.h`, `src/avr/ServoTimers.h`)
- TowerPro SG90: https://www.towerpro.com.tw/product/sg90-7/
- Conector ATX: https://en.wikipedia.org/wiki/ATX (secundaria)
- LED Kingbright WP7113ID: https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf
- EMQX Cloud: https://www.emqx.com/en/pricing · https://docs.emqx.com/en/cloud/latest/create/restriction.html
- VDO.Ninja: https://docs.vdo.ninja/
- KiCad: https://www.kicad.org/libraries/license/ · https://gitlab.com/kicad/libraries/kicad-packages3D
- three.js: https://github.com/mrdoob/three.js/releases
- Código del proyecto: `js/*.js`, `emisor.html`, `receptor.html`, `arduino/*/*.ino`, `README.md`
