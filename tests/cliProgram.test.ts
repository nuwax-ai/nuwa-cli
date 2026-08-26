import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/createProgram.js";

function commandNames() {
  return createProgram().commands.map((command) => command.name());
}

function optionLongNames(commandName: string): string[] {
  const command = createProgram().commands.find(
    (cmd) => cmd.name() === commandName,
  );
  if (!command) throw new Error(`missing command ${commandName}`);
  return command.options
    .map((option) => option.long)
    .filter(Boolean) as string[];
}

describe("createProgram", () => {
  it("registers the public top-level command surface", () => {
    expect(commandNames()).toEqual([
      "ps",
      "doctor",
      "chat",
      "sessions",
      "workspaces",
      "context",
      "login",
      "logout",
      "status",
      "config",
      "account",
      "start",
      "restart",
      "stop",
      "serve",
      "gateway",
      "service",
      "console",
      "install",
      "update",
      "lang",
    ]);
  });

  it("registers install and update --yes", () => {
    expect(optionLongNames("install")).toEqual(
      expect.arrayContaining([
        "--yes",
        "--lang",
        "--tag",
        "--registry",
        "--force",
      ]),
    );
    expect(optionLongNames("update")).toContain("--yes");
  });

  it("does not expose legacy command aliases", () => {
    const program = createProgram();
    const gateway = program.commands.find(
      (command) => command.name() === "gateway",
    );
    const console = program.commands.find(
      (command) => command.name() === "console",
    );
    const start = program.commands.find((command) => command.name() === "start");

    expect(gateway?.aliases()).toEqual([]);
    expect(console?.aliases()).toEqual([]);
    expect(start?.aliases()).toEqual([]);
    expect(commandNames()).not.toEqual(expect.arrayContaining(["up", "ui"]));
  });

  it("registers shared serve/gateway options exactly once", () => {
    for (const commandName of ["serve", "gateway"]) {
      const options = optionLongNames(commandName);
      expect(options.filter((name) => name === "--port")).toHaveLength(1);
      expect(options.filter((name) => name === "--host")).toHaveLength(1);
      expect(options.filter((name) => name === "--daemon")).toHaveLength(1);
      expect(options.filter((name) => name === "--force")).toHaveLength(1);
      expect(options.filter((name) => name === "--api-key")).toHaveLength(1);
    }
  });

  it("registers doctor --fix", () => {
    expect(optionLongNames("doctor")).toContain("--fix");
    expect(optionLongNames("console")).toContain("--force");
  });

  it("registers start/restart/stop --all for optional Console scope", () => {
    expect(optionLongNames("start")).toContain("--force");
    expect(optionLongNames("start")).toContain("--no-open");
    expect(optionLongNames("start")).toContain("--all");
    expect(optionLongNames("restart")).toContain("--all");
    expect(optionLongNames("restart")).toContain("--no-open");
    expect(optionLongNames("stop")).toContain("--all");

    // --all 均为可选；默认不含 Console
    for (const name of ["start", "restart", "stop"] as const) {
      const command = createProgram().commands.find((c) => c.name() === name);
      const allOption = command?.options.find((o) => o.long === "--all");
      expect(allOption?.required).toBe(false);
    }
  });

});
