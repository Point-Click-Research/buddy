// The one Cua driver instance, and the sessions handed out from it.
//
// The driver is a native runtime loaded into Buddy's main process. There must
// be exactly one: an agent task and guide mode both want to talk to it, and
// two instances would mean two copies of that runtime fighting over the same
// accessibility and screen-recording grants.
//
// So sessions are what callers get. A session is cheap, has its own limits,
// and ending one leaves the driver running for everyone else. Only quitting
// shuts the driver down.

import { createLogger } from '../log';

const log = createLogger('driver');

/** Buddy owns the session limits; the driver enforces them underneath. */
const SESSION_TTL_SECONDS = 3600;
const IDLE_TTL_SECONDS = 300;

export interface DriverToolResult {
  text: string;
  isError: boolean;
  errorCode?: string;
  /** The driver's structuredContent, as JSON. */
  structuredJson?: string;
  action?: { effect: number };
}

/** What Buddy uses from the SDK, so the import stays in one place. */
interface Driver {
  callTool(name: string, argumentsJson: string): Promise<DriverToolResult>;
  shutdown(): Promise<void>;
}

/** One caller's conversation with the driver. */
export interface DriverSession {
  /** Call a driver tool, with this session's label attached. */
  call(tool: string, args: Record<string, unknown>): Promise<DriverToolResult>;
  /** End this session. The driver itself keeps running. */
  end(): Promise<void>;
}

let driver: Promise<Driver> | null = null;

/**
 * The driver, started on first use. The SDK is ESM-only and Buddy's main
 * process is CJS, so it is imported at runtime rather than required; it also
 * needs an AppKit application, so this may only be called after
 * app.whenReady().
 */
function instance(): Promise<Driver> {
  driver ??= (async () => {
    const sdk = await import('@trycua/cua-driver');
    await sdk.uniffiInitAsync();
    // Standard mode: the driver enforces its routine-operation ceiling, and
    // Buddy's own risk gates and confirmations sit above it.
    const started = sdk.CuaDriver.createConfigured({
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [sdk.SessionPermissionMode.Standard],
        compatibilityMode: sdk.SessionPermissionMode.Standard,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: BigInt(SESSION_TTL_SECONDS),
        maxIdleTtlSeconds: BigInt(IDLE_TTL_SECONDS),
      },
    }) as unknown as Driver;
    log.info('driver started');
    return started;
  })();
  return driver;
}

/** Open a session. `label` only has to be short and recognisable in logs. */
export async function openSession(label: string): Promise<DriverSession> {
  const live = await instance();
  const session = `${label}-${Date.now()}`;
  await live.callTool('start_session', JSON.stringify({ session }));
  log.info(`session ${session} started`);

  return {
    call: (tool, args) => live.callTool(tool, JSON.stringify({ session, ...args })),
    async end(): Promise<void> {
      try {
        await live.callTool('end_session', JSON.stringify({ session }));
        log.info(`session ${session} ended`);
      } catch (error) {
        log.warn(`ending session ${session} failed: ${String(error)}`);
      }
    },
  };
}

/** Shut the driver down for good. Only the app's own quit should call this. */
export async function shutdownDriver(): Promise<void> {
  if (!driver) return;
  const live = driver;
  driver = null;
  try {
    await (await live).shutdown();
    log.info('driver shut down');
  } catch (error) {
    log.warn(`shutting the driver down failed: ${String(error)}`);
  }
}
