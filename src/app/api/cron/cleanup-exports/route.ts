import { timingSafeEqual } from "node:crypto";
import { AppError, errorResponse } from "@/lib/errors";
import { getAuditRepository, getExportRepository, getJobRepository } from "@/repositories";

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !received) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(received);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) { return cleanup(request); }
export async function POST(request: Request) { return cleanup(request); }

async function cleanup(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    if (!authorized(request)) throw new AppError("CRON_UNAUTHORIZED", "Credenciales de Cron inválidas.", 401);
    const repository = getExportRepository();
    const expired = await repository.listExpired();
    const deleted: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ exportId: string; code: string }> = [];
    for (const item of expired) {
      let active = false;
      const jobRepository = getJobRepository();
      const ownerJobs = await jobRepository.list(item.manifest.ownerId);
      for (const job of ownerJobs) {
        if (job.job.kind === "export" && ["queued", "running", "cancel_requested"].includes(job.job.status) && job.job.exportRequest?.batchId === item.manifest.batchId && job.job.outputRefs.includes(item.manifest.exportId)) { active = true; break; }
      }
      if (active) { skipped.push(item.manifest.exportId); continue; }
      try {
        await repository.deleteContent(item.manifest);
        await repository.markDeleted(item.manifest.ownerId, item.manifest.exportId, item.etag);
        deleted.push(item.manifest.exportId);
      } catch (error) {
        errors.push({ exportId: item.manifest.exportId, code: error instanceof AppError ? error.code : "CLEANUP_FAILED" });
      }
    }
    const owners = new Set(expired.map((item) => item.manifest.ownerId));
    for (const ownerId of owners) await getAuditRepository().append({ ownerId, actorId: ownerId, type: "exports.cleanup", aggregateType: "export", aggregateId: "retention", payload: { deleted: deleted.filter((id) => expired.some((item) => item.manifest.ownerId === ownerId && item.manifest.exportId === id)), skipped, errors } });
    return Response.json({ data: { scanned: expired.length, deleted, skipped, errors }, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
