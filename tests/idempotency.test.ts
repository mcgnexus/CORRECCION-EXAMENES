import { describe, expect, it } from "vitest";
import { IdempotencyRepository } from "../src/repositories/idempotency";
import { MemoryBlobStore } from "../src/repositories/blob-store";

describe("IdempotencyRepository", () => {
  it("reproduce el resultado sin ejecutar dos veces la operación", async () => {
    const repository = new IdempotencyRepository(new MemoryBlobStore());
    let executions = 0;
    const first = await repository.execute("owner-1", "operation", "key-1", async () => {
      executions += 1;
      return { id: "result-1" };
    });
    const second = await repository.execute("owner-1", "operation", "key-1", async () => {
      executions += 1;
      return { id: "result-2" };
    });
    expect(first.replayed).toBe(false);
    expect(second).toEqual({ replayed: true, result: { id: "result-1" } });
    expect(executions).toBe(1);
  });
});
