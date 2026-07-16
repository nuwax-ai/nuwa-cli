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
      "update",
    ]);
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

  it("registers restart --all", () => {
    expect(optionLongNames("start")).toContain("--force");
    expect(optionLongNames("start")).toContain("--no-open");
    expect(optionLongNames("restart")).toContain("--all");
    expect(optionLongNames("restart")).toContain("--no-open");
    expect(optionLongNames("stop")).toContain("--all");
  });

});
