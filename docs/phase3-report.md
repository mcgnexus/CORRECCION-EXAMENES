# Informe de Fase 3 (Puerta A)

## Alcance implementado

- Esquemas versionados: plantilla OMR, lote, entrega, lectura OMR, decisión manual y snapshot de puntuación.
- Repositorios Blob con CAS/ETag para plantillas, lotes, entregas, lecturas y snapshots.
- Workflow OMR por entrega: carga de páginas privadas, llamada autenticada a Python (`asset_bytes`), persistencia de lecturas e incidencias.
- Python OMR ampliado a modo interno autenticado con threshold/margin configurables.
- API: crear/consultar plantilla, editar/aprobar plantilla, crear lote con política de scoring explícita y solucionario aprobado, registrar entregas, iniciar OMR, consultar lecturas, confirmar identidad, decisiones de revisión, puntuar y cerrar con CAS.
- Puntuación determinista reutilizando `calculateTestScore`: `ambiguous`/`multiple`/`unreadable` y lecturas fallidas bloquean; decisión manual tiene prioridad.
- UI de lote: entregas, identidad, inicio OMR, cola de incidencias con resolución manual, puntuación y cierre con snapshot.

## Verificación local

- 28 pruebas correctas, incluidas las de Fase 3 para política explícita, puntuación, bloqueos, decisión manual, contratos de plantilla y snapshot.
- `npm run typecheck`, `npm run lint`, `npm run build` y `py_compile` correctos.

## Calibración manual (UI)

Ruta `/exams/:id/omr-template`, accesible desde el detalle del examen:

- Subida de la foto de la hoja en blanco.
- Rotación en pasos de 90° más ajuste fino de −10° a +10°.
- Brillo y contraste (0,5×–1,5×), umbral de marca y margen de ambigüedad.
- `POST /api/exams/:id/omr-calibrate` (sesión + `INTERNAL_SERVICE_SECRET`) aplica
  el preprocesamiento en el servicio Python y devuelve:
  imagen ajustada, imagen rectificada, 4 anclas, columnas y filas detectadas.
- Previsualización doble: hoja ajustada con anclas numeradas (clic para fijar
  manualmente en orden sup-izq → sup-der → inf-der → inf-izq) y hoja
  rectificada con la rejilla detectada superpuesta.
- Estados de detección honestos: `ok`, `grid_mismatch`, `anchors_not_found`.
  Nunca se guarda una plantilla con rejilla inconsistente.
- Los ajustes se guardan en la plantilla (`preprocess`) y se reaplican en cada
  lectura real, de modo que las coordenadas calibradas siguen siendo válidas.

### Servicio interno en Vercel

La auto-llamada del servidor a su propio despliegue falla (`TypeError: fetch
failed`) por DNS interno y protección de despliegue. Configuración aplicada:

- `OMR_SERVICE_URL=https://correccion-examenes.vercel.app` (host estable).
- `VERCEL_AUTOMATION_BYPASS_SECRET` con un secreto de bypass de automatización.
- `vercel project protection enable --protection-bypass`.
- El código actual debe estar desplegado en producción, porque el host estable
  sirve el código de producción, no el del Preview.

Verificado en Preview: `POST /api/exams/:id/omr-calibrate` devuelve
`detection: ok`, 4 anclas, 8 columnas, 25 filas y ambas imágenes
(ajustada 127 KB, rectificada 112 KB en base64); la plantilla se guarda con
200 burbujas y `preprocess {rotation: 2, brightness: 1.15, contrast: 1.1}`.

Correcciones necesarias encontradas al validar el flujo:

- El ordenamiento de esquinas usaba un conjunto de booleanos, por lo que
  `len()==1` descartaba todas las combinaciones de anclas.
- La homografía de calibración ordenaba el origen pero no el destino.
- Las anclas en el borde exacto se recortaban al rotar; ahora los candidatos
  se aceptan con 4–6 vértices y el lienzo se expande con borde blanco.
- `_bubble_fill` combinaba Otsu con umbral fijo para interiores unimodales.

## Verificación con hoja real (Puerta A)

Se calibró y leyó una foto real de la hoja de respuestas UAX (Modelo A, 50 preguntas, corrección +1/−0,33/0):

- Herramienta de calibración: `scripts/calibrate_omr_sheet.py` detecta las 4 anclas cuadradas, rectifica al lienzo 1000×930 y detecta 200 burbujas (50×4) con HoughCircles.
- Plantilla generada: `fixtures/omr-template-uax-answer-sheet.json` (anclas, 200 burbujas normalizadas, threshold 0,30, margin 0,10, algoritmo `omr-1-uax`).
- Lectura real de la foto: 47/50 filas `single` con las marcas esperadas; 3 filas (14, 23, 25) clasificadas `multiple` y enviadas a revisión humana con sus dos candidatos — el sistema no adivina.
- Prueba de calibración: `scripts/test_calibrate.py` renderiza una hoja con marco
  de anclas, la somete a rotación 2°, brillo 1,15 y contraste 1,1, y comprueba
  que la calibración detecta 4 anclas, 8 columnas y 25 filas y que la plantilla
  resultante lee 48 marcas correctas y 2 blancos sin fallos.
- Calibración de la foto real: con parámetros por defecto detecta las 4 anclas
  exactas y 8 columnas; con ajustes que degradan la imagen reporta
  `grid_mismatch` o `anchors_not_found` en lugar de generar una plantilla mala.
- Prueba de ida y vuelta: `scripts/test_template_roundtrip.py` renderiza una hoja sintética desde la plantilla (48 marcas + 2 blancos) y la relee sin fallos.
- Corrección de motor: Otsu degenera con interiores unimodales; `_bubble_fill` ahora combina Otsu con umbral fijo (`<100`) conservando el máximo, sin alterar los resultados de la foto real.

La foto usada para esta verificación permanece sin versionar (contiene datos personales del alumno); la plantilla y las herramientas sí se publican.

## Pendiente de Preview

- Flujo end-to-end en Preview con esta plantilla y la foto subida como asset privado.
- Validación del cierre en Preview con política sintética, auditoría y borrado posterior de todos los assets privados.
- Sugerencia OCR local de identidad (motor pendiente de empaquetar); actualmente identidad manual/confirmada.
- Editor visual de plantilla (overlay de anclas/burbujas); la plantilla se crea vía API o script de calibración.

## Siguiente hito

Puerta B inicial para manuscritos `short_text`/`essay` está documentada en
`docs/phase4-report.md`. Fórmulas, cálculos, dibujos y visión DeepSeek quedan
para una iteración posterior.
