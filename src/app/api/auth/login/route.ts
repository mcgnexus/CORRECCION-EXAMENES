import { randomBytes } from "node:crypto";
import { z } from "zod";
import { assertSameOrigin, getSession, verifyPasswordHash } from "@/lib/auth";
import { errorResponse, AppError } from "@/lib/errors";

const loginSchema = z.object({ login: z.string().min(1).max(200), password: z.string().min(1).max(500) });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const configuredLogin = process.env.ADMIN_LOGIN ?? "ACPL";
    const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "scrypt$29099c89e6ca6687c697f8a9422c805e$ae1f75abcab22b2221a494164d45d5287cadeabca8e079fc197c07e1974a8796";
    const input = loginSchema.parse(await request.json());
    if (input.login !== configuredLogin || !verifyPasswordHash(input.password, passwordHash)) {
      throw new AppError("INVALID_CREDENTIALS", "Credenciales no válidas.", 401);
    }
    const session = await getSession();
    session.ownerId = configuredLogin;
    session.csrfToken = randomBytes(24).toString("hex");
    await session.save();
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
