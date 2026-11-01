# Informe de Fase 1

## Alcance implementado

- Upload privado directo con pathname derivado de `ownerId`, `examId` y `assetId`.
- Finalización explícita tras `upload()`; el callback Blob permanece como respaldo idempotente.
- Validación de MIME real, hash SHA-256, tamaño máximo de 25 MB, dimensiones, HEIC, PDF cifrado/activo y máximo de 30 páginas.
- Manifiestos `Asset` inmutables por objeto y `DocumentPagesManifest` con CAS/ETag.
- Páginas generadas por asset, orden, rotación, crop normalizado y grupos manuales.
- Streaming autenticado desde Blob privado sin URLs públicas.
- Borrado con estados `deleting/deleted`, eliminación de contenido y retirada de páginas/grupos relacionados.
- Pantalla `/exams/:id` con subida, progreso, visor, giro, recorte, reordenación, agrupación y guardado.

## Verificación local

- `npm test`: 21 pruebas correctas.
- `npm run typecheck`: correcto.
- `npm run lint`: correcto.
- `npm run build`: correcto.
- `python -m py_compile python/omr.py api/omr.py`: correcto.

## Verificación Preview

En el deployment de Fase 1 se comprobó con un PNG sintético:

1. Login del propietario `ACPL`.
2. Token de upload privado limitado a `owners/ACPL/exams/.../assets/...`.
3. Upload físico al store `corrector-phase0`.
4. Finalización `POST /api/exams/:id/assets/complete`.
5. Asset `validated` con MIME, tamaño, dimensiones y SHA-256.
6. Página `order: 0` creada automáticamente.
7. Streaming mediante `/api/assets/:id/content`.
8. Borrado con estado `deleted`.

El objeto sintético usado durante la prueba fue eliminado después de la verificación.

## Próxima fase

Fase 2: extracción y revisión de estructura del examen, figuras, modelos A/B, propuestas Gemini/DeepSeek, búsqueda con fuentes, rúbrica y aprobación versionada. Requiere configurar claves y modelos de ambos proveedores en Preview antes de ejecutar llamadas reales.
