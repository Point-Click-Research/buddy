import { describe, expect, it } from 'vitest';
import { descriptionToTask, taskToDescription } from '../src/main/mcp/plan-text';
import { buildToolNameMap, sanitizeNamePart } from '../src/main/mcp/naming';
import { allowedInAirplaneMode, decidePermission, defaultPermission, parseYesNo } from '../src/main/mcp/permissions';
import { toToolOutcome } from '../src/main/mcp/results';
import { dialedPhone, exposesTool, isOutboundBlandCall, outboundCallNote, withGreetingWait, blandProxyUrl } from '../src/main/mcp/bland-call';
import { exaProxyUrl, missingBuiltinServers } from '../src/main/mcp/builtin';
import { describeArgs, humanize, toolConfirmCard } from '../src/main/mcp/tool-card';
import { splitConnectAppTool } from '../src/shared/connect-apps';

describe('plan approval draft parsing', () => {
  it('splits a description into a goal and steps', () => {
    expect(descriptionToTask('Open Messages\n2. Find Sanna\nSend the joke')).toEqual({
      goal: 'Open Messages',
      steps: ['Find Sanna', 'Send the joke'],
    });
  });

  it('numbers the steps under the goal and reads them back', () => {
    const task = { goal: 'Add the socks to the cart', steps: ['Click Add to Cart', 'Review the cart'] };
    expect(taskToDescription(task)).toBe('Add the socks to the cart\n\n1. Click Add to Cart\n2. Review the cart');
    expect(descriptionToTask(taskToDescription(task))).toEqual(task);
  });

  it('round-trips a task with no extra steps', () => {
    expect(taskToDescription({ goal: 'Send Sanna a message', steps: [] })).toBe('Send Sanna a message');
    expect(descriptionToTask('Send Sanna a message')).toEqual({
      goal: 'Send Sanna a message',
      steps: [],
    });
  });
});

// Airplane mode grounds the servers Buddy would reach over the internet;
// local processes (stdio) and loopback HTTP stay available.
describe('allowedInAirplaneMode', () => {
  it('allows stdio and loopback HTTP, blocks remote HTTP', () => {
    expect(allowedInAirplaneMode('stdio', '')).toBe(true);
    expect(allowedInAirplaneMode('http', 'http://localhost:8931/mcp')).toBe(true);
    expect(allowedInAirplaneMode('http', 'http://127.0.0.1:3000')).toBe(true);
    expect(allowedInAirplaneMode('http', 'http://[::1]:3000/mcp')).toBe(true);
    expect(allowedInAirplaneMode('http', 'https://mcp.exa.ai/mcp')).toBe(false);
    expect(allowedInAirplaneMode('http', 'https://mcp.context7.com/mcp')).toBe(false);
    expect(allowedInAirplaneMode('http', 'not a url')).toBe(false);
  });
});

