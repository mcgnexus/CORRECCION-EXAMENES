import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import type { ExportFormat } from "../domain/phase5-schemas";

export const exportColumns = [
  "submissionId", "identity", "createdAt", "closedAt", "score", "rawPoints", "correct", "blank", "incorrect", "pending", "openPoints", "openMaximumPoints", "sectionPoints", "snapshotId", "responseRegionRevisionId", "transcriptionRevisionIds", "evaluationIds", "decisionIds", "incidents",
] as const;

export type ExportRow = Record<(typeof exportColumns)[number], string | number>;

function neutralize(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function cell(value: string | number) { return typeof value === "string" ? neutralize(value) : value; }

function csvValue(value: string | number) {
  const normalized = String(cell(value));
  return /[",\r\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

export function generateCsv(rows: ExportRow[]) {
  const lines = [exportColumns.join(",")];
  for (const row of rows) lines.push(exportColumns.map((column) => csvValue(row[column])).join(","));
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

export async function generateXlsx(rows: ExportRow[], metadata: Record<string, string | number | boolean>) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Corrección de exámenes";
  const results = workbook.addWorksheet("results");
  results.columns = exportColumns.map((key) => ({ header: key, key, width: Math.min(42, Math.max(14, key.length + 2)) }));
  for (const row of rows) results.addRow(Object.fromEntries(exportColumns.map((key) => [key, cell(row[key])] )));
  results.getRow(1).font = { bold: true };
  results.views = [{ state: "frozen", ySplit: 1 }];
  const metadataSheet = workbook.addWorksheet("metadata");
  metadataSheet.columns = [{ header: "key", key: "key", width: 28 }, { header: "value", key: "value", width: 80 }];
  for (const [key, value] of Object.entries(metadata)) metadataSheet.addRow({ key, value: typeof value === "string" ? neutralize(value) : value });
  metadataSheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function wrap(text: string, max = 92) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!word) continue;
    if ((line + " " + word).trim().length > max && line) { lines.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export type PdfSubmission = {
  identity: string;
  submissionId: string;
  score: number;
  rawPoints: number;
  correct: number;
  blank: number;
  incorrect: number;
  pending: number;
  openPoints: number;
  openMaximumPoints: number;
  snapshotId: string;
  exportedAt: string;
  sections: Array<{ sectionId: string; points: number; maximumPoints: number }>;
  questions: Array<{ questionId: string; transcription?: string; decision?: string; points?: number; maximumPoints?: number; criteria?: string }>;
  incidents: string[];
};

export async function generatePdf(input: PdfSubmission, originalAssets: Array<{ mimeType: string; body: Uint8Array }> = []) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]);
  let y = 790;
  const write = (text: string, size = 10, isBold = false) => {
    for (const line of wrap(text)) {
      if (y < 45) { page = document.addPage([595, 842]); y = 790; }
      page.drawText(line, { x: 42, y, size, font: isBold ? bold : font, color: rgb(0.08, 0.1, 0.13) });
      y -= size + 5;
    }
  };
  write("Resultado definitivo", 20, true);
  write(`Identidad confirmada: ${input.identity}`);
  write(`Submission: ${input.submissionId}`);
  write(`Nota: ${input.score} | Puntos brutos: ${input.rawPoints}`);
  write(`Correctas: ${input.correct} | Blancas: ${input.blank} | Incorrectas: ${input.incorrect} | Pendientes: ${input.pending}`);
  write(`Preguntas abiertas: ${input.openPoints}/${input.openMaximumPoints}`);
  write(`Snapshot: ${input.snapshotId} | Exportado: ${input.exportedAt}`);
  write("Desglose por sección", 13, true);
  for (const section of input.sections) write(`${section.sectionId}: ${section.points}/${section.maximumPoints}`);
  write("Desglose por pregunta", 13, true);
  for (const question of input.questions) {
    write(`${question.questionId}: ${question.points ?? "-"}/${question.maximumPoints ?? "-"}${question.decision ? ` | decisión: ${question.decision}` : ""}`);
    if (question.transcription) write(`Transcripción corregida: ${question.transcription}`);
    if (question.criteria) write(`Criterios: ${question.criteria}`);
  }
  if (input.incidents.length) { write("Incidencias", 13, true); for (const incident of input.incidents) write(incident); }
  write("Este informe contiene únicamente datos definitivos revisados.", 8);

  for (const original of originalAssets) {
    if (original.mimeType === "application/pdf") {
      const source = await PDFDocument.load(original.body);
      const copied = await document.copyPages(source, source.getPageIndices());
      for (const originalPage of copied) document.addPage(originalPage);
    } else if (original.mimeType === "image/png" || original.mimeType === "image/jpeg") {
      const image = original.mimeType === "image/png" ? await document.embedPng(original.body) : await document.embedJpg(original.body);
      const scale = Math.min(510 / image.width, 760 / image.height, 1);
      const originalPage = document.addPage([595, 842]);
      originalPage.drawImage(image, { x: 42, y: 790 - image.height * scale, width: image.width * scale, height: image.height * scale });
    }
  }
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

export function mimeFor(format: ExportFormat) {
  return format === "csv" ? "text/csv; charset=utf-8" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
}
