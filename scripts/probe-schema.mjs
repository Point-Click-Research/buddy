// Print the driver's real schemas for the browser tools Buddy calls, so the
// browser family is written against the API rather than assumptions.

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

const raw = await driver.listToolsJson();
const parsed = JSON.parse(raw);
const tools = parsed.tools ?? parsed;
const wanted = process.argv[2] ?? 'browser';

for (const tool of tools) {
  if (!tool.name.includes(wanted)) continue;
  const schema = tool.inputSchema ?? tool.input_schema ?? {};
  const props = Object.entries(schema.properties ?? {}).map(
    ([k, v]) => `${k}: ${v.type ?? '?'}${(schema.required ?? []).includes(k) ? ' (required)' : ''}`,
  );
  console.log(`\n=== ${tool.name}`);
  console.log((tool.description ?? '').split('\n')[0].slice(0, 200));
  console.log(props.join('\n'));
}
await driver.shutdown().catch(() => {});
