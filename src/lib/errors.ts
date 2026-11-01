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
  const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "Se ha producido un error interno.", 500);
  return Response.json(
    { error: { code: appError.code, message: appError.message, requestId, retryable: appError.retryable } },
    { status: appError.status, headers: { "x-request-id": requestId } },
  );
}
