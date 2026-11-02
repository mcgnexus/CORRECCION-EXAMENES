# Informe de Fase 4 (Puerta B inicial)

## Alcance implementado

- Regiones de respuesta abiertas delimitadas manualmente sobre la vista previa de la página.
- Recortes PNG privados derivados en servidor, con ownership, hash, origen y revisión CAS.
- Workflow separado de transcripción Gemini y evaluación académica dual Gemini/DeepSeek.
- Transcripciones append-only con literal, normalización y corrección docente versionadas.
- La transcripción se confirma antes de evaluar; cualquier corrección invalida evaluaciones y snapshots dependientes.
- Evaluación por criterios de la rúbrica aprobada, con evidencias, incidencias y validación de rangos/sumas.
- Decisión humana explícita por pregunta: proveedor o puntuación manual con motivo; no hay promedio automático.
- Snapshot mixto compatible con el score OMR existente y cierre sujeto a dependencias exactas.

## Limitaciones intencionadas

- La primera entrega cubre `short_text` y `essay`.
- Fórmulas, cálculos deterministas, dibujos y segmentación automática quedan para la siguiente iteración.
- La capacidad visual de DeepSeek no está verificada; las transcripciones inciertas requieren revisión visual/manual.
- La identidad no se envía a proveedores. Puede transcribirse antes de confirmarla, pero evaluar, puntuar y cerrar exige identidad confirmada.

## Fixture y verificación

- Fixture sintético: `fixtures/phase4-open-responses.json`.
- Casos cubiertos: lectura clara concordante, transcripción incierta corregida y discrepancia con override humano.
- `npm run typecheck`, `npm run lint`, `npm run build` y `npm test -- --run` correctos.
- Suite actual: 34 pruebas.
- No se usan fotografías reales ni datos personales para esta fase.

## Gate E2E en Preview

Ejecutado sobre un Preview temporal del mismo commit, con propietario aislado
`gate-phase4`, credenciales temporales y una imagen sintética sin PII. Los
Preview y todos los blobs del propietario se eliminaron al finalizar.

Resultado observado:

- 3 regiones manuales y 3 crops privados generados en servidor.
- 3 transcripciones Gemini propuestas; se conservaron también las revisiones
  previas, por eso el listado acumuló 6 transcripciones.
- 6 evaluaciones completadas (3 preguntas × Gemini/DeepSeek).
- Decisiones humanas cubriendo los tres caminos: elegir Gemini, elegir DeepSeek
  y puntuación manual con motivo.
- Snapshot mixto: 5/6 puntos abiertos, nota 8.33, 3 preguntas abiertas y sin
  bloqueos.
- Cierre de entrega y snapshot correcto; un segundo cierre con ETag obsoleto fue
  rechazado con `409`.
- Limpieza verificada: 0 blobs restantes bajo `owners/gate-phase4/`.

## Correcciones surgidas del gate

- Vercel Blob devuelve ETags débiles (`W/"..."`) en lectura, mientras `put`
  exige el ETag fuerte en `ifMatch`. El adaptador ahora normaliza ambos lados;
  sin esto fallaban las actualizaciones CAS en producción.
- Los errores de proveedor se pierden al cruzar el límite de un step del
  workflow. Los steps ahora devuelven un fallo estructurado con código, mensaje,
  HTTP y `retryable`, y se registran en el `ProviderRun`.
- La salida de los modelos se normaliza antes de validarla (números como texto,
  spans como cadenas, `maxPoints` tomado de la rúbrica).
- Se añadieron reintentos acotados con espera durable para fallos recuperables
  (por ejemplo Gemini HTTP 503) en transcripción y evaluación.
- Los errores no controlados de API se registran con `requestId` para diagnóstico
  sin exponer datos sensibles.

## Pendiente

- Validar la experiencia visual del editor de regiones con páginas PDF e
  imágenes rotadas en escritorio y móvil.
- Probar cálculos, dibujos y visión DeepSeek en una iteración posterior.
