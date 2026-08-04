import pc from "picocolors";
import type { ServeStatus } from "./serveLock.js";
import { t } from "../../util/i18n/index.js";

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
      t("gateway.lineRunning", {
        state: pc.green(t("status.running")),
        host: serve.host,
        port: serve.port,
        pid: serve.pid,
        startedAt: serve.startedAt,
      }),
    );
  } else if (serve.state === "unhealthy") {
    console.log(
      t("gateway.lineUnhealthy", {
        state: pc.yellow(t("status.unhealthy")),
        pid: serve.pid,
        host: serve.host,
        port: serve.port,
      }),
    );
  } else {
    console.log(
      t("gateway.lineStopped", {
        state: pc.dim(t("status.notRunning")),
        note: serve.note ? `  ${pc.dim(serve.note)}` : "",
      }),
    );
  }
}
