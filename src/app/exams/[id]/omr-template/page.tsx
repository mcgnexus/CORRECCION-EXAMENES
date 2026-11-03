"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { ExamWorkflowNav } from "@/components/exam-workflow-nav";

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
type ObjectiveQuestion = { questionId: string; number: number; type: string };

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
  const [templateEtag, setTemplateEtag] = useState<string | null>(null);
  const [templateState, setTemplateState] = useState<string | null>(null);
  const [approvedTemplate, setApprovedTemplate] = useState<{ templateId: string; updatedAt: string } | null>(null);
  const [calibrateAgain, setCalibrateAgain] = useState(false);
  const [objectiveQuestionIds, setObjectiveQuestionIds] = useState<string[]>([]);
  const [sourceReady, setSourceReady] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const effectiveRotation = rotation + fineRotation;

  useEffect(() => {
    fetch(`/api/exams/${params.id}/omr-template`).then(async (response) => {
      const payload = await response.json() as { data?: Array<{ templateId: string; state: string; updatedAt: string }> };
      const approved = payload.data?.filter((template) => template.state === "approved").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (approved) setApprovedTemplate({ templateId: approved.templateId, updatedAt: approved.updatedAt });
    }).catch(() => undefined);
  }, [params.id]);

  useEffect(() => {
    fetch(`/api/exams/${params.id}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { data?: { activeRevisionId?: string } };
      if (!response.ok || !payload.data?.activeRevisionId) return;
      const [solutionsResponse, pagesResponse] = await Promise.all([fetch(`/api/exams/${params.id}/revisions/${payload.data.activeRevisionId}/solutions`, { cache: "no-store" }), fetch(`/api/exams/${params.id}/pages`, { cache: "no-store" })]);
      const solutions = await solutionsResponse.json() as { data?: { revision?: { pagesManifestEtag: string }; questions?: ObjectiveQuestion[]; answerKey?: { status?: string; decisions?: Record<string, { sectionId?: string }> } } };
      if (!solutionsResponse.ok || !solutions.data) return;
      setSourceReady(Boolean(solutions.data.answerKey?.status === "approved" && solutions.data.revision?.pagesManifestEtag === pagesResponse.headers.get("etag")));
      setObjectiveQuestionIds((solutions.data.questions ?? [])
        .filter((question) => ["single_choice", "multiple_choice"].includes(question.type) && solutions.data!.answerKey?.decisions?.[question.questionId]?.sectionId === "test")
        .sort((a, b) => a.number - b.number)
        .map((question) => question.questionId));
    }).catch(() => undefined);
  }, [params.id]);

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
    if (!sourceReady) {
      setMessage("SOURCE_NOT_READY: La fuente actual no tiene un solucionario IA aprobado y vigente. Actualiza y aprueba las respuestas en la pantalla 2 antes de guardar la plantilla.");
      return;
    }
    const anchorsNormalized = manualAnchors.length === 4 ? manualAnchors : result?.anchorsNormalized;
    const columns = result?.columns ?? [];
    const rows = result?.rows ?? [];
    if (!anchorsNormalized || anchorsNormalized.length !== 4 || columns.length % 4 !== 0 || rows.length === 0) {
      setMessage("Faltan anclas o rejilla válida antes de guardar.");
      return;
    }
    setBusy(true);
    const groups = columns.length / 4;
    const mappedQuestionCount = groups * rows.length;
    if (mappedQuestionCount !== objectiveQuestionIds.length) {
      setBusy(false);
      setMessage(`La rejilla cubre ${mappedQuestionCount} preguntas, pero el solucionario aprobado tiene ${objectiveQuestionIds.length} preguntas OMR. Ajusta la rejilla antes de guardar.`);
      return;
    }
    const bubbles = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
        for (let group = 0; group < groups; group += 1) {
          const x = columns[group * 4 + optionIndex];
          const y = rows[rowIndex];
          bubbles.push({
            questionId: objectiveQuestionIds[group * rows.length + rowIndex],
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
    const payload = await response.json() as { data?: { templateId: string }; error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo guardar la plantilla."}`); return; }
    setTemplateId(payload.data.templateId);
    setTemplateEtag(response.headers.get("etag"));
    setTemplateState("draft");
    setMessage("Plantilla guardada en borrador. Apruébala cuando la hayas probado.");
  }

  async function approveTemplate() {
    if (!templateId || !templateEtag) return;
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/omr-template/${templateId}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin },
      body: JSON.stringify({ expectedEtag: templateEtag }),
    });
    const payload = await response.json() as { data?: { state: string }; error?: { message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data) { setMessage(payload.error?.message ?? "No se pudo aprobar la plantilla."); return; }
    setTemplateState(payload.data.state);
    setApprovedTemplate({ templateId: templateId!, updatedAt: new Date().toISOString() });
    setTemplateEtag(response.headers.get("etag") ?? templateEtag);
    setMessage("Plantilla aprobada. Ya puedes crear el lote de corrección.");
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
        <ExamWorkflowNav current={3} links={[
          { stage: 1, title: "Examen", href: `/exams/${params.id}`, enabled: true },
          { stage: 2, title: "Respuestas IA", href: `/exams/${params.id}/answers`, enabled: true },
          { stage: 3, title: "Plantilla OMR", href: `/exams/${params.id}/omr-template`, enabled: true },
          { stage: 4, title: "Alumnos", href: `/exams/${params.id}/students`, enabled: Boolean(approvedTemplate && sourceReady) },
          { stage: 5, title: "Comparar", href: `/exams/${params.id}/students`, enabled: false },
          { stage: 6, title: "Calificar", href: `/exams/${params.id}/students`, enabled: false },
        ]} />
        <p className="intro">Calibra una hoja en blanco para este examen. El formato aprobado se usa para todas las entregas nuevas; las plantillas históricas siguen vinculadas a sus lotes.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {approvedTemplate && !calibrateAgain ? <section className="panel">
          <h2>Plantilla OMR aprobada</h2>
          <p>{approvedTemplate.templateId} · actualizada {new Date(approvedTemplate.updatedAt).toLocaleString("es-ES")}</p>
          {!sourceReady ? <p className="notice" role="status">SOURCE_NOT_READY: La fuente actual necesita un solucionario IA aprobado. <a href={`/exams/${params.id}/answers`}>Actualizar respuestas en la pantalla 2</a>.</p> : null}
          <div className="actions"><a className="button" aria-disabled={!sourceReady} href={sourceReady ? `/exams/${params.id}/students` : undefined} onClick={(event) => { if (!sourceReady) event.preventDefault(); }}>Siguiente: respuestas de alumnos</a><button className="button secondary" type="button" onClick={() => { if (window.confirm("Recalibrar crea una configuración nueva y puede exigir repetir la plantilla para los lotes siguientes. ¿Continuar?")) setCalibrateAgain(true); }}>Recalibrar formato</button></div>
        </section> : null}
        {templateId ? <p className="notice">Plantilla: {templateId} — estado: {templateState ?? "desconocido"}</p> : null}
        {!approvedTemplate || calibrateAgain ? <>
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
          <p className="intro">Preguntas objetivas del solucionario: {objectiveQuestionIds.length}. La plantilla se vincula a IDs estables, no a números aproximados.</p>
          <div className="actions">
            <button className="button" type="button" disabled={!imageBase64 || busy} onClick={analyze}>{busy ? "Analizando..." : "Analizar hoja"}</button>
            <button className="button secondary" type="button" disabled={!result || manualAnchors.length === 0} onClick={() => { setManualAnchors([]); setNextAnchor(0); }}>Reiniciar anclas</button>
            <button className="button" type="button" disabled={busy || !result || !sourceReady} onClick={saveTemplate}>Guardar plantilla</button>
            {!sourceReady ? <p className="notice" role="status">Falta aprobar las respuestas IA de la fuente actual. <a href={`/exams/${params.id}/answers`}>Resolver en la pantalla 2</a>.</p> : null}
            <button className="button secondary" type="button" disabled={busy || !templateId || templateState === "approved"} onClick={approveTemplate}>{templateState === "approved" ? "Plantilla aprobada" : "Aprobar plantilla"}</button>
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
        </> : null}
        {approvedTemplate && sourceReady ? <div className="actions"><a className="button" href={`/exams/${params.id}/students`}>Siguiente: respuestas de alumnos</a></div> : null}
      </section>
    </main>
  );
}
