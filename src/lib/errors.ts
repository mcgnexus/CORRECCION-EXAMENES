export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown, requestId: string) {
  if (!(error instanceof AppError)) {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    console.error("unhandled_api_error", {
      requestId,
      name: typeof candidate?.name === "string" ? candidate.name : "UnknownError",
      message: typeof candidate?.message === "string" ? candidate.message : "Sin mensaje",
      stack: typeof candidate?.stack === "string" ? candidate.stack.slice(0, 2000) : undefined,
    });
  }
  const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "Se ha producido un error interno.", 500);
  return Response.json(
    { error: { code: appError.code, message: appError.message, requestId, retryable: appError.retryable } },
    { status: appError.status, headers: { "x-request-id": requestId } },
  );
}
