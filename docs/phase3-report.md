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

## Pendiente de Preview

- Flujo end-to-end con hoja sintética impresa/fotografiada (rotación, sombras, resolución baja) y métricas documentadas.
- Sugerencia OCR local de identidad (motor pendiente de empaquetar); actualmente identidad manual/confirmada.
- Editor visual de plantilla (overlay de anclas/burbujas); la plantilla se crea vía API.

## Próximo hito

Métricas de Puerta A con fixtures reales y, después, Puerta B (manuscritos, fórmulas y dibujos con visión dual).
