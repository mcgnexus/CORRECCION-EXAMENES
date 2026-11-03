# Plan: Flujo de corrección en seis pantallas

## Objetivo y decisiones

Convertir el flujo actual, repartido entre examen, solucionario, plantilla y un panel combinado de lote, en seis páginas secuenciales y diferenciadas. Se permite volver atrás; no se puede saltar una etapa incompleta. Cambiar una entrada invalida las etapas derivadas. Los lotes ya creados se conservan como histórico; un solucionario nuevo requiere un lote nuevo.

Decisiones confirmadas:

- Pantalla 1 prepara el examen: datos, carga de fuente y ordenar/girar/recortar páginas; no ejecuta IA.
- Pantalla 2 tiene botón explícito para iniciar IA. Reutiliza resultados existentes; regenerar requiere acción explícita y crea revisión nueva. El usuario revisa/corrige y aprueba las respuestas IA.
- Pantalla 3 calibra y aprueba una plantilla OMR fija por examen.
- Pantalla 4 crea el lote mediante botón explícito, admite carga múltiple y procesa cada alumno bajo demanda; permite confirmar OCR de identidad y respuestas OMR.
- Pantallas 4, 5 y 6 se recorren por alumno. Pantalla 5 compara, permite corregir la respuesta del alumno y exige confirmar. Pantalla 6 califica objetivas y abiertas, permite revisión humana y cierre.
- Tras calificar al último alumno, la pantalla 6 permite finalizar el lote y exportar.

## Implementación

1. **Navegación y progreso persistente**
   - Añadir navegación común con seis etapas, estado completado/pendiente y enlaces anterior/siguiente.
   - Derivar y validar las etapas en servidor con datos persistidos; refrescar la página no debe reiniciar el flujo ni permitir saltos.
   - Mantener rutas antiguas como redirecciones hacia la etapa equivalente cuando sea posible.

2. **Pantallas 1–3 por examen**
   - Mantener `/exams/[id]` como preparación de fuente; retirar de esa vista el inicio de autopilot y ofrecer «Siguiente: respuestas IA» solo con páginas listas.
   - Añadir una vista estable de respuestas IA para iniciar/reanudar autopilot, mostrar progreso, revisar/corregir el solucionario y aprobarlo. No crear una revisión nueva al reabrir una ya aprobada; regeneración explícita crea revisión nueva.
   - Mantener la calibración OMR como pantalla separada, mostrando la plantilla aprobada actual y sus acciones de editar/recalibrar.
   - Antes de continuar, validar que las preguntas de la plantilla se asignan de forma unívoca a las preguntas del solucionario; bloquear y mostrar diferencias concretas si los IDs/alias no cuadran.

3. **Pantalla 4: cola y preparación de respuestas**
   - Mantener la creación del lote como acción explícita dentro de esta etapa y eliminar el botón aislado de creación desde el solucionario.
   - Conservar subida múltiple y mostrar una cola por alumno.
   - Añadir procesamiento por entrega (OCR de nombre + OMR), con botón explícito, progreso y reintento individual; no forzar la ejecución de todo el lote.
   - Revisar/confirmar identidad y resolver filas OMR antes de avanzar a comparación.

4. **Pantalla 5: comparación por alumno**
   - Crear página dedicada con tabla pregunta, respuesta confirmada del alumno, respuesta aprobada del examen y resultado.
   - Permitir corregir la respuesta del alumno; guardar las correcciones como decisiones manuales y recalcular la comparación.
   - Persistir la confirmación vinculada al `answerKeyRevisionId` y a una huella de las lecturas/datos comparados. Si cambia una entrada, invalidar confirmación y puntuación dependiente.

5. **Pantalla 6: calificación y cierre**
   - Crear página dedicada con puntuación objetiva y el flujo existente de respuestas abiertas, evaluación IA, revisión/ajuste humano y confirmación de nota.
   - Exigir comparación vigente y confirmada antes de puntuar; al cambiar respuestas, impedir usar snapshots obsoletos.
   - Tras cerrar una entrega, ofrecer el siguiente alumno pendiente; al cerrar el último, mostrar resumen, finalizar lote y ofrecer exportación.

6. **Dependencias e histórico**
   - Conservar lotes cerrados y resultados asociados a sus revisiones de solucionario/plantilla; no reescribirlos al regenerar IA.
   - El lote nuevo queda vinculado a las revisiones vigentes. Una fuente modificada exige revisión IA nueva; un solucionario nuevo exige lote nuevo. Plantilla y respuestas de lotes anteriores permanecen auditables.
   - Añadir estado/campos de comparación confirmada al esquema de entrega (con valores opcionales/default para leer manifiestos existentes) y validar en los endpoints de transición, no solo en el cliente.

## Validación

- Pruebas de gates: no pasar de etapa sin sus requisitos; errores muestran código/mensaje y no dejan botones aparentemente inactivos.
- Flujo feliz completo: examen → IA aprobada → plantilla aprobada → crear lote → importar varios alumnos → procesar/confirmar un alumno → comparar/corregir/confirmar → calificar/cerrar → siguiente alumno → finalizar y exportar.
- Probar refresco/reentrada en cada etapa y navegación atrás.
- Probar invalidación al cambiar fuente, solucionario, plantilla o lectura; resultados/lotes históricos deben seguir accesibles con sus dependencias originales.
- Probar respuestas abiertas y objetivas, OMR ambiguo, OCR de identidad fallido, reintento y doble clic/idempotencia.
- Ejecutar suite, TypeScript y build; validar que las rutas/API y el despliegue Supabase mantienen privacidad y permisos.
