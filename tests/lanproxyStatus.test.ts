import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServeStatus: vi.fn(),
  listRegistered: vi.fn(),
}));

vi.mock("../src/core/serve/serveLock.js", () => ({
  getServeStatus: (...args: unknown[]) => mocks.getServeStatus(...args),
}));

vi.mock("../src/core/processes/processRegistry.js", () => ({
  listRegisteredProcesses: () => mocks.listRegistered(),
}));

describe("waitForGatewayStackReady", () => {
  beforeEach(() => {
    mocks.getServeStatus.mockReset();
    mocks.listRegistered.mockReset().mockReturnValue([]);
  });

  it("waits until gateway is running and lanproxy is registered", async () => {
    mocks.getServeStatus
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValueOnce({
        state: "running",
        pid: 101,
        host: "127.0.0.1",
        port: 60016,
        startedAt: "2026-08-04T00:00:00.000Z",
      })
      .mockResolvedValue({
        state: "running",
        pid: 101,
        host: "127.0.0.1",
        port: 60016,
        startedAt: "2026-08-04T00:00:00.000Z",
      });
    mocks.listRegistered
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValue([
        {
          pid: 303,
          kind: "lanproxy",
          host: "testagent.example.com",
          port: 10076,
        },
      ]);

    const { waitForGatewayStackReady } =
      await import("../src/core/processes/lanproxyStatus.js");
    const ready = await waitForGatewayStackReady(2_000, 10);

    expect(ready.gateway.state).toBe("running");
    expect(ready.lanproxy).toMatchObject({
      pid: 303,
      host: "testagent.example.com",
      port: 10076,
    });
  });

  it("returns incomplete result after timeout", async () => {
    mocks.getServeStatus.mockResolvedValue({ state: "stopped" });
    mocks.listRegistered.mockReturnValue([]);

    const { waitForGatewayStackReady } =
      await import("../src/core/processes/lanproxyStatus.js");
    const ready = await waitForGatewayStackReady(50, 10);

    expect(ready.gateway.state).toBe("stopped");
    expect(ready.lanproxy).toBeUndefined();
  });
});
