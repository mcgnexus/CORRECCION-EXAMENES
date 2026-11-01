# Corrector de exámenes

Base inicial de una aplicación privada para preparar solucionarios y revisar notas de exámenes con trazabilidad. La aplicación está diseñada para Vercel y no publica notas ni expone documentos.

## Estado actual

- Scaffold Next.js 15 + TypeScript con pantalla inicial sin resultados simulados.
- Esquemas Zod versionados para exámenes, rúbricas, políticas y observaciones.
- Puntuación determinista para test y secciones ponderadas.
- Sesión de propietario sellada con `iron-session` y validación de contraseña `scrypt`.
- Repositorio de exámenes con manifiesto JSON, hashes y control ETag/CAS.
- Ingesta documental con assets validados, páginas, visor autenticado y borrado seguro.
- Workflow SDK integrado con una sonda de dos pasos reanudable.
- Extracción y solucionario dual Gemini/DeepSeek con revisión humana y CAS.
- API mínima para sesión, exámenes y comprobación de capacidades.
- Pruebas deterministas de puntuación y concurrencia del repositorio.

La subida Blob privada está implementada con `@vercel/blob` 2.x, pero debe verificarse en Preview contra un store real antes de usar datos reales. Los proveedores de IA siguen pendientes de prueba. No se debe usar `BLOB_STORAGE_MODE=memory` con datos reales: solo sirve para pruebas efímeras del proceso Node.

## Requisitos

- Node.js 24 o compatible con la versión fijada por el lockfile.
- npm.
- Para Preview: un store Blob privado compatible, claves de Gemini y DeepSeek y credenciales de administrador configuradas solo en variables de entorno de servidor.

## Desarrollo

```bash
npm install
npm run dev
```

Validaciones:

```bash
npm run typecheck
npm test
npm run build
```

## Configuración

Copiar los nombres de `.env.example` al entorno local o de Vercel sin incluir secretos en el repositorio. `ADMIN_PASSWORD_HASH` usa el formato `scrypt$salt$hex`. El hash debe generarse fuera del código y nunca guardarse en texto claro.

`BLOB_STORAGE_MODE=memory` activa una implementación efímera exclusivamente para pruebas locales. El modo por defecto rechaza operaciones hasta verificar el acceso privado real de Blob.

## API inicial

- `POST /api/auth/login` y `POST /api/auth/logout`.
- `GET /api/exams` y `POST /api/exams`.
- `GET /api/exams/:id` y `PATCH /api/exams/:id` con `expectedEtag`.
- `GET /api/exams/:id/assets`, `/pages` y `PATCH /pages` con revisión CAS.
- `POST /api/exams/:id/assets/authorize`, `GET /api/assets/:id/metadata`, `GET /api/assets/:id/content` y `DELETE /api/assets/:id`.
- `POST /api/settings/check-providers`.
- `POST /api/phase0/providers`, sonda interna sintética de Gemini/DeepSeek y búsqueda.
- `POST /api/uploads/authorize`, token privado limitado por propietario, MIME y tamaño.

Todas las mutaciones comprueban sesión, origen y esquemas. Las respuestas de error contienen código estable, `requestId` y si el error es reintentable.

## Próximo hito

Consultar `docs/phase0-report.md`, `docs/phase1-report.md` y `docs/phase2-report.md` para los resultados de Preview. El siguiente hito es OMR y corrección de entregas; no cerrar notas sin revisión humana.
