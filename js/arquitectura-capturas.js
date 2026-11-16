// «Así se ve»: capturas de las páginas reales en el panel de cada componente de la infografía.
// Las imágenes y la posición de las marcas salen de tools/capturas.mjs (assets/capturas/capturas.json);
// los textos, de CAPTURES en js/arquitectura-contenido.js. Cada captura lleva marcas numeradas que se
// corresponden con una lista de explicaciones; al pasar por un ítem se resalta su lugar en la imagen.
// "Ampliar" y "Ver la página completa" abren un visor (un <dialog>, que ya maneja el foco y Escape).

import { CAPTURES, CAPTURE_PAGES } from "./arquitectura-contenido.js";

var DATA_URL = "assets/capturas/capturas.json";
var IMAGE_BASE = "assets/capturas/";

var dataPromise = null;
var dialog = null;
var dialogTitle = null;
var dialogBody = null;
var dialogOpener = null;

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

// El JSON se pide una sola vez, la primera vez que hace falta. Si no está (o falla), no se muestran capturas
function loadData() {
  if (!dataPromise) {
    dataPromise = fetch(DATA_URL).then(function (response) {
      if (!response.ok) {
        throw new Error("No se pudo leer " + DATA_URL + " (" + response.status + ")");
      }
      return response.json();
    }).catch(function (error) {
      console.warn("[capturas]", error.message);
      return null;
    });
  }
  return dataPromise;
}

function percent(value) {
  return value + "%";
}

// Una captura con sus marcas y su lista. large: versión del visor (sin botones)
function buildShot(capture, image, large) {
  var figure = el("figure", "shot" + (large ? " shot-large" : ""));
  var frame = el("div", "shot-frame");
  frame.style.aspectRatio = image.width + " / " + image.height;
  var picture = el("img");
  picture.src = IMAGE_BASE + image.file;
  picture.width = image.width;
  picture.height = image.height;
  picture.alt = capture.alt;
  picture.loading = "lazy";
  picture.decoding = "async";
  frame.appendChild(picture);

  var notes = el("ol", "shot-notes");
  var number = 0;
  capture.notes.forEach(function (note) {
    var spot = image.hotspots[note.spot];
    if (!spot) {
      return; // El elemento no se vio en la captura: la explicación sin marca no se muestra
    }
    number++;
    var x = spot[0];
    var y = spot[1];
    var w = spot[2];
    var h = spot[3];
    if (w > 0 && h > 0) {
      var outline = el("span", "shot-outline");
      outline.dataset.spot = note.spot;
      outline.style.left = percent(x);
      outline.style.top = percent(y);
      outline.style.width = percent(w);
      outline.style.height = percent(h);
      outline.setAttribute("aria-hidden", "true");
      frame.appendChild(outline);
    }
    // La marca va en la esquina superior izquierda del elemento, que suele estar vacía (no tapa texto).
    // Si la marca es un punto, va centrada justo ahí
    var marker = el("span", w > 0 ? "shot-marker is-corner" : "shot-marker", String(number));
    marker.dataset.spot = note.spot;
    marker.style.left = percent(x);
    marker.style.top = percent(y);
    marker.setAttribute("aria-hidden", "true");
    frame.appendChild(marker);

    var item = el("li");
    item.dataset.spot = note.spot;
    item.append(el("span", "shot-number", String(number)), el("span", "shot-text", note.text));
    notes.appendChild(item);
  });

  var caption = el("figcaption", "shot-caption");
  caption.append(el("strong", "", capture.title), el("span", "", " · captura con datos de ejemplo"));
  figure.append(frame, caption, notes);

  // Pasar por una explicación (o por su marca) resalta las dos. Va después de armar la figura: antes,
  // querySelectorAll no encontraría las marcas ni la lista
  var highlight = function (spotId, isOn) {
    figure.querySelectorAll('[data-spot="' + spotId + '"]').forEach(function (node) {
      node.classList.toggle("is-active", isOn);
    });
  };
  figure.querySelectorAll(".shot-marker, .shot-notes li").forEach(function (node) {
    node.addEventListener("pointerenter", function () {
      highlight(node.dataset.spot, true);
    });
    node.addEventListener("pointerleave", function () {
      highlight(node.dataset.spot, false);
    });
  });
  return figure;
}

