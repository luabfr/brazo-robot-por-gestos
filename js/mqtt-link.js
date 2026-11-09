// Conexión MQTT sobre WebSocket seguro (wss) para el emisor y el receptor.
// Carga MQTT.js desde el CDN, valida los datos del formulario, arma los nombres de los topics y traduce los errores.

// Versión fijada: una versión nueva de la librería podría cambiar la API sin aviso
var MQTT_VERSION = "5.16.1";
var MQTT_MODULE_URL = "https://cdn.jsdelivr.net/npm/mqtt@" + MQTT_VERSION + "/dist/mqtt.esm.js";

var CONNECT_TIMEOUT_MS = 10000;
var RECONNECT_PERIOD_MS = 3000;
var SUBSCRIBE_FAILURE = 0x80; // En la respuesta a una suscripción, un código ≥ 0x80 significa que el broker la rechazó

// Rechazos al conectar: códigos de MQTT 5 (134, 135) y de MQTT 3.1.1 (4, 5). Reintentar no sirve de nada.
var AUTH_ERRORS = {
  4: "usuario o contraseña incorrectos",
  5: "el usuario no tiene permiso para conectarse",
  134: "usuario o contraseña incorrectos",
  135: "el usuario no tiene permiso para conectarse"
};

// Sala y alias: minúsculas, números y guiones (hasta 24). Excluye los comodines de MQTT (+ y #) y la barra (/),
// así nadie puede leer ni escribir en los topics de otra sala o de otro alumno cambiando su nombre
export var NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

export function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

// Todos los topics de una sala. Ver la tabla completa en el README
export function buildTopics(root, room) {
  var base = root + "/" + room;
  return {
    studentStatus: function (alias) {
      return base + "/alumnos/" + alias + "/estado";
    },
    studentHand: function (alias) {
      return base + "/alumnos/" + alias + "/mano";
    },
    allStudentStatus: base + "/alumnos/+/estado",
    control: base + "/control",
    leds: base + "/leds",
    receiver: base + "/receptor"
  };
}

// Revisa la dirección del broker antes de conectar. Devuelve { url } o { error } con un mensaje accionable
export function checkBrokerUrl(value) {
  var text = String(value || "").trim();
  if (text === "" || text.indexOf("<") !== -1) {
    return { error: "Falta la dirección del broker: complétala en js/config.js (o en «Servidor») con la de tu deployment de EMQX." };
  }

  var url;
  try {
    url = new URL(text);
  } catch (error) {
    return { error: "La dirección del broker no es válida: " + text };
  }

  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    return { error: "La dirección del broker tiene que empezar con wss:// (MQTT sobre WebSocket seguro)." };
  }
  // Una página https no puede abrir conexiones sin cifrar: el navegador las bloquea
  if (url.protocol === "ws:" && window.location.protocol === "https:") {
    return { error: "Desde una página https solo se puede usar wss:// (conexión cifrada)." };
  }
  return { url: url.href };
}

var mqttModulePromise = null;

// import() dinámico en vez de un import estático: si el CDN no responde se puede mostrar el error en la página
function loadMqtt() {
  if (!mqttModulePromise) {
    mqttModulePromise = import(MQTT_MODULE_URL)
      .then(function (module) {
        return module.default;
      })
      .catch(function (error) {
        mqttModulePromise = null; // Permite reintentar con el siguiente clic
        throw error;
      });
  }
  return mqttModulePromise;
}

