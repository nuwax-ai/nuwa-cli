// @nuwax-ai/agent-kit — PersistentMcpBridge singleton manager.
//
// Both nuwa-cli and nuwaclaw keep a single bridge instance and restart it on
// config change. The bridge constructor + logger are host-injected, so agent-kit
// does NOT depend on @nuwax-ai/mcp-proxy-ts directly — this keeps the module
// ESM/CJS-agnostic (no host-adapter import to resolve at build time).

export interface McpProxyLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** The slice of PersistentMcpBridge that this manager drives. `start` is typed
 *  loosely (any) so the host's concrete PersistentMcpBridge — whose start takes
 *  a narrower Record<string, HostStdioServerEntry> — is assignable without
 *  parameter-variance friction; the host guarantees the servers shape. */
export interface PersistentBridgeInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start(servers: any): Promise<unknown>;
  stop(): Promise<void>;
}

export interface CreatePersistentBridgeOptions {
  /** Host-provided factory — typically `() => new PersistentMcpBridge(logger)`. */
  create: (logger: McpProxyLogger) => PersistentBridgeInstance;
  logger: McpProxyLogger;
  onStarted?: (names: string[]) => void;
  onStopped?: () => void;
  onStopError?: (err: unknown) => void;
}

export interface PersistentBridgeHandle {
  /**
   * Ensure the bridge is started with `servers`. Empty servers → stop + null
   * (mirrors nuwa-cli's existing semantics). Returns the bridge instance (or
   * null) so the caller can pass it to rewriteServersToProxyCommands.
   */
  ensureStarted(
    servers: Record<string, unknown>,
  ): Promise<PersistentBridgeInstance | null>;
  /** Stop the bridge if running; safe to call when not running. */
  stop(): Promise<void>;
  isRunning(): boolean;
}

/**
 * Manage a single PersistentMcpBridge across config changes: create-on-first-use,
   * restart on change, stop on shutdown. Replaces the per-host singleton + bookkeeping
 * that nuwa-cli (proxyRewrite.ts) and nuwaclaw (persistentMcpBridge.ts) duplicate.
 */
export function createPersistentBridge(
  opts: CreatePersistentBridgeOptions,
): PersistentBridgeHandle {
  const { create, logger, onStarted, onStopped, onStopError } = opts;
  let bridge: PersistentBridgeInstance | null = null;

  const stop = async (): Promise<void> => {
    if (!bridge) return;
    try {
      await bridge.stop();
      onStopped?.();
    } catch (err) {
      onStopError?.(err);
    } finally {
      bridge = null;
    }
  };

  return {
    async ensureStarted(servers) {
      const names = Object.keys(servers);
      if (names.length === 0) {
        await stop();
        return null;
      }
      if (!bridge) bridge = create(logger);
      await bridge.start(servers);
      onStarted?.(names);
      return bridge;
    },
    stop,
    isRunning: () => bridge !== null,
  };
}
