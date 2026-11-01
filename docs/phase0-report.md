# Informe de Fase 0

## Estado

La base local compila y la infraestructura principal ya fue verificada en Preview. Gemini/DeepSeek siguen pendientes porque sus secretos y modelos no están configurados en Preview.

## Comprobaciones locales

Entorno observado: Node `v24.19.0`, npm `11.17.0`, Next `15.5.28`, `@vercel/blob` `2.8.2`, Python `3.14.0`, OpenCV `4.13.0` y NumPy `2.4.1`. El build local tarda aproximadamente 3–6 segundos sin caché completa; no es una medición de Vercel.

| Área | Resultado actual | Evidencia |
|---|---|---|
| Next.js/TypeScript | OK | `npm run build` y `npm run typecheck` |
| Puntuación determinista | OK | `tests/scoring.test.ts` |
| CAS de manifiestos | OK en memoria | `tests/repository.test.ts` |
| API inicial | Compila | Rutas App Router bajo `src/app/api` |
| Blob privado en Preview | OK | Preview creó/listó manifiestos y la URL privada sin autorización devolvió `403` |
| Python/OpenCV | OK | Preview respondió `4.14.0` y procesó una hoja sintética |
| PDF con figuras | OK | Preview extrajo texto y renderizó PNG sin Poppler |
| Gemini multimodal | Parcial | `gemini-3.1-flash-lite` responde JSON válido; falta prueba visual |
| DeepSeek | OK | `deepseek-chat` responde JSON válido |
| Gemini Search | Parcial | La llamada con herramienta de búsqueda devolvió HTTP 429; falta reintentar y registrar fuentes |
| Workflow reanudable | OK | Preview completó y falló el segundo paso de forma controlada |

## Estado Blob

La dependencia está fijada a la rama `@vercel/blob` 2.8.x, cuya API declara acceso `private`, lecturas autenticadas y ETag para escrituras condicionales. `VercelPrivateBlobStore` usa esas operaciones y `POST /api/uploads/authorize` genera tokens de cliente de duración limitada con prefijo de propietario, MIME permitido y tamaño máximo. El almacén conectado es `corrector-phase0` (`store_U5X2SzWofn5NAxON`).

`MemoryBlobStore` solo permite probar CAS en proceso y no es almacenamiento de negocio. `UnavailablePrivateBlobStore` sigue siendo el comportamiento seguro si no existe token.

## Mediciones ejecutadas en Preview

Registrar para cada prueba: commit, runtime, versión de dependencia, región, duración, memoria, tamaño de entrada/salida, número de reintentos y resultado. Consultar los límites del plan antes de fijar concurrencia o tamaño de lote.

1. Crear/listar un examen sintético, repetirlo con la misma clave y demostrar `replayed: true`.
2. Emitir token Blob limitado a `owners/ACPL/` y comprobar que la lectura directa sin autorización devuelve `403`.
3. Ejecutar Python/OpenCV con una hoja sintética, rectificarla y devolver JSON OMR.
4. Extraer texto nativo y renderizar un PDF con figuras sin Poppler.
5. Ejecutar Workflow normal y con fallo sintético; el primero terminó `completed` y el segundo `failed` en el segundo paso.
6. Consultar la sonda de proveedores; Gemini/DeepSeek quedaron `not_run` por falta de secretos/modelos en Preview.

## Resultados de Preview

- Deployment inicial: compiló Next.js 15.5.28 y Python 3.12 con OpenCV 4.14.0.
- `GET /api/omr`: `200`, indicando OpenCV disponible.
- `POST /api/omr` sin secreto: `403 SERVICE_AUTH_REQUIRED`.
- Login `ACPL`: `200`; `GET /api/exams`: `200` con Blob privado.
- Creación de examen sintético: `201`; repetición con la misma clave: `200` y `replayed: true`.
- Token de upload: emitido con prefijo `owners/ACPL/` y límites de MIME/tamaño.
- Lectura directa del manifiesto privado sin autorización: `403`.
- PDF sintético en Preview: extracción de texto y renderizado PNG correctos (`600x450`, `2172` bytes).
- Gemini y DeepSeek: ambos configurados y verificados en Preview. Gemini responde JSON válido; DeepSeek responde JSON válido. La búsqueda de Gemini devolvió HTTP 429 y debe reintentarse con backoff. Falta prueba visual de ambos modelos.

## Regla de seguridad

No usar datos reales de alumnos, publicar notas ni enviar documentos a terceros como parte de estas pruebas. Las pruebas de proveedor deben usar fixtures sintéticos hasta revisar condiciones de tratamiento y región.
