import * as http from "node:http";
import { readServeLock, probeServeHealth } from "../serve/serveLock.js";

export type SensitiveAccessPurpose =
  | "user-cli"
  | "user-resume"
  | "agent-export"
  | "serve-export";

export class ConsentRequiredError extends Error {
  readonly code = "CONSENT_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "ConsentRequiredError";
  }
}

export class ConsentDeniedError extends Error {
  readonly code = "CONSENT_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "ConsentDeniedError";
  }
}

function isInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * 推断调用目的：人工 TTY → user-cli；否则视为 agent 导出旁路。
 * 显式 purpose 优先（如 resume picker）。
 */
export function inferSensitivePurpose(
  explicit?: SensitiveAccessPurpose,
): SensitiveAccessPurpose {
  if (explicit) return explicit;
  if (isInteractiveTty()) return "user-cli";
  return "agent-export";
}

async function postJson(
  port: number,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 130_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let json: Record<string, unknown> = {};
          try {
            json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new ConsentRequiredError("sensitive-access await timed out"));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * 敏感读盘闸门：TTY/user-resume 放行；agent 旁路必须经本机 serve 审批。
 *
 * 测试/可信自动化可设 `NUWACLI_SENSITIVE_ACCESS=allow` 跳过（勿在生产默认开启）。
 */
export async function withSensitiveAccess<T>(
  args: {
    kind: string;
    title: string;
    purpose?: SensitiveAccessPurpose;
    rawInput?: Record<string, unknown>;
  },
  op: () => Promise<T>,
): Promise<T> {
  if (process.env.NUWACLI_SENSITIVE_ACCESS === "allow") {
    return op();
  }
  if (process.env.NUWACLI_SENSITIVE_ACCESS === "deny") {
    throw new ConsentDeniedError(
      `敏感访问「${args.kind}」已被 NUWACLI_SENSITIVE_ACCESS=deny 拒绝。`,
    );
  }

  const purpose = inferSensitivePurpose(args.purpose);
  if (purpose === "user-cli" || purpose === "user-resume") {
    return op();
  }

  const lock = readServeLock();
  if (!lock) {
    throw new ConsentRequiredError(
      `敏感访问「${args.kind}」需要本机 nuwa-cli serve 审批，但未检测到运行中的 serve。请先 up/serve，或在交互终端手动执行该命令。`,
    );
  }

  const healthy = await probeServeHealth(lock.host, lock.port);
  if (!healthy) {
    throw new ConsentRequiredError(
      `敏感访问「${args.kind}」需要审批，但 serve（端口 ${lock.port}）健康检查失败。`,
    );
  }

  const { status, json } = await postJson(
    lock.port,
    "/computer/sensitive-access/await",
    {
      kind: args.kind,
      title: args.title,
      raw_input: args.rawInput ?? {},
    },
  );

  if (status === 503 || json.code === "NO_APPROVAL_CHANNEL") {
    throw new ConsentRequiredError(
      `敏感访问「${args.kind}」需要审批通道：请先打开云端/本机对 serve 的 /computer/progress SSE，再重试。`,
    );
  }
  if (status === 403 || json.code === "CONSENT_DENIED") {
    throw new ConsentDeniedError(
      `用户拒绝了敏感访问「${args.kind}」。`,
    );
  }
  if (status < 200 || status >= 300) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `sensitive-access failed (HTTP ${status})`;
    throw new ConsentRequiredError(message);
  }

  return op();
}
