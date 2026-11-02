# Gate final de aceptacion de Fase 5

Estado: **NOT RUN**

El informe reproducible se genera ejecutando `npm run gate:phase5` contra un
Preview temporal. El harness requiere proveedores reales, un owner aislado y
un `BLOB_READ_WRITE_TOKEN` administrativo para purgar únicamente el prefijo
del gate.

## Ejecucion

```powershell
$env:GATE_URL="https://<preview>.vercel.app"
$env:GATE_LOGIN="gate-phase5-<timestamp>"
$env:GATE_OWNER=$env:GATE_LOGIN
$env:GATE_PASSWORD="<credencial-temporal>"
$env:GATE_CRON_SECRET="<secret-del-preview>"
$env:BLOB_READ_WRITE_TOKEN="<token-privado>"
npm run gate:phase5
```

El script escribe `metrics.json` en `.gate/` y actualiza este informe con el
resultado `PASS` o `FAIL`. No se deben guardar valores de secretos, cookies,
imágenes ni datos personales en Git.

## Criterios

- Preview temporal y owner aislado.
- Proveedores Gemini y DeepSeek reales sin errores inesperados.
- Fixture sintético de 30 páginas, sin PII.
- Idempotencia, ETag/CAS, cancelación y reanudación sin duplicados.
- Revisión humana antes de cerrar snapshots y batch.
- CSV, XLSX y PDF descargables, neutrales frente a fórmulas y sin raw provider output.
- Cron protegido y retención corta eliminada.
- Cero blobs restantes bajo el prefijo aislado tras la purga administrativa.

## Resultado

Pendiente de ejecución en Preview.
