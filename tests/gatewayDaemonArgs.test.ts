import { describe, expect, it } from "vitest";
import { buildServeDaemonArgs } from "../src/commands/gateway.js";

describe("buildServeDaemonArgs", () => {
  it("does not forward parent --force to the daemon child", () => {
    const args = buildServeDaemonArgs(
      {
        force: true,
        port: "60016",
        host: "127.0.0.1",
        approve: "ask",
      },
      "claude",
    );
    expect(args).toContain("serve");
    expect(args).toContain("--tunnel");
    expect(args).toContain("--engine");
    expect(args).toContain("claude");
    expect(args).toContain("--port");
    expect(args).toContain("60016");
    expect(args).not.toContain("--force");
  });
});