describe('tool name sanitizing and mapping', () => {
  it('replaces disallowed characters and trims edge underscores', () => {
    expect(sanitizeNamePart('Exa Search!')).toBe('Exa_Search');
    expect(sanitizeNamePart('web.search (fast)')).toBe('web_search_fast');
    expect(sanitizeNamePart('***')).toBe('tool');
  });

  it('builds <server>__<tool> names mapped back to the real names', () => {
    const map = buildToolNameMap([
      { serverId: 's1', serverName: 'Exa Search', toolNames: ['web_search_exa', 'get contents'] },
    ]);
    expect(map.get('Exa_Search__web_search_exa')).toEqual({ serverId: 's1', toolName: 'web_search_exa' });
    expect(map.get('Exa_Search__get_contents')).toEqual({ serverId: 's1', toolName: 'get contents' });
  });

  it('caps names at 64 characters', () => {
    const map = buildToolNameMap([
      { serverId: 's1', serverName: 'a'.repeat(60), toolNames: ['b'.repeat(60)] },
    ]);
    const [name] = [...map.keys()];
    expect(name!.length).toBe(64);
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('resolves collisions with numeric suffixes, still within 64 chars', () => {
    const map = buildToolNameMap([
      { serverId: 's1', serverName: 'exa', toolNames: ['search'] },
      { serverId: 's2', serverName: 'exa', toolNames: ['search'] },
      { serverId: 's3', serverName: 'exa!', toolNames: ['search'] }, // sanitizes to the same name
    ]);
    expect(map.get('exa__search')).toEqual({ serverId: 's1', toolName: 'search' });
    expect(map.get('exa__search_2')).toEqual({ serverId: 's2', toolName: 'search' });
    expect(map.get('exa__search_3')).toEqual({ serverId: 's3', toolName: 'search' });
    for (const name of map.keys()) expect(name.length).toBeLessThanOrEqual(64);
  });
});

describe('tool result conversion and truncation', () => {
  it('returns a single text result as a plain string', () => {
    const outcome = toToolOutcome({ content: [{ type: 'text', text: 'hello' }] }, 100);
    expect(outcome).toEqual({ content: 'hello' });
  });

  it('truncates long text and appends a note', () => {
    const outcome = toToolOutcome({ content: [{ type: 'text', text: 'x'.repeat(500) }] }, 100);
    const text = outcome.content as string;
    expect(text.startsWith('x'.repeat(100))).toBe(true);
    expect(text).toContain('[Result truncated: showing 100 of 500 characters.]');
  });

  it('passes images through as image blocks alongside text', () => {
    const outcome = toToolOutcome(
      {
        content: [
          { type: 'text', text: 'a chart' },
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
        ],
      },
      100,
    );
    expect(outcome.content).toEqual([
      { type: 'text', text: 'a chart' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
    ]);
  });

  it('replaces unsupported content with a note', () => {
    const outcome = toToolOutcome(
      { content: [{ type: 'image', data: 'x', mimeType: 'image/tiff' }, { type: 'resource' }] },
      100,
    );
    expect(outcome.content).toBe(
      '[unsupported image content omitted]\n[unsupported resource content omitted]',
    );
  });

  it('marks errors and handles empty results', () => {
    expect(toToolOutcome({ content: [], isError: true }, 100)).toEqual({
      content: '(empty result)',
      isError: true,
    });
  });
});

describe('outbound Bland calls', () => {
  const bland = { enabled: true, name: 'bland', url: 'https://api.bland.ai/v1/mcp' };

  it('recognizes Bland call tools and ignores everything else', () => {
    expect(isOutboundBlandCall(bland, 'create_call')).toBe(true);
    expect(isOutboundBlandCall(bland, 'send_call')).toBe(true);
    expect(isOutboundBlandCall(bland, 'get_call_log')).toBe(false);
    expect(isOutboundBlandCall({ ...bland, enabled: false }, 'create_call')).toBe(false);
    expect(isOutboundBlandCall({ enabled: true, name: 'exa', url: 'https://mcp.exa.ai' }, 'create_call')).toBe(false);
  });

  // Bland's server lists 53 tools, buy_credits and delete_agent among them,
  // and every exposed one rides in every request.
  it('exposes only the calling tools from Bland, and everything from other servers', () => {
    for (const name of ['create_call', 'wait_for_call', 'get_call_log', 'stop_call']) {
      expect(exposesTool(bland, name)).toBe(true);
    }
    for (const name of ['buy_credits', 'buy_phone_plan', 'delete_agent', 'list_voices']) {
      expect(exposesTool(bland, name)).toBe(false);
    }
    expect(exposesTool({ enabled: true, name: 'exa', url: 'https://mcp.exa.ai' }, 'agent_run')).toBe(true);
  });

  it('waits for the person who answered, on the field name that tool uses', () => {
    expect(withGreetingWait(bland, 'create_call', { phone_number: '+1', wait_for_greeting: false })).toEqual({
      phone_number: '+1',
      wait_for_greeting: true,
    });
    // Bland's current MCP tool is camelCase (phoneNumber), and the model often omits the wait.
    expect(withGreetingWait(bland, 'create_call', { phoneNumber: '+1', task: 'Ask about a jacket' })).toEqual({
      phoneNumber: '+1',
      task: 'Ask about a jacket',
      waitForGreeting: true,
    });
    expect(
      withGreetingWait(bland, 'create_call', { phoneNumber: '+1' }, { properties: { wait_for_greeting: {} } }),
    ).toEqual({ phoneNumber: '+1', wait_for_greeting: true });
    // A closed schema that doesn't list the wait can't take an extra field.
    expect(
      withGreetingWait(
        bland,
        'create_call',
        { phoneNumber: '+1' },
        { properties: { phoneNumber: {} }, additionalProperties: false },
      ),
    ).toEqual({ phoneNumber: '+1' });
    expect(withGreetingWait(bland, 'get_call_log', { call_id: 'abc' })).toEqual({ call_id: 'abc' });
    expect(withGreetingWait(bland, 'create_call', null)).toBeNull();
  });

  it('reads the number from whichever field the tool used', () => {
    expect(dialedPhone({ phone_number: ' +14155551234 ' })).toEqual({ key: 'phone_number', number: '+14155551234' });
    expect(dialedPhone({ phoneNumber: '+14155551234' })).toEqual({ key: 'phoneNumber', number: '+14155551234' });
  });

  it('tells the model the agent does not open over the person who picked up', () => {
    expect(outboundCallNote(bland, 'create_call')).toMatch(/waits until the person who answered speaks/i);
    expect(outboundCallNote(bland, 'send_sms')).toBe('');
  });

  it('sends a keyless Bland server through Buddy and leaves a pasted key on Bland', () => {
    const server = { name: 'bland', url: 'https://api.bland.ai/v1/mcp', headers: {} };
    expect(blandProxyUrl(server, 'http://127.0.0.1:8787', true)).toBe('http://127.0.0.1:8787/v1/bland/v1/mcp');
    expect(blandProxyUrl(server, 'http://127.0.0.1:8787', false)).toBeNull();
    expect(blandProxyUrl({ ...server, headers: { Authorization: 'Bearer org-key' } }, 'http://127.0.0.1:8787', true)).toBeNull();
  });
});

describe('builtin search and phone', () => {
  it('adds a keyless server only when Buddy holds that key and none is saved', () => {
    expect(missingBuiltinServers([], ['bland', 'exa'])).toEqual([
      { name: 'bland', url: 'https://api.bland.ai/v1/mcp' },
      { name: 'exa', url: 'https://mcp.exa.ai/mcp' },
    ]);
    expect(missingBuiltinServers([{ name: 'exa', url: 'https://mcp.exa.ai/mcp' }], ['exa'])).toEqual([]);
    expect(missingBuiltinServers([], [])).toEqual([]);
  });

  it('points a keyless Exa server at Buddy and leaves a pasted key on Exa', () => {
    const server = { name: 'exa', url: 'https://mcp.exa.ai/mcp', headers: {} };
    expect(exaProxyUrl(server, 'http://127.0.0.1:8787', true)).toBe('http://127.0.0.1:8787/v1/exa-mcp/mcp');
    expect(exaProxyUrl(server, 'http://127.0.0.1:8787', false)).toBeNull();
    expect(exaProxyUrl({ ...server, headers: { 'x-api-key': 'user-key' } }, 'http://127.0.0.1:8787', true)).toBeNull();
  });
});

describe('tool confirmation card', () => {
  it('humanizes snake, SCREAMING, and camel case names', () => {
    expect(humanize('create_call')).toBe('create call');
    expect(humanize('SEND_EMAIL')).toBe('send email');
    expect(humanize('createCalendarEvent')).toBe('create calendar event');
  });

  it('asks in plain language with the arguments as labelled lines', () => {
    const card = toolConfirmCard('bland', 'create_call', {
      phone_number: '+14155551234',
      task: 'Ask if the\n  blue jacket is in stock',
      voice: 'june',
      confirm: true,
      pathway_id: '',
      metadata: null,
    });
    expect(card.title).toBe("Create call with Buddy's Phone?");
    expect(card.detail).toBe(
      '**Phone number**: +14155551234\n**Task**: Ask if the blue jacket is in stock\n**Voice**: june\n**Confirm**: Yes',
    );
  });

  it('nests objects and joins flat arrays', () => {
    expect(describeArgs({ to: ['a@x.com', 'b@x.com'], options: { cc: 'c@x.com' } })).toBe(
      '**To**: a@x.com, b@x.com\n**Options**\n    **Cc**: c@x.com',
    );
    expect(describeArgs('not an object')).toBe('');
    // A long list reads as its count.
    expect(describeArgs({ labels: Array.from({ length: 58 }, (_, i) => `l${i}`) })).toBe('**Labels**: 58 items');
  });

  it('never shows ids or machine tokens, and prefers the plain summary', () => {
    const args = { calendar_id: 'primary', event_id: '05881ia9kh8udlg45cdvfqfd6l', sendUpdates: 'all' };
    expect(describeArgs(args)).toBe('**Send updates**: all');
    expect(describeArgs({ calendarId: 'primary', ref: 'a1b2c3d4e5f6g7h8i9' })).toBe('');
    const card = toolConfirmCard('googlecalendar', 'DELETE_EVENT', args, 'Delete "Endear Enablement Session" on Oct 2 at 2pm.');
    expect(card.detail).toBe('Delete "Endear Enablement Session" on Oct 2 at 2pm.');
  });

  it('clips long values and long argument lists', () => {
    const card = toolConfirmCard('x', 'y', { a: 'z'.repeat(500), b: 'w'.repeat(500) });
    expect(card.detail.length).toBeLessThanOrEqual(701);
    expect(card.detail).toContain('…');
  });

  it('splits Composio tool slugs into app label and action', () => {
    expect(splitConnectAppTool('GMAIL_SEND_EMAIL')).toEqual(['Gmail', 'SEND_EMAIL']);
    expect(splitConnectAppTool('GOOGLE_MAPS_TEXT_SEARCH')).toEqual(['Google Maps', 'TEXT_SEARCH']);
    expect(splitConnectAppTool('ACME_DO_THING')).toEqual(['ACME', 'DO_THING']);
    expect(splitConnectAppTool('ACME')).toEqual(['ACME', 'ACME']);
  });
});

describe('permission decisions', () => {
  it('defaults read-only tools to allow and everything else to ask', () => {
    expect(defaultPermission({ readOnlyHint: true })).toBe('allow');
    expect(defaultPermission({ readOnlyHint: false })).toBe('ask');
    expect(defaultPermission({})).toBe('ask');
    expect(defaultPermission(undefined)).toBe('ask');
  });

  it('lets the user override the default in both directions', () => {
    expect(decidePermission('deny', { readOnlyHint: true })).toBe('deny');
    expect(decidePermission('allow', undefined)).toBe('allow');
    expect(decidePermission(undefined, { readOnlyHint: true })).toBe('allow');
  });

  it('parses spoken yes/no answers', () => {
    expect(parseYesNo('Yes, go ahead.')).toBe(true);
    expect(parseYesNo('OKAY')).toBe(true);
    expect(parseYesNo('sure')).toBe(true);
    expect(parseYesNo('No thanks')).toBe(false);
    expect(parseYesNo("Don't do that")).toBe(false);
    expect(parseYesNo('hmm let me think')).toBe(null);
    expect(parseYesNo('')).toBe(null);
  });
});
