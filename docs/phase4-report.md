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
- Suite actual: 33 pruebas.
- No se usan fotografías reales ni datos personales para esta fase.

## Pendiente de Preview

- Ejecutar el flujo con el fixture sintético en Preview usando assets privados y proveedores configurados.
- Verificar reintentos/idempotencia de workflows y limpieza de crops, outputs y manifiestos derivados.
- Validar experiencia visual del editor de regiones con páginas PDF e imágenes rotadas.
