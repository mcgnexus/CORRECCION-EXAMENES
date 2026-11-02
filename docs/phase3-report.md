# Informe de Fase 3 (Puerta A)

## Alcance implementado

- Esquemas versionados: plantilla OMR, lote, entrega, lectura OMR, decisión manual y snapshot de puntuación.
- Repositorios Blob con CAS/ETag para plantillas, lotes, entregas, lecturas y snapshots.
- Workflow OMR por entrega: carga de páginas privadas, llamada autenticada a Python (`asset_bytes`), persistencia de lecturas e incidencias.
- Python OMR ampliado a modo interno autenticado con threshold/margin configurables.
- API: crear plantilla, editar/aprobar plantilla, crear lote (exige plantilla aprobada), registrar entregas, iniciar OMR, confirmar identidad, decisiones de revisión y puntuar con solucionario aprobado.
- Puntuación determinista reutilizando `calculateTestScore`: `ambiguous`/`multiple`/`unreadable` y lecturas fallidas bloquean; decisión manual tiene prioridad.
- UI de lote: entregas, identidad, inicio OMR y puntuación con snapshot.

## Verificación local

- 27 pruebas correctas, incluidas 5 nuevas de Fase 3 (puntuación, bloqueos, decisión manual, contratos de plantilla y snapshot).
- `npm run typecheck`, `npm run lint`, `npm run build` y `py_compile` correctos.

## Verificación con hoja real (Puerta A)

Se calibró y leyó una foto real de la hoja de respuestas UAX (Modelo A, 50 preguntas, corrección +1/−0,33/0):

- Herramienta de calibración: `scripts/calibrate_omr_sheet.py` detecta las 4 anclas cuadradas, rectifica al lienzo 1000×930 y detecta 200 burbujas (50×4) con HoughCircles.
- Plantilla generada: `fixtures/omr-template-uax-answer-sheet.json` (anclas, 200 burbujas normalizadas, threshold 0,30, margin 0,10, algoritmo `omr-1-uax`).
- Lectura real de la foto: 47/50 filas `single` con las marcas esperadas; 3 filas (14, 23, 25) clasificadas `multiple` y enviadas a revisión humana con sus dos candidatos — el sistema no adivina.
- Prueba de ida y vuelta: `scripts/test_template_roundtrip.py` renderiza una hoja sintética desde la plantilla (48 marcas + 2 blancos) y la relee sin fallos.
- Corrección de motor: Otsu degenera con interiores unimodales; `_bubble_fill` ahora combina Otsu con umbral fijo (`<100`) conservando el máximo, sin alterar los resultados de la foto real.

La foto usada para esta verificación permanece sin versionar (contiene datos personales del alumno); la plantilla y las herramientas sí se publican.

## Pendiente de Preview

- Flujo end-to-end en Preview con esta plantilla y la foto subida como asset privado.
- Sugerencia OCR local de identidad (motor pendiente de empaquetar); actualmente identidad manual/confirmada.
- Editor visual de plantilla (overlay de anclas/burbujas); la plantilla se crea vía API o script de calibración.

## Próximo hito

Métricas de Puerta A con fixtures reales y, después, Puerta B (manuscritos, fórmulas y dibujos con visión dual).