// ================= Visor ampliado =================

function ensureDialog() {
  if (dialog) {
    return;
  }
  dialog = el("dialog", "shot-dialog");
  dialog.setAttribute("aria-labelledby", "shotDialogTitle");
  var header = el("div", "shot-dialog-header");
  dialogTitle = el("h2", "shot-dialog-title");
  dialogTitle.id = "shotDialogTitle";
  dialogTitle.tabIndex = -1;
  var close = el("button", "arch-panel-close");
  close.type = "button";
  close.setAttribute("aria-label", "Cerrar la captura");
  close.title = "Cerrar (Esc)";
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';
  close.addEventListener("click", function () {
    dialog.close();
  });
  header.append(dialogTitle, close);
  dialogBody = el("div", "shot-dialog-body");
  dialog.append(header, dialogBody);
  // Un clic en el fondo oscuro (fuera del contenido) también cierra
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", function () {
    dialogBody.textContent = "";
    if (dialogOpener && document.contains(dialogOpener)) {
      dialogOpener.focus({ preventScroll: true });
    }
    dialogOpener = null;
  });
  document.getElementById("archApp").appendChild(dialog);
}

function openDialog(title, content, opener) {
  ensureDialog();
  dialogOpener = opener;
  dialogTitle.textContent = title;
  dialogBody.textContent = "";
  dialogBody.appendChild(content);
  if (!dialog.open) {
    dialog.showModal();
  }
  dialogTitle.focus({ preventScroll: true });
}

function fullPageView(pageId, image) {
  var figure = el("figure", "shot shot-large");
  var frame = el("div", "shot-frame");
  frame.style.aspectRatio = image.width + " / " + image.height;
  var picture = el("img");
  picture.src = IMAGE_BASE + image.file;
  picture.width = image.width;
  picture.height = image.height;
  picture.alt = "Captura completa de " + CAPTURE_PAGES[pageId].toLowerCase() + ", con datos de ejemplo";
  frame.appendChild(picture);
  var caption = el("figcaption", "shot-caption");
  caption.append(el("strong", "", CAPTURE_PAGES[pageId]), el("span", "", " · captura con datos de ejemplo"));
  figure.append(frame, caption);
  return figure;
}

// ================= API =================

export function hasCaptures(nodeId) {
  return Boolean(CAPTURES[nodeId]);
}

export function isCaptureOpen() {
  return Boolean(dialog && dialog.open);
}

// Sección «Así se ve» para el panel de un componente. Devuelve el contenedor enseguida y lo completa cuando
// llega el JSON; si no hay capturas (o no cargan), el contenedor se elimina solo
export function buildCaptureSection(nodeId) {
  var container = el("div", "shot-list");
  loadData().then(function (data) {
    if (!data) {
      container.remove();
      return;
    }
    var shown = 0;
    CAPTURES[nodeId].forEach(function (capture) {
      var image = data.images[capture.image];
      if (!image) {
        return;
      }
      shown++;
      var figure = buildShot(capture, image, false);
      var actions = el("div", "shot-actions");
      var zoom = el("button", "shot-action", "Ampliar");
      zoom.type = "button";
      zoom.addEventListener("click", function () {
        openDialog(capture.title, buildShot(capture, image, true), zoom);
      });
      actions.appendChild(zoom);
      var page = capture.page && data.images[capture.page];
      if (page) {
        var full = el("button", "shot-action", "Ver la página completa");
        full.type = "button";
        full.addEventListener("click", function () {
          openDialog(CAPTURE_PAGES[capture.page], fullPageView(capture.page, page), full);
        });
        actions.appendChild(full);
      }
      // Un clic en la imagen también amplía
      figure.querySelector(".shot-frame").addEventListener("click", function () {
        zoom.click();
      });
      figure.appendChild(actions);
      container.appendChild(figure);
    });
    var section = container.closest("details");
    if (!shown) {
      (section || container).remove();
    }
  });
  return container;
}
