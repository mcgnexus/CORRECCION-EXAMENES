"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";

type CalibrateResponse = {
  processedImage?: string;
  rectifiedImage?: string | null;
  imageSize?: [number, number];
  anchors?: Array<{ cx: number; cy: number }>;
  anchorsNormalized?: Array<[number, number]>;
  columns?: number[];
  rows?: number[];
  detection?: string;
};

const ANCHOR_LABELS = ["Sup-izq", "Sup-der", "Inf-der", "Inf-izq"];
const OPTIONS = ["A", "B", "C", "D"];

export default function OmrTemplatePage() {
  const params = useParams<{ id: string }>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectifiedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectifiedImageRef = useRef<HTMLImageElement | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [fineRotation, setFineRotation] = useState(0);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [threshold, setThreshold] = useState(0.3);
  const [margin, setMargin] = useState(0.1);
  const [expectedRows, setExpectedRows] = useState(25);
  const [result, setResult] = useState<CalibrateResponse | null>(null);
  const [manualAnchors, setManualAnchors] = useState<Array<[number, number]>>([]);
  const [nextAnchor, setNextAnchor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const effectiveRotation = rotation + fineRotation;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.complete) return;
    const scale = Math.min(1, 900 / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const anchorsNormalized = manualAnchors.length === 4 ? manualAnchors : result?.anchorsNormalized ?? [];
    context.lineWidth = 2;
    anchorsNormalized.forEach(([x, y], index) => {
      const px = x * canvas.width;
      const py = y * canvas.height;
      context.strokeStyle = "#0d6b65";
      context.strokeRect(px - 12, py - 12, 24, 24);
      context.fillStyle = "#0d6b65";
      context.font = "bold 13px monospace";
      context.fillText(String(index + 1), px + 15, py - 15);
    });
    if (manualAnchors.length < 4) {
      context.fillStyle = "#8b5b16";
      context.font = "bold 13px monospace";
      context.fillText(`Clic para fijar ${ANCHOR_LABELS[nextAnchor] ?? "ancla"}`, 12, canvas.height - 12);
    }
  }, [manualAnchors, nextAnchor, result]);

  useEffect(() => {
    if (!result?.processedImage) return;
    const image = new Image();
    image.onload = () => { imageRef.current = image; draw(); };
    image.src = `data:image/jpeg;base64,${result.processedImage}`;
  }, [result, draw]);

  useEffect(() => { draw(); }, [draw]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    setImageBase64(btoa(binary));
    setResult(null);
    setManualAnchors([]);
    setNextAnchor(0);
    setMessage(null);
  }

  async function analyze() {
    if (!imageBase64) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/exams/${params.id}/omr-calibrate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin },
      body: JSON.stringify({ imageBase64, rotation: effectiveRotation, brightness, contrast, expectedRows }),
    });
    const payload = await response.json() as CalibrateResponse & { error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "El análisis falló."); return; }
    setResult(payload);
    setManualAnchors([]);
    setNextAnchor(0);
    if (payload.detection === "ok") setMessage("Detección correcta: 4 anclas y rejilla completas.");
    else if (payload.detection === "grid_mismatch") setMessage("Anclas detectadas, pero la rejilla no coincide con lo esperado. Ajusta rotación/brillo/contraste o fija las anclas manualmente.");
    else setMessage("No se detectaron las 4 anclas. Ajusta los parámetros o fíjalas con clic.");
  }

  function handleCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!result?.processedImage || manualAnchors.length >= 4 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const next = [...manualAnchors, [Number(x.toFixed(5)), Number(y.toFixed(5))] as [number, number]];
    setManualAnchors(next);
    setNextAnchor(next.length);
  }

  async function saveTemplate() {
    const anchorsNormalized = manualAnchors.length === 4 ? manualAnchors : result?.anchorsNormalized;
    const columns = result?.columns ?? [];
    const rows = result?.rows ?? [];
    if (!anchorsNormalized || anchorsNormalized.length !== 4 || columns.length % 4 !== 0 || rows.length === 0) {
      setMessage("Faltan anclas o rejilla válida antes de guardar.");
      return;
    }
    setBusy(true);
    const groups = columns.length / 4;
    const bubbles = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
        for (let group = 0; group < groups; group += 1) {
          const x = columns[group * 4 + optionIndex];
          const y = rows[rowIndex];
          bubbles.push({
            questionId: String(1 + group * rows.length + rowIndex),
            optionId: OPTIONS[optionIndex],
            x: Number(Math.max(0, x / 1000 - 0.016).toFixed(4)),
            y: Number(Math.max(0, y / 930 - 0.018).toFixed(4)),
            width: 0.032,
            height: 0.036,
          });
        }
      }
    }
    const response = await fetch(`/api/exams/${params.id}/omr-template`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin },
      body: JSON.stringify({
        canvasWidth: 1000,
        canvasHeight: 930,
        sourceAnchors: anchorsNormalized,
        targetAnchors: [[0, 0], [1, 0], [1, 1], [0, 1]],
        bubbles,
        preprocess: { rotation: effectiveRotation, brightness, contrast },
        threshold,
        margin,
        algorithmVersion: "omr-1-manual",
      }),
    });
    const payload = await response.json() as { data?: { templateId: string }; error?: { message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data) { setMessage(payload.error?.message ?? "No se pudo guardar la plantilla."); return; }
    setTemplateId(payload.data.templateId);
    setMessage("Plantilla guardada en borrador. Apruébala cuando la hayas probado.");
  }

  const drawRectified = useCallback(() => {
    const canvas = rectifiedCanvasRef.current;
    const image = rectifiedImageRef.current;
    if (!canvas || !image || !image.complete) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0);
    context.fillStyle = "rgba(13,107,101,.85)";
    for (const x of result?.columns ?? []) {
      for (const y of result?.rows ?? []) {
        context.beginPath();
        context.arc(x / 1000 * canvas.width, y / 930 * canvas.height, 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, [result]);

  useEffect(() => {
    if (!result?.rectifiedImage) return;
    const image = new Image();
    image.onload = () => { rectifiedImageRef.current = image; drawRectified(); };
    image.src = `data:image/jpeg;base64,${result.rectifiedImage}`;
  }, [result, drawRectified]);

  useEffect(() => { drawRectified(); }, [drawRectified]);

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href={`/exams/${params.id}`}>Volver al examen</a><span className="status">Calibración OMR</span></header>
      <section>
        <h1>Calibrar la hoja de respuestas.</h1>
        <p className="intro">Sube una foto de la hoja en blanco, ajusta rotación, brillo y contraste hasta que se detecten las 4 anclas y la rejilla. Fija anclas con clic si la detección falla.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {templateId ? <p className="notice">Plantilla creada: {templateId}</p> : null}
        <div className="form">
          <label className="label">Foto de la hoja en blanco<input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} /></label>
          <div className="calibration-grid">
            <label className="label">Rotación 90°<select className="input" value={rotation} onChange={(event) => setRotation(Number(event.target.value))}><option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label>
            <label className="label">Rotación fina ({effectiveRotation}°)<input type="range" min={-10} max={10} step={0.5} value={fineRotation} onChange={(event) => setFineRotation(Number(event.target.value))} /></label>
            <label className="label">Brillo ×{brightness.toFixed(2)}<input type="range" min={0.5} max={1.5} step={0.05} value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
            <label className="label">Contraste ×{contrast.toFixed(2)}<input type="range" min={0.5} max={1.5} step={0.05} value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /></label>
            <label className="label">Umbral de marca<input type="range" min={0.15} max={0.6} step={0.05} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label>
            <label className="label">Margen ambigüedad<input type="range" min={0.04} max={0.2} step={0.01} value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></label>
            <label className="label">Filas por columna<input className="input" type="number" min={1} max={200} value={expectedRows} onChange={(event) => setExpectedRows(Number(event.target.value))} /></label>
          </div>
          <div className="actions">
            <button className="button" type="button" disabled={!imageBase64 || busy} onClick={analyze}>{busy ? "Analizando..." : "Analizar hoja"}</button>
            <button className="button secondary" type="button" disabled={!result || manualAnchors.length === 0} onClick={() => { setManualAnchors([]); setNextAnchor(0); }}>Reiniciar anclas</button>
            <button className="button" type="button" disabled={busy || !result} onClick={saveTemplate}>Guardar plantilla</button>
          </div>
        </div>
        {result?.processedImage ? (
          <div className="detail-grid">
            <div className="panel">
              <h2>Hoja ajustada (clic = ancla {manualAnchors.length < 4 ? ANCHOR_LABELS[nextAnchor] : "completo"})</h2>
              <canvas ref={canvasRef} className="calibration-canvas" onClick={handleCanvasClick} />
            </div>
            <div className="panel">
              <h2>Rejilla detectada</h2>
              {result.rectifiedImage ? <canvas ref={rectifiedCanvasRef} className="calibration-rectified" /> : <p className="intro">Sin rectificación.</p>}
              <p className="intro">Anclas: {result.anchors?.length ?? 0} · Columnas: {result.columns?.length ?? 0} · Filas: {result.rows?.length ?? 0}</p>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
