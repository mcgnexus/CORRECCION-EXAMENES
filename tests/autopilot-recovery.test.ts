import { describe, expect, it } from "vitest";
import { isAutopilotStuck, latestAutopilotProgressAt } from "../src/lib/autopilot-recovery";

const NOW = Date.parse("2026-11-02T21:00:00Z");

describe("recuperación del autopilot", () => {
  it("considera vivo un run con progreso reciente", () => {
    expect(isAutopilotStuck(["2026-11-02T20:55:00Z", null], NOW)).toBe(false);
  });

  it("marca atascado un run sin progreso superado el umbral", () => {
    expect(isAutopilotStuck(["2026-11-02T20:30:00Z", null], NOW)).toBe(true);
  });

  it("usa el marcador de progreso más reciente para decidir", () => {
    expect(isAutopilotStuck(["2026-11-02T20:30:00Z", "2026-11-02T20:58:00Z"], NOW)).toBe(false);
    expect(isAutopilotStuck(["2026-11-02T20:30:00Z", "2026-11-02T20:20:00Z"], NOW)).toBe(true);
  });

  it("no marca atascado cuando no hay fechas válidas", () => {
    expect(isAutopilotStuck([null, undefined], NOW)).toBe(false);
    expect(latestAutopilotProgressAt(null, "no-es-fecha")).toBeNull();
  });
});
