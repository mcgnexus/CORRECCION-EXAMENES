# Informe de Fase 2

## Alcance implementado

- Modelos versionados para revisiones de examen, propuestas estructurales, soluciones, ejecuciones de proveedor y answer key.
- `deepseek-flash` configurado para visión; Gemini usa `gemini-3.1-flash-lite`.
- Backoff limitado para 429/5xx, `Retry-After`, hashes de entrada y salidas crudas inmutables.
- Workflow de extracción por página: texto local/PDF, imagen, Gemini y DeepSeek independientes.
- Workflow de solucionario por pregunta con contexto visual separado y búsqueda Gemini condicionada.
- Rutas CAS para extraer, revisar estructura, iniciar solucionario, editar answer key y aprobar.
- UI de revisión de propuestas y selección de estructura.
- Aprobación bloqueada si hay incidencias, falta de decisiones humanas o revisión incompleta.

## Verificación Preview

- Sonda Gemini con imagen sintética: `probe=ok`, `visionProbe=ok`.
- Sonda DeepSeek `deepseek-flash` con imagen sintética: `probe=ok`, `visionProbe=ok`.
- Gemini Search: HTTP `429`; el error queda registrado y la propuesta no se presenta como respaldada por fuentes.
- Extracción dual de revisión `2d999172-6166-41cf-ace1-b45e6fc9733c`: Workflow `completed`, dos propuestas persistidas, ambas `text_and_visual`.
- Imagen sintética sin contenido: ambos modelos devolvieron cero preguntas y dudas explícitas; no se inventaron elementos.
- Solucionario dual: Workflow `completed` con cero propuestas porque no existían preguntas, sin falsos resultados.
- Answer key creado en `draft`; aprobación permanece bloqueada sin decisiones humanas.

## Limitaciones conocidas

- La búsqueda Gemini requiere backoff y cuota disponible para obtener fuentes verificables.
- Las fuentes se normalizan en la propuesta, pero la pantalla completa de evidencia y edición de rúbrica continúa siendo el siguiente refinamiento.
- El fixture usado para Preview no contiene un examen legible; debe probarse con un PDF sintético con preguntas, opciones y una figura antes de declarar precisión funcional.

## Próximo hito

Fase 3: plantilla OMR calibrada, lectura de entregas, transcripción de manuscritos y evaluación humana por rúbrica. No se deben cerrar notas hasta medir ambigüedad/ilegibilidad y conservar la revisión humana.
