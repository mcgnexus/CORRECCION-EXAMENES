# Informe de Fase 0

## Estado

La base local compila y tiene pruebas deterministas, pero la puerta de salida de Preview todavía no está superada. Este informe registra lo que ya se ha comprobado localmente y los bloqueos que impiden afirmar que el despliegue técnico está listo.

## Comprobaciones locales

Entorno observado: Node `v24.19.0`, npm `11.17.0`, Next `15.5.28`, `@vercel/blob` `2.8.2`, Python `3.14.0`, OpenCV `4.13.0` y NumPy `2.4.1`. El build local tarda aproximadamente 3–6 segundos sin caché completa; no es una medición de Vercel.

| Área | Resultado actual | Evidencia |
|---|---|---|
| Next.js/TypeScript | OK | `npm run build` y `npm run typecheck` |
| Puntuación determinista | OK | `tests/scoring.test.ts` |
| CAS de manifiestos | OK en memoria | `tests/repository.test.ts` |
| API inicial | Compila | Rutas App Router bajo `src/app/api` |
| Blob privado en Preview | OK | Preview creó/listó manifiestos y la URL privada sin autorización devolvió `403` |
| Python/OpenCV | Pendiente | No se ha desplegado función Python |
| PDF con figuras | Pendiente | Falta seleccionar y probar biblioteca de servidor |
| Gemini multimodal | Pendiente | Falta credencial y prueba aislada |
| DeepSeek | Pendiente | Falta credencial y comprobar visión real |
| Gemini Search | Pendiente | Falta prueba de búsqueda y registro de fuentes |
| Workflow reanudable | Implementado; Preview pendiente | Workflow SDK compila, registra dos pasos y expone `/api/phase0/workflow` |

## Estado Blob

La dependencia está fijada a la rama `@vercel/blob` 2.8.x, cuya API declara acceso `private`, lecturas autenticadas y ETag para escrituras condicionales. `VercelPrivateBlobStore` usa esas operaciones y `POST /api/uploads/authorize` genera tokens de cliente de duración limitada con prefijo de propietario, MIME permitido y tamaño máximo. El almacén conectado es `corrector-phase0` (`store_U5X2SzWofn5NAxON`), vacío al iniciar la fase.

`MemoryBlobStore` solo permite probar CAS en proceso y no es almacenamiento de negocio. `UnavailablePrivateBlobStore` sigue siendo el comportamiento seguro si no existe token.

## Próximas mediciones requeridas en Preview

Registrar para cada prueba: commit, runtime, versión de dependencia, región, duración, memoria, tamaño de entrada/salida, número de reintentos y resultado. Consultar los límites del plan antes de fijar concurrencia o tamaño de lote.

1. Subir JPEG/PNG/PDF a Blob privado, leer con autorización y demostrar que una URL sin autorización no funciona.
2. Ejecutar Python/OpenCV con una hoja sintética, rectificarla y devolver JSON OMR. Si el empaquetado falla, probar OpenCV.js/WASM aislado.
3. Extraer texto nativo y renderizar un PDF con figuras sin Poppler.
4. Ejecutar una llamada multimodal real de Gemini y una llamada de DeepSeek; registrar modelo exacto y capacidades.
5. Ejecutar Gemini con búsqueda habilitada y conservar fuentes vinculadas a afirmaciones.
6. Fallar el segundo paso de un Workflow y comprobar que el primero no se repite ni pierde su resultado.

## Resultados de Preview

- Deployment inicial: compiló Next.js 15.5.28 y Python 3.12 con OpenCV 4.14.0.
- `GET /api/omr`: `200`, indicando OpenCV disponible.
- `POST /api/omr` sin secreto: `403 SERVICE_AUTH_REQUIRED`.
- Login `ACPL`: `200`; `GET /api/exams`: `200` con Blob privado.
- Creación de examen sintético: `201`; repetición con la misma clave: `200` y `replayed: true`.
- Token de upload: emitido con prefijo `owners/ACPL/` y límites de MIME/tamaño.
- Lectura directa del manifiesto privado sin autorización: `403`.
- PDF sintético en Preview: extracción de texto y renderizado PNG correctos (`600x450`, `2172` bytes).
- Gemini y DeepSeek: las claves solo existen en Production; Preview no puede probar proveedores hasta copiar/configurar secretos y modelos en ese entorno.

## Regla de seguridad

No usar datos reales de alumnos, publicar notas ni enviar documentos a terceros como parte de estas pruebas. Las pruebas de proveedor deben usar fixtures sintéticos hasta revisar condiciones de tratamiento y región.
