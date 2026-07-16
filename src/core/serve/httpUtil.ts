import * as http from "node:http";

/**
 * Shared HTTP helpers used by both the `serve` API server and the local `ui`
 * server — factored out so the two stay in sync.
 */

export async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = 10 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error(`request body too large (max ${maxBytes} bytes)`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Nuwax-Internal-Secret, X-Nuwax-Ui-Token",
  });
  res.end(JSON.stringify(body));
}

export function httpResult<T>(data: T): {
  code: "0000";
  message: "success";
  data: T;
  success: true;
  tid: null;
} {
  return { code: "0000", message: "success", data, success: true, tid: null };
}

export function httpError(
  code: string,
  message: string,
): {
  code: string;
  message: string;
  data: null;
  success: false;
  tid: null;
  error: string;
} {
  return {
    code,
    message,
    data: null,
    success: false,
    tid: null,
    error: message,
  };
}

/** First non-empty string value among `keys` in a JSON body. */
export function textField(
  body: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
