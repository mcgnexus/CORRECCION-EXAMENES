import { assertSameOrigin, getSession } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const session = await getSession();
    session.destroy();
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