function randomId() {
  var bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.prototype.map.call(bytes, function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function describeError(error) {
  var code = error && error.code;
  if (AUTH_ERRORS[code]) {
    return "El broker rechazó la conexión: " + AUTH_ERRORS[code] + ".";
  }
  return (error && error.message) || String(error);
}

// handlers.log(level, message): registro de eventos
// handlers.onStateChange(state, detail): "disconnected" | "connecting" | "connected" | "reconnecting" | "error"
// handlers.onConnect(): se llama en cada conexión, también al reconectar (para volver a anunciarse y suscribirse)
// handlers.onMessage(topic, text): cada mensaje recibido, ya convertido a texto
export function createMqttLink(handlers) {
  var client = null;
  var state = "disconnected";
  var isEnding = false; // true si el cierre lo pidió el usuario (no hay que reconectar ni avisar como error)
  var decoder = new TextDecoder();

  function setState(next, detail) {
    state = next;
    handlers.onStateChange(next, detail || "");
  }

  // settings: { url, username, password, clientIdPrefix, keepaliveSeconds, will: { topic, payload, qos, retain } }
  async function connect(settings) {
    if (client || state === "connecting") {
      return;
    }
    isEnding = false;
    setState("connecting");

    var mqtt;
    try {
      mqtt = await loadMqtt();
    } catch (error) {
      setState("error", "No se pudo descargar MQTT.js desde cdn.jsdelivr.net. Revisa la conexión a internet.");
      return;
    }

    try {
      client = mqtt.connect(settings.url, {
        // Un identificador distinto por pestaña: si dos usaran el mismo, el broker desconectaría a la anterior
        clientId: settings.clientIdPrefix + "-" + randomId(),
        username: settings.username || undefined,
        password: settings.password || undefined,
        protocolVersion: 5,
        clean: true,
        keepalive: settings.keepaliveSeconds,
        connectTimeout: CONNECT_TIMEOUT_MS,
        reconnectPeriod: RECONNECT_PERIOD_MS,
        will: settings.will
      });
    } catch (error) {
      client = null;
      setState("error", "No se pudo iniciar la conexión: " + describeError(error));
      return;
    }

    var current = client;

    current.on("connect", function () {
      setState("connected");
      handlers.onConnect();
    });

    current.on("reconnect", function () {
      if (!isEnding) {
        setState("reconnecting", "Reconectando con el broker…");
      }
    });

    current.on("close", function () {
      if (!isEnding && state === "connected") {
        setState("reconnecting", "Se perdió la conexión con el broker; reconectando…");
      }
    });

    current.on("error", function (error) {
      if (AUTH_ERRORS[error && error.code]) {
        // Con credenciales incorrectas no tiene sentido reintentar cada pocos segundos
        isEnding = true;
        client = null;
        current.end(true);
        setState("error", describeError(error));
        return;
      }
      handlers.log("warn", "MQTT: " + describeError(error));
    });

    current.on("message", function (topic, payload) {
      handlers.onMessage(topic, decoder.decode(payload));
    });
  }

  // Devuelve true si se publicó. options: { qos, retain }
  async function publish(topic, text, options) {
    if (!client || state !== "connected") {
      return false;
    }
    try {
      await client.publishAsync(topic, text, options || { qos: 0 });
      return true;
    } catch (error) {
      handlers.log("warn", "No se pudo publicar en " + topic + ": " + describeError(error));
      return false;
    }
  }

  // Devuelve true si el broker aceptó la suscripción
  async function subscribe(filter, qos) {
    if (!client) {
      return false;
    }
    try {
      var granted = await client.subscribeAsync(filter, { qos: qos || 0 });
      var isRejected = (granted || []).some(function (grant) {
        return grant.qos >= SUBSCRIBE_FAILURE;
      });
      if (isRejected) {
        handlers.log("error", "El broker rechazó la suscripción a " + filter + ": revisa los permisos del usuario en EMQX.");
        return false;
      }
      return true;
    } catch (error) {
      handlers.log("error", "No se pudo suscribir a " + filter + ": " + describeError(error));
      return false;
    }
  }

  async function unsubscribe(filter) {
    if (!client) {
      return;
    }
    try {
      await client.unsubscribeAsync(filter);
    } catch (error) {
      handlers.log("warn", "No se pudo cancelar la suscripción a " + filter + ": " + describeError(error));
    }
  }

  // beforeEnd: tarea opcional que se ejecuta con la conexión todavía abierta (p. ej. publicar "offline").
  // Un cierre ordenado no dispara el Last Will, por eso el aviso se publica a mano antes de cerrar.
  async function disconnect(beforeEnd) {
    if (!client) {
      setState("disconnected");
      return;
    }
    var current = client;
    if (beforeEnd && state === "connected") {
      try {
        await beforeEnd();
      } catch (error) {
        // Se cierra igual: si el aviso no salió, el broker no publica el Last Will y el estado puede quedar viejo
        handlers.log("warn", "No se pudo avisar la desconexión: " + describeError(error));
      }
    }
    isEnding = true;
    client = null;
    try {
      await current.endAsync();
    } catch (error) {
      // La conexión ya estaba cerrada: no hay nada más que liberar
    }
    setState("disconnected");
  }

  return {
    connect: connect,
    disconnect: disconnect,
    publish: publish,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    isConnected: function () {
      return state === "connected";
    },
    isActive: function () {
      return client !== null;
    }
  };
}
