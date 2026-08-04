import pc from "picocolors";
import type { ServeStatus } from "./serveLock.js";

/**
 * 统一渲染 Gateway 运行态行，供 `status`（login.ts printServeStatus）与
 * `service status`（service.ts serviceStatusCommand）共用——此前两条命令对同一
 * 份 ServeStatus 展示不同格式（一条用「端口/PID/启动于」，另一条用「http URL（pid）」）。
 *
 * 运行中合并两端信息：URL + PID + 启动时间。
 */
export function printGatewayStatusLine(serve: ServeStatus): void {
  if (serve.state === "running") {
    console.log(
      `Gateway：${pc.green("运行中")}  http://${serve.host}:${serve.port}  PID ${serve.pid}  启动于 ${serve.startedAt}`,
    );
  } else if (serve.state === "unhealthy") {
    console.log(
      `Gateway：${pc.yellow("异常")}  PID ${serve.pid}  http://${serve.host}:${serve.port}（/health 无响应，可能仍在启动或不健康）`,
    );
  } else {
    console.log(
      `Gateway：${pc.dim("未运行")}${
        serve.note ? `  ${pc.dim(serve.note)}` : ""
      }（可用 \`nuwa-cli gateway\` 启动）`,
    );
  }
}
