import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export type SessionData = { ownerId?: string; csrfToken?: string };

export async function getSession() {
  const password = process.env.AUTH_SECRET;
  if (!password) throw new AppError("AUTH_NOT_CONFIGURED", "AUTH_SECRET no está configurado.", 503);
  return getIronSession<SessionData>(await cookies(), {
    password,
    cookieName: "exam_corrector_session",
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 60 * 60 * 8, path: "/" },
  });
}

export async function requireOwner() {
  const session = await getSession();
  if (!session.ownerId) throw new AppError("UNAUTHENTICATED", "La sesión no es válida.", 401);
  return { session, ownerId: session.ownerId };
}

export function verifyPasswordHash(password: string, encodedHash: string) {
  const [algorithm, salt, expected] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 32).toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) throw new AppError("CSRF_REJECTED", "Falta un origen verificable.", 403);
  const expected = new URL(request.url).origin;
  if (new URL(origin).origin !== expected) throw new AppError("CSRF_REJECTED", "Origen no permitido.", 403);
}
