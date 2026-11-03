"use client";

import { uploadExamAsset } from "@/lib/supabase-upload-client";
import { ExamWorkflowNav } from "@/components/exam-workflow-nav";
import { useParams } from "next/navigation";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

type Exam = { examId: string; ownerId: string; title: string; subject: string; state: string; activeRevisionId?: string };
type Asset = { assetId: string; examId?: string; kind: string; state: string; mimeType: string; sizeBytes: number; pageCount?: number; pageNumber?: number };
type Page = { pageId: string; examId: string; ownerId: string; sourceAssetId: string; pageNumber: number; order: number; rotation: 0 | 90 | 180 | 270; crop?: { x: number; y: number; width: number; height: number }; groupId?: string };
type Group = { groupId: string; examId: string; ownerId: string; label: string; pageIds: string[]; studentLabel?: string };
type Manifest = { pages: Page[]; groups: Group[]; etag: string };

function formatSize(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }

export default function ExamDetailPage() {
  const params = useParams<{ id: string }>();
  const examId = params.id;
  const [exam, setExam] = useState<Exam | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [manifest, setManifest] = useState<Manifest>({ pages: [], groups: [], etag: "" });
  const [pagesDirty, setPagesDirty] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupLabel, setGroupLabel] = useState("Entrega");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [examResponse, assetsResponse, pagesResponse] = await Promise.all([fetch(`/api/exams/${examId}`), fetch(`/api/exams/${examId}/assets`), fetch(`/api/exams/${examId}/pages`)]);
    const examPayload = await examResponse.json() as { data?: Exam; error?: { message?: string } };
    const assetsPayload = await assetsResponse.json() as { data?: Asset[]; error?: { message?: string } };
    const pagesPayload = await pagesResponse.json() as { data?: Omit<Manifest, "etag">; error?: { message?: string } };
    if (!examResponse.ok || !assetsResponse.ok || !pagesResponse.ok) throw new Error(examPayload.error?.message ?? assetsPayload.error?.message ?? pagesPayload.error?.message ?? "No se pudo cargar el examen.");
    setExam(examPayload.data ?? null);
    setAssets(assetsPayload.data ?? []);
    setManifest({ pages: pagesPayload.data?.pages ?? [], groups: pagesPayload.data?.groups ?? [], etag: pagesResponse.headers.get("etag") ?? "" });
    setPagesDirty(false);
    setSelectedPageId((current) => current ?? pagesPayload.data?.pages?.[0]?.pageId ?? null);
  }, [examId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo cargar el examen.")).finally(() => setLoading(false)); }, [load]);

  const selectedPage = manifest.pages.find((page) => page.pageId === selectedPageId) ?? null;
  const selectedAsset = selectedPage ? assets.find((asset) => asset.assetId === selectedPage.sourceAssetId) : null;
  const orderedPages = useMemo(() => [...manifest.pages].sort((a, b) => a.order - b.order), [manifest.pages]);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!exam) return;
    const files = Array.from(event.target.files ?? []);
    for (const file of files) {
      const assetId = crypto.randomUUID();
      const pathname = `owners/${exam.ownerId}/exams/${exam.examId}/assets/${assetId}/original`;
      try {
        setProgress((current) => ({ ...current, [assetId]: 0 }));
        const uploaded = await uploadExamAsset({ pathname, file, authorizeUrl: `/api/exams/${exam.examId}/assets/authorize` });
        const completion = await fetch(`/api/exams/${exam.examId}/assets/complete`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ assetId, pathname: uploaded.pathname, contentType: file.type, purpose: "exam_source" }) });
        if (!completion.ok) throw new Error("La subida terminó, pero no pudo validarse el asset.");
        setProgress((current) => ({ ...current, [assetId]: 100 }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : `No se pudo subir ${file.name}.`);
      }
    }
    await load();
    event.target.value = "";
  }

  async function deleteAsset(asset: Asset) {
    if (!window.confirm(`¿Eliminar este documento (${asset.mimeType} · ${formatSize(asset.sizeBytes)}) y todas sus páginas? Esta acción no se puede deshacer.`)) return;
    setDeletingAssetId(asset.assetId);
    setMessage(null);
    try {
      const response = await fetch(`/api/assets/${asset.assetId}`, { method: "DELETE", headers: { origin: window.location.origin } });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "No se pudo eliminar el documento.");
      setSelectedPageId(null);
      await load();
      setMessage("Documento y páginas eliminados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar el documento.");
    } finally {
      setDeletingAssetId(null);
    }
  }

  function updatePage(pageId: string, patch: Partial<Page>) { setPagesDirty(true); setManifest((current) => ({ ...current, pages: current.pages.map((page) => page.pageId === pageId ? { ...page, ...patch } : page) })); }

  function movePage(direction: -1 | 1) {
    if (!selectedPage) return;
    const pages = [...orderedPages];
    const index = pages.findIndex((page) => page.pageId === selectedPage.pageId);
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    [pages[index], pages[target]] = [pages[target], pages[index]];
    setPagesDirty(true);
    setManifest((current) => ({ ...current, pages: pages.map((page, order) => ({ ...page, order })) }));
  }

  async function savePages() {
    const response = await fetch(`/api/exams/${examId}/pages`, { method: "PATCH", headers: { "content-type": "application/json", "origin": window.location.origin }, body: JSON.stringify({ expectedEtag: manifest.etag, pages: manifest.pages, groups: manifest.groups }) });
    const payload = await response.json() as { data?: Omit<Manifest, "etag">; error?: { message?: string } };
    if (!response.ok) {
      setMessage(response.status === 409 ? "Las páginas cambiaron en otra pestaña o proceso. Se han recargado." : payload.error?.message ?? "No se pudieron guardar las páginas.");
      if (response.status === 409) await load();
      return false;
    }
    setManifest({ pages: payload.data?.pages ?? [], groups: payload.data?.groups ?? [], etag: response.headers.get("etag") ?? manifest.etag });
    setPagesDirty(false);
    setMessage("Cambios guardados.");
    return true;
  }

  async function continueToAnswers() {
    if (!manifest.pages.length) return;
    if (await savePages()) window.location.href = `/exams/${examId}/answers`;
  }

  function createGroup() {
    if (selectedGroupIds.length === 0 || !exam) return;
    const group: Group = { groupId: crypto.randomUUID(), examId, ownerId: exam.ownerId, label: groupLabel || "Entrega", pageIds: selectedGroupIds };
    setManifest((current) => ({ ...current, groups: [...current.groups, group], pages: current.pages.map((page) => selectedGroupIds.includes(page.pageId) ? { ...page, groupId: group.groupId } : page) }));
    setPagesDirty(true);
    setSelectedGroupIds([]);
  }

  const previewUrl = selectedAsset ? `/api/assets/${selectedAsset.assetId}/content` : null;
  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href="/exams">Corrector de exámenes</a><span className="status">Ingesta documental</span></header>
      {loading ? <p className="intro">Cargando examen...</p> : exam ? <section>
        <h1>{exam.title}</h1>
        <p className="intro">{exam.subject}. Los originales permanecen privados; las transformaciones se guardan como revisión del manifiesto.</p>
        <ExamWorkflowNav current={1} links={[
          { stage: 1, title: "Examen", href: `/exams/${examId}`, enabled: true },
          { stage: 2, title: "Respuestas IA", href: `/exams/${examId}/answers`, enabled: manifest.pages.length > 0 && !pagesDirty },
          { stage: 3, title: "Plantilla OMR", href: `/exams/${examId}/omr-template`, enabled: false },
          { stage: 4, title: "Alumnos", href: `/exams/${examId}/students`, enabled: false },
          { stage: 5, title: "Comparar", href: `/exams/${examId}/students`, enabled: false },
          { stage: 6, title: "Calificar", href: `/exams/${examId}/students`, enabled: false },
        ]} />
        <p className="intro">Prepara el examen fuente: sube el documento, ordena y transforma sus páginas. La IA se inicia en la pantalla 2.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        <div className="detail-grid">
          <div className="panel">
            <h2>Subir documentos</h2>
            <div className="dropzone">PDF, JPEG, PNG o WebP · máximo 25 MB<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple onChange={handleFiles} /></div>
            {Object.entries(progress).map(([assetId, value]) => <div className="progress" key={assetId}><span style={{ width: `${value}%` }} /></div>)}
            <div className="asset-list">{assets.map((asset) => <div className="asset-row" key={asset.assetId}><small>{asset.mimeType} · {formatSize(asset.sizeBytes)} · {asset.state}</small><a className="eyebrow" href={`/api/assets/${asset.assetId}/metadata`}>metadata</a><button className="button secondary" type="button" disabled={deletingAssetId !== null} onClick={() => deleteAsset(asset)}>{deletingAssetId === asset.assetId ? "Eliminando..." : "Eliminar"}</button></div>)}</div>
          </div>
          <div className="panel"><h2>Vista previa</h2><div className="preview">{previewUrl && selectedAsset?.mimeType.startsWith("image/") ? <img src={previewUrl} alt="Página del examen" style={{ transform: `rotate(${selectedPage?.rotation ?? 0}deg)` }} /> : previewUrl ? <iframe src={previewUrl} title="PDF del examen" /> : <span className="intro">Selecciona una página</span>}</div></div>
        </div>
        <div className="detail-grid">
          <div className="panel"><h2>Páginas</h2><div className="page-list">{orderedPages.map((page) => <div className={`page-row ${selectedPageId === page.pageId ? "selected" : ""}`} key={page.pageId} onClick={() => setSelectedPageId(page.pageId)}><input type="checkbox" checked={selectedGroupIds.includes(page.pageId)} onChange={() => setSelectedGroupIds((current) => current.includes(page.pageId) ? current.filter((id) => id !== page.pageId) : [...current, page.pageId])} onClick={(event) => event.stopPropagation()} /><span>Página {page.pageNumber} · orden {page.order + 1}</span><span className="eyebrow">{page.rotation}°</span></div>)}</div></div>
          <div className="panel"><h2>Transformar y agrupar</h2><div className="toolbar"><button className="button secondary" type="button" onClick={() => selectedPage && updatePage(selectedPage.pageId, { rotation: ((selectedPage.rotation + 90) % 360) as Page["rotation"] })}>Girar 90°</button><button className="button secondary" type="button" onClick={() => movePage(-1)}>Subir</button><button className="button secondary" type="button" onClick={() => movePage(1)}>Bajar</button></div>{selectedPage ? <div className="mini-form"><input className="input" type="number" min="0" max="1" step=".01" placeholder="x" value={selectedPage.crop?.x ?? ""} onChange={(event) => updatePage(selectedPage.pageId, { crop: { x: Number(event.target.value), y: selectedPage.crop?.y ?? 0, width: selectedPage.crop?.width ?? 1, height: selectedPage.crop?.height ?? 1 } })} /><input className="input" type="number" min="0" max="1" step=".01" placeholder="y" value={selectedPage.crop?.y ?? ""} onChange={(event) => updatePage(selectedPage.pageId, { crop: { x: selectedPage.crop?.x ?? 0, y: Number(event.target.value), width: selectedPage.crop?.width ?? 1, height: selectedPage.crop?.height ?? 1 } })} /><input className="input" type="number" min="0" max="1" step=".01" placeholder="ancho" value={selectedPage.crop?.width ?? ""} onChange={(event) => updatePage(selectedPage.pageId, { crop: { x: selectedPage.crop?.x ?? 0, y: selectedPage.crop?.y ?? 0, width: Number(event.target.value), height: selectedPage.crop?.height ?? 1 } })} /><input className="input" type="number" min="0" max="1" step=".01" placeholder="alto" value={selectedPage.crop?.height ?? ""} onChange={(event) => updatePage(selectedPage.pageId, { crop: { x: selectedPage.crop?.x ?? 0, y: selectedPage.crop?.y ?? 0, width: selectedPage.crop?.width ?? 1, height: Number(event.target.value) } })} /></div> : null}<div className="form"><input className="input" value={groupLabel} onChange={(event) => setGroupLabel(event.target.value)} /><button className="button secondary" type="button" onClick={createGroup}>Agrupar seleccionadas ({selectedGroupIds.length})</button><button className="button" type="button" onClick={savePages}>Guardar páginas</button></div>{manifest.groups.map((group) => <p className="intro" key={group.groupId}>{group.label}: {group.pageIds.length} páginas</p>)}</div>
        </div>
        <div className="actions"><button className="button" type="button" disabled={manifest.pages.length === 0} onClick={continueToAnswers}>{pagesDirty ? "Guardar y continuar: respuestas IA" : "Continuar: respuestas IA"}</button></div>
      </section> : <p className="notice">{message ?? "Examen no encontrado."}</p>}
    </main>
  );
}
