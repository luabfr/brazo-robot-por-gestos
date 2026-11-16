// Genera assets/vista-previa.jpg: la imagen que muestran LinkedIn, WhatsApp y otras redes al compartir un enlace
// del sitio (la que piden las etiquetas og:image de cada página). Abre tools/vista-previa.html en un navegador
// headless y la guarda en JPG de 1200 × 630, el tamaño más común para estas vistas previas; se usa JPG porque no
// todas las redes aceptan WebP.
//
// La plantilla usa dos capturas de assets/capturas/: si cambian (node tools/capturas.mjs), conviene correr esto
// de nuevo. Uso: node tools/vista-previa.mjs   (requisitos: los de tools/capturas.mjs; internet para la fuente)

import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, sleep, findBrowser, startServer, launchBrowser, openPage } from "./capturas.mjs";

var WIDTH = 1200;
var HEIGHT = 630;
var JPEG_QUALITY = 85;
var OUTPUT = join(ROOT, "assets", "vista-previa.jpg");
var FONT = '700 66px "Space Grotesk"';

function log(text) {
  console.log("[vista-previa] " + text);
}

async function main() {
  var served = await startServer({}, {});
  var browser = null;
  var page = null;
  try {
    browser = await launchBrowser(findBrowser(), "vista-previa", null);
    page = await openPage(browser, served.base + "/tools/vista-previa.html", { label: "vista previa" });
    await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

    // Antes de la foto: las capturas cargadas (si falta una, se corta acá) y la fuente del sitio
    await page.waitFor("[...document.images].every((img) => img.complete && img.naturalWidth > 0)", "cargar las capturas de assets/capturas/", 15000);
    // La plantilla no tiene scripts: "lista" llega antes que la hoja de Google Fonts. Se espera la carga completa
    // (incluye las hojas de estilo) para que la consulta de la fuente no dé un falso aviso
    await page.waitFor("document.readyState === 'complete'", "cargar la hoja de la fuente", 20000).catch(function () {});
    var hasFont = await page.evaluate("document.fonts.load(" + JSON.stringify(FONT) + ").then((faces) => faces.length > 0)").catch(function () {
      return false;
    });
    if (!hasFont) {
      log("aviso: no se pudo descargar Space Grotesk (¿sin internet?); la imagen sale con la fuente del sistema");
    }
    // El texto no puede salirse del cuadro (pasa si se alarga el título o la bajada)
    var overflow = await page.evaluate("document.body.scrollHeight > " + HEIGHT + " || document.body.scrollWidth > " + WIDTH);
    if (overflow) {
      log("aviso: el contenido no entra en " + WIDTH + " × " + HEIGHT + "; revisar tools/vista-previa.html");
    }
    await sleep(300);

    var shot = await page.send("Page.captureScreenshot", {
      format: "jpeg", quality: JPEG_QUALITY,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 }
    });
    if (!shot.result || !shot.result.data) {
      throw new Error("El navegador no devolvió la imagen" + (shot.error ? ": " + shot.error.message : ""));
    }
    var buffer = Buffer.from(shot.result.data, "base64");
    await writeFile(OUTPUT, buffer);
    log("assets/vista-previa.jpg (" + WIDTH + " × " + HEIGHT + ", " + Math.round(buffer.length / 1024) + " KB)");
  } finally {
    if (page) {
      page.close();
    }
    if (browser) {
      browser.child.kill();
    }
    served.server.close();
    if (browser) {
      // En Windows el perfil puede quedar bloqueado un instante después de cerrar el navegador
      await sleep(500);
      await rm(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(function () {});
    }
  }
}

main().catch(function (error) {
  console.error("[vista-previa] No se pudo generar: " + error.message);
  process.exitCode = 1;
});
