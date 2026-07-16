import type { Command } from "commander";
import {
  serviceInstallCommand,
  serviceStartCommand,
  serviceStatusCommand,
  serviceStopCommand,
  serviceUninstallCommand,
} from "../commands/service.js";
import { serveCommand } from "../commands/serve.js";
import { gatewayCommand } from "../commands/gateway.js";
import { stopCommand } from "../commands/processes.js";
import { restartCommand } from "../commands/restart.js";
import { startCommand } from "../commands/start.js";
import {
  addCloudLoginOptions,
  addModelOverlayOptions,
  addServeRuntimeOptions,
  addServiceInstallOptions,
} from "./options.js";

export function registerServiceCommands(program: Command): void {
  addModelOverlayOptions(
    addCloudLoginOptions(
      program
        .command("start")
        .description(
          "启动完整运行环境：Gateway 在后台运行，Console 在当前终端前台运行",
        ),
    )
      .option(
        "--engine <engine>",
        "Gateway/Console 使用的默认引擎：claude 或 codex",
      )
      .option("--cwd <dir>", "Gateway 和 Console 使用的工作目录")
      .option(
        "--approve <policy>",
        "权限策略：auto（默认）/ ask（逐个审批）/ deny",
        "auto",
      )
      .option("--force", "强制替换现有 Gateway 和 Console")
      .option("--no-open", "Console 启动后不自动打开浏览器"),
  )
    .addHelpText(
      "after",
      [
        "",
        "说明：",
        "  - 等价于确保 gateway --daemon 和前台 console 同时运行。",
        "  - 默认复用健康实例，只补齐缺失服务；--force 会替换全部实例。",
        "  - Console 会持续占用当前终端；Ctrl+C 只关闭 Console，Gateway 继续运行。",
      ].join("\n"),
    )
    .action(startCommand);

  program
    .command("restart")
    .description(
      "强制重启全部服务：Gateway 后台运行，Console 在当前终端前台运行",
    )
    .requiredOption("--all", "重启 Gateway 和 Console")
    .option(
      "--engine <engine>",
      "Gateway/Console 使用的默认引擎：claude 或 codex",
    )
    .option("--no-open", "Console 启动后不自动打开浏览器")
    .addHelpText(
      "after",
      [
        "",
        "说明：",
        "  - Gateway 会通过 gateway --daemon --force 在后台重启。",
        "  - Console 只允许前台运行，因此本命令会持续占用当前终端；Ctrl+C 可关闭 Console。",
        "  - 如果 Gateway 重启失败，不会继续重启 Console。",
      ].join("\n"),
    )
    .action(restartCommand);

  program
    .command("stop")
    .description("停止 Gateway 或 Console；不传范围时默认停止 Gateway")
    .option("--all", "停止 Gateway 和 Console")
    .option("--gateway", "仅停止 Gateway")
    .option("--console", "仅停止 Console")
    .action(stopCommand);

  addServeRuntimeOptions(
    program
      .command("serve")
      .description("启动本机 HTTP API（chat + SSE），供脚本/云端/IM 远程调度")
      .option("--engine <engine>", "使用的引擎：claude 或 codex", "claude")
      .option("--tunnel", "登录后启动本地 nuwax-file-server 与 lanproxy 隧道"),
  ).action(serveCommand);

  addServeRuntimeOptions(
    addCloudLoginOptions(
      program
        .command("gateway")
        .description(
          "启动 Gateway Server：检测引擎、登录/注册并运行 serve --tunnel",
        ),
    ).option(
      "--engine <engine>",
      "使用的引擎：claude 或 codex；不传则自动选择",
    ),
  )
    .addHelpText(
      "after",
      [
        "",
        "说明：",
        "  - 不传 --domain / -u / --saved-key 时，使用当前默认账号 savedKey 免密注册。",
        "  - 使用 -u 时，若 credentials.json 中已有同 domain+username 的 savedKey，会随注册请求一起提交，避免新建电脑。",
        "  - 密码通过交互输入；CI 可用 NUWACLI_PASSWORD，且该变量不会传给 engine/lanproxy/file-server。",
        "  - 未传 --engine 时自动检测 claude/codex；多个可用时随机选择一个。",
      ].join("\n"),
    )
    .action(async (options) => {
      await gatewayCommand(options);
    });

  const service = program
    .command("service")
    .description("管理 Gateway 的后台常驻与开机/登录自启动（不管理 Console）");

  addServiceInstallOptions(
    service
      .command("install")
      .description(
        "安装当前用户后台服务；默认下次用户登录启动，传 --now 立即启动",
      ),
  )
    .addHelpText(
      "after",
      [
        "",
        "说明：",
        "  - 安装前需要已有 CLI 默认账号：先运行 `nuwa-cli login` 或 `nuwa-cli gateway` 成功一次。",
        "  - 启动项不会保存密码、savedKey、configKey 或模型 API key；登录态仍从 ~/.nuwa-cli/credentials.json 读取。",
        "  - macOS 使用 LaunchAgent，Linux 使用 systemd user service，Windows 使用当前用户计划任务。",
        "  - Linux 默认是用户登录后启动；未登录也启动需要系统启用 linger。",
      ].join("\n"),
    )
    .action(serviceInstallCommand);

  service
    .command("start")
    .description("启动已安装的后台服务")
    .action(serviceStartCommand);

  service
    .command("stop")
    .description("停止已安装的后台服务")
    .action(serviceStopCommand);

  service
    .command("status")
    .description("查看系统启动项与当前 serve 运行状态")
    .action(serviceStatusCommand);

  service
    .command("uninstall")
    .description("停止并移除后台服务/开机启动项")
    .action(serviceUninstallCommand);
}
