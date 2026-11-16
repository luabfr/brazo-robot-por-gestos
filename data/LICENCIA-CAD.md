# Datos de las placas Arduino (banco 3D)

Los archivos `placa-uno-r3.json` y `placa-mega-2560.json` describen el contorno, los agujeros de montaje y la posición y el tamaño en planta de cada componente de las placas. Los usa el banco de trabajo 3D de la infografía (`arquitectura.html`, módulo `js/arquitectura-3d.js`).

## Origen

Se derivan de los archivos CAD oficiales de Arduino, en formato Eagle:

| Archivo | Placa | Fuente |
|---|---|---|
| `placa-uno-r3.json` | Arduino UNO R3 (A000066) | `UNO-TH_Rev3e.brd`, de https://docs.arduino.cc/hardware/uno-rev3/ |
| `placa-mega-2560.json` | Arduino Mega 2560 Rev3 (A000067) | `MEGA2560_Rev3e.brd`, de https://docs.arduino.cc/hardware/mega-2560/ |

© Arduino. Diseño de hardware bajo licencia [Creative Commons Atribución-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.es).

## Cambios

- Se extrajo solo lo necesario para la maqueta 3D: el contorno de la placa (capa 20, *Dimension*), los agujeros de montaje y, de cada componente, su nombre, valor, encapsulado, centro y tamaño en planta.
- Se clasificó cada componente por tipo (conector USB, header, chip, capacitor, etc.) y se agregó la altura de los headers según su valor.
- Las coordenadas se pasaron a milímetros con el origen en la esquina inferior izquierda de la placa.

La conversión la hace `tools/eagle-a-json.mjs`:

```
node tools/eagle-a-json.mjs UNO-TH_Rev3e.brd data/placa-uno-r3.json "Arduino UNO R3 (A000066), CAD oficial en Eagle"
node tools/eagle-a-json.mjs MEGA2560_Rev3e.brd data/placa-mega-2560.json "Arduino Mega 2560 Rev3 (A000067), CAD oficial en Eagle"
```

## Licencia de estos datos

Como obra derivada, estos dos archivos JSON se comparten bajo la misma licencia, **CC BY-SA 4.0**. El resto del repositorio tiene su propia licencia.
