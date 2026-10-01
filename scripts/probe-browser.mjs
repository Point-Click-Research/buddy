// Live probe of the browser family against the real Cua driver. Not part of
// the test suite: it launches a real browser and needs the driver's macOS
// permissions. Run with `node scripts/probe-browser.mjs`.

const PROFILE = { mode: 'isolated_named', name: 'buddy' };
const PAGE = process.argv[2] ?? 'https://example.com';

const sdk = await import('@trycua/cua-driver');
await sdk.uniffiInitAsync();
const driver = sdk.CuaDriver.createConfigured({
  claudeCodeCompatibility: false,
  authorization: {
    allowedModes: [sdk.SessionPermissionMode.Standard],
    compatibilityMode: sdk.SessionPermissionMode.Standard,
    unrestrictedAcknowledged: false,
    maxSessionTtlSeconds: BigInt(600),
    maxIdleTtlSeconds: BigInt(300),
  },
});

const session = `probe-${Date.now()}`;
const call = async (tool, args = {}, quiet = false) => {
  const raw = await driver.callTool(tool, JSON.stringify({ session, ...args }));
  const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (quiet) return result.structuredJson ? JSON.parse(result.structuredJson) : null;
  console.log(`\n=== ${tool}`);
  console.log('isError:', result.isError, '| errorCode:', result.errorCode ?? '-');
  if (result.text) console.log('text:', result.text.slice(0, 400));
  // The SDK hands back structuredContent as a JSON string, not an object.
  const structured = result.structuredJson ? JSON.parse(result.structuredJson) : null;
  if (structured) console.log('structured:', JSON.stringify(structured).slice(0, 700));
  return structured;
};

await driver.callTool('start_session', JSON.stringify({ session }));
try {
  let prepared = await call('browser_prepare', { allow_launch: true, profile: PROFILE });
  if (prepared?.refusal?.code === 'browser_endpoint_owner_mismatch') {
    // Mirror production: end the browser stranded by an earlier run.
    const { readlinkSync } = await import('fs');
    const dir = `${process.env.HOME}/Library/Application Support/CuaDriver/BrowserProfiles/buddy`;
    const pid = Number(readlinkSync(`${dir}/SingletonLock`).split('-').pop());
    console.log('\nreclaiming stranded browser pid', pid);
    await call('kill_app', { pid });
    await new Promise((r) => setTimeout(r, 500));
    prepared = await call('browser_prepare', { allow_launch: true, profile: PROFILE });
  }
  if (!prepared || prepared.status === 'refused') {
    console.log('\nRESULT: refused — Buddy falls back to the visible browser.');
    process.exit(1);
  }

  // Mirror production: bind by the pid browser_prepare reports, then work
  // through target_id + tab_id exactly as cua-browser.ts does.
  const pid = prepared.prepared_pid ?? prepared.endpoint_ownership?.owner_pid;
  console.log('\nprepared pid:', pid);

  // Mirror production: try every candidate window until one binds, since a
  // launching browser shows its window before the CDP target attaches.
  let state, win;
  for (let i = 0; i < 20 && !state; i++) {
    const windows = await call('list_windows', {}, true);
    const candidates = (windows?.windows ?? []).filter(
      (w) =>
        w.pid === pid &&
        w.bounds.width >= 120 &&
        w.bounds.height >= 120 &&
        (w.is_on_screen || w.title !== ''),
    );
    for (const w of candidates) {
      const r = await call('get_browser_state', { pid, window_id: w.window_id }, true);
      if (r?.status !== 'refused') {
        state = r;
        win = w;
        break;
      }
    }
    if (!state) await new Promise((r) => setTimeout(r, 500));
  }
  console.log('bound window:', win?.window_id, '| app:', win?.app_name);

  const targetId = JSON.stringify(state).match(/"target_id":"([^"]+)"/)?.[1];
  const tabId = JSON.stringify(state).match(/"tab_id":"([^"]+)"/)?.[1];
  console.log('\nbound target:', targetId, '| tab:', tabId);

  await call('browser_navigate', { target_id: targetId, tab_id: tabId, url: PAGE });
  const snap = await call('get_browser_state', {
    target_id: targetId,
    tab_id: tabId,
    snapshot_format: 'semantic_v2',
  });

  // Clicking and scrolling are the actions that have to stay in the
  // background, so prove each route on a page with a real link.
  const ref = (snap?.refs ?? []).find((r) => r.actions?.includes('click'))?.ref;
  console.log('\nclickable ref:', ref);
  if (ref) {
    await call('browser_click', { target_id: targetId, tab_id: tabId, ref });
    await call('browser_click', {
      target_id: targetId,
      tab_id: tabId,
      ref,
      input_route: 'dom_event',
    });
  }
  // Scroll: which route survives background posture?
  await call('browser_pointer', {
    target_id: targetId,
    tab_id: tabId,
    action: 'scroll',
    x: 400,
    y: 300,
    delta_y: 240,
  });
  if (ref) {
    await call('browser_pointer', {
      target_id: targetId,
      tab_id: tabId,
      action: 'scroll',
      ref,
      delta_y: 240,
      input_route: 'dom_event',
    });
  }
  console.log('\nRESULT: browser family is live.');
} finally {
  await driver.callTool('end_session', JSON.stringify({ session })).catch(() => {});
  await driver.shutdown().catch(() => {});
}
