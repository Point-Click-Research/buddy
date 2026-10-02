import { useEffect, useState, type ReactElement } from 'react';
import { isExaServer } from '../../../shared/search-servers';
import { BUILTIN_TOOLS, isBlandServer, mcpServerLabel } from '../../../shared/types';
import type { McpServerDraft, McpServerView, ToolPermission } from '../../../shared/types';
import { buddy } from '../../buddy';
import { useAccount } from '../../shared/account-data';
import {
  Actions,
  Button,
  Card,
  LinkButton,
  MenuSelect,
  Modal,
  Note,
  SectionHeader,
  SiteIcon,
  Subform,
  SwitchInput,
  Table,
  TableRow,
  Textarea,
  TextInput,
} from '../../ui';
import { clampNumber, useSettings } from '../context';

/** The site a server's favicon comes from; a stdio server falls back to its name's letter mark. */
function serverHost(url: string, name: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return name;
  }
}

/** A hosted server the gallery can add in one click; keys are optional extras. */
interface RecommendedServer {
  label: string;
  blurb: string;
  name: string;
  url: string;
  /** Header an API key goes in; absent means there is nothing to ask for. */
  keyHeader?: string;
  /** Prepended to the pasted key (e.g. "Bearer "). */
  authPrefix?: string;
  keyBlurb?: string;
  /** The server does nothing without a key, so Add waits for one. */
  keyRequired?: boolean;
}

// Exa and Bland are the servers Buddy's account adds keyless; once one is
// configured (by the account or by hand) it drops out of this list.
const RECOMMENDED: RecommendedServer[] = [
  {
    label: 'Exa',
    blurb: 'Web, product, and place search.',
    name: 'exa',
    url: 'https://mcp.exa.ai/mcp',
    keyHeader: 'x-api-key',
    keyBlurb: 'Web search, plus product and place search. Get a key at dashboard.exa.ai.',
    keyRequired: true,
  },
  {
    label: 'Bland',
    blurb: 'Phone calls Buddy places for you.',
    name: 'bland',
    url: 'https://api.bland.ai/v1/mcp',
    keyHeader: 'Authorization',
    keyBlurb: 'Lets Buddy call places for you. Get a key at app.bland.ai.',
    keyRequired: true,
  },
  {
    label: 'Context7',
    blurb: 'Fresh docs for dev libraries.',
    name: 'context7',
    url: 'https://mcp.context7.com/mcp',
    keyHeader: 'CONTEXT7_API_KEY',
    keyBlurb: 'Adds Context7 docs. API key optional.',
  },
];

const sameServer =
  (rec: RecommendedServer) =>
  (server: McpServerView): boolean =>
    server.name === rec.name || server.url === rec.url;

const EMPTY: McpServerDraft = {
  name: '',
  transport: 'http',
  enabled: true,
  url: '',
  headers: {},
  command: '',
  args: [],
  env: {},
};

/** Prefix a pasted key without doubling "Bearer " if the user already typed it. */
function withAuthPrefix(prefix: string | undefined, key: string): string {
  const trimmed = key.trim();
  if (!prefix) return trimmed;
  const already = prefix.trim();
  if (already && trimmed.toLowerCase().startsWith(already.toLowerCase())) return trimmed;
  return `${prefix}${trimmed}`;
}

function parseLines(text: string, separator: ':' | '='): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    if (name) record[name] = line.slice(index + 1).trim();
  }
  return record;
}

function formatLines(record: Record<string, string>, separator: ': ' | '='): string {
  return Object.entries(record)
    .map(([name, value]) => `${name}${separator}${value}`)
    .join('\n');
}

type SubformKind = 'editor' | 'recommended' | 'import' | null;

/** The abilities that ship with Buddy, and how terminal commands are approved. */
export function NativeToolsPage(): ReactElement {
  const { view, patch } = useSettings();
  const disabledTools = view.settings.disabledBuiltinTools;

  return (
    <>
      <SectionHeader
        title="Built-in Tools"
        description="Built-in abilities. Disabled tools are hidden from Buddy."
      />
      <Table columns={[{ key: '#', label: '#' }, { key: 'main', label: 'Tool' }, { key: 'action', label: '' }]}>
        {BUILTIN_TOOLS.map((tool, index) => {
          const disabled = disabledTools.includes(tool.id);
          return (
            <TableRow
              key={tool.id}
              index={index + 1}
              main={
                <>
                  {tool.label}
                  {disabled && <span className="text-faint"> · disabled</span>}
                </>
              }
              detail={tool.description}
              action={
                <LinkButton
                  onClick={() =>
                    void patch({
                      disabledBuiltinTools: disabled
                        ? disabledTools.filter((id) => id !== tool.id)
                        : [...disabledTools, tool.id],
                    })
                  }
                >
                  {disabled ? 'Enable' : 'Disable'}
                </LinkButton>
              }
            />
          );
        })}
      </Table>
      <Note>
        Messages, Mail, Notes, Contacts, and browser need one-time macOS approval per app. To fix a denial: System Settings → Privacy & Security →{' '}
        <LinkButton tone="ink" onClick={() => void buddy.requestPermission('automation')}>
          Automation
        </LinkButton>
        .
      </Note>

      <SectionHeader
        title="Terminal command approval"
        description="Confirm before shell commands. Risky mode auto-runs safe ones; destructive commands always need approval or are blocked."
      />
      <Card>
        <MenuSelect
          label="Ask before running"
          value={view.settings.runCommandApproval}
          onSelect={(value) => void patch({ runCommandApproval: value })}
          options={[
            { value: 'always', label: 'Every command' },
            { value: 'risky', label: 'Only risky commands' },
          ]}
        />
      </Card>

      <SectionHeader
        title="Coding workspace"
        description="Folder Coding tools can touch. Outside it (and .env inside) is blocked. Auto-detect uses the frontmost editor project; fixed folder is fallback."
      />
      <Card>
        <SwitchInput
          label="Auto-detect from the frontmost coding window"
          checked={view.settings.codingWorkspaceAuto}
          onChange={(checked) => void patch({ codingWorkspaceAuto: checked })}
        />
        <TextInput
          label={view.settings.codingWorkspaceAuto ? 'Fallback folder' : 'Workspace folder'}
          placeholder="/Users/you/projects/my-app"
          value={view.settings.codingWorkspaceRoot}
          onChange={(event) => void patch({ codingWorkspaceRoot: event.target.value })}
          action={{
            label: 'Choose…',
            onClick: () => {
              void buddy.chooseFolder().then((folder) => {
                if (folder) void patch({ codingWorkspaceRoot: folder });
              });
            },
          }}
        />
        <MenuSelect
          label="Ask before changing files"
          value={view.settings.codingEditApproval}
          onSelect={(value) => void patch({ codingEditApproval: value })}
          options={[
            { value: 'always', label: 'Every change' },
            { value: 'risky', label: 'Only replacing a whole file' },
            { value: 'auto', label: 'Never: edits run freely' },
          ]}
        />
        <SwitchInput
          label="Show each change as a diff in your editor"
          checked={view.settings.codingShowDiffs}
          onChange={(checked) => void patch({ codingShowDiffs: checked })}
        />
      </Card>
    </>
  );
}

/** Last list so Skills ↔ MCP Servers does not flash an empty page. */
let lastServers: McpServerView[] = [];

/** Connected MCP servers: the list, the editor, the gallery, the result limit. */
export function McpServersPage(): ReactElement {
  const { view, patch } = useSettings();
  const own = useAccount()?.configured === false;
  const [servers, setServersState] = useState<McpServerView[]>(lastServers);
  const setServers = (next: McpServerView[]): void => {
    lastServers = next;
    setServersState(next);
  };
  const [subform, setSubform] = useState<SubformKind>(null);
  const [draft, setDraft] = useState<McpServerDraft>(EMPTY);
  const [headers, setHeaders] = useState('');
  const [env, setEnv] = useState('');
  const [args, setArgs] = useState('');
  const [picked, setPicked] = useState<RecommendedServer | null>(null);
  const [pickedKey, setPickedKey] = useState('');
  const [importJson, setImportJson] = useState('');
  const [message, setMessage] = useState('');

  const addRecommended = (rec: RecommendedServer, key: string): void => {
    void buddy
      .saveMcpServer({
        id: servers.find(sameServer(rec))?.id,
        name: rec.name,
        transport: 'http',
        enabled: true,
        url: rec.url,
        headers:
          rec.keyHeader && key.trim()
            ? { [rec.keyHeader]: withAuthPrefix(rec.authPrefix, key) }
            : {},
        command: '',
        args: [],
        env: {},
      })
      .then((next) => {
        setServers(next);
        setPicked(null);
        setPickedKey('');
        setSubform(null);
      });
  };

  useEffect(() => {
    void buddy.getMcpServers().then(setServers);
    buddy.onMcpServersChanged(setServers);
  }, []);

  const openEditor = (server?: McpServerView): void => {
    setDraft(
      server
        ? {
          id: server.id,
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          url: server.url,
          headers: server.headers,
          command: server.command,
          args: server.args,
          env: server.env,
        }
        : EMPTY,
    );
    setHeaders(formatLines(server?.headers ?? {}, ': '));
    setEnv(formatLines(server?.env ?? {}, '='));
    setArgs((server?.args ?? []).join(' '));
    setSubform('editor');
    setMessage('');
  };

  const statusClass = (status: McpServerView['status']): string =>
    status === 'connected' ? 'text-ok' : status === 'error' ? 'text-danger' : 'text-muted';

  // Search and phone calls are included with the account. A copy the user
  // gave their own key is the only one that belongs on this page.
  const listed = servers.filter((server) => {
    const builtin = isBlandServer({ ...server, enabled: true }) || isExaServer(server);
    if (!builtin) return true;
    return Object.values(server.headers).some((value) => value.trim().length > 0);
  });
  // Without an account a hidden keyless builtin does nothing, so it shouldn't block adding a keyed one.
  const configured = own ? listed : servers;
  const suggestions = RECOMMENDED.filter((rec) => !configured.some(sameServer(rec)));

  return (
    <>
      <SectionHeader
        title="MCP servers"
        description={`Servers you add. ${own ? 'Add Exa for web search and Bland for phone calls below.' : 'Web search and phone calls are already included.'}`}
      />

      {listed.map((server) => (
        <div key={server.id} className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <SiteIcon host={serverHost(server.url, server.name)} />
              <span className="font-medium">{mcpServerLabel(server)}</span>
              <span className={`text-[12px] ${statusClass(server.status)}`}>
                {server.status.charAt(0).toUpperCase() + server.status.slice(1)}
              </span>
            </span>
            <span className="flex items-center gap-1 text-[12px] font-regular text-muted">
              <LinkButton
                onClick={() => void buddy.saveMcpServer({ ...server, enabled: !server.enabled }).then(setServers)}
              >
                {server.enabled ? 'Disable' : 'Enable'}
              </LinkButton>
              ·
              <LinkButton onClick={() => openEditor(server)}>Edit</LinkButton>
              ·
              <LinkButton tone="danger" onClick={() => void buddy.removeMcpServer(server.id).then(setServers)}>
                Remove
              </LinkButton>
            </span>
          </div>
          {server.error ? <p className="mb-2 text-[12px] text-danger">{server.error}</p> : null}
          {server.tools.length > 0 && (
            <Table
              columns={[
                { key: '#', label: '#' },
                { key: 'main', label: 'Tool name' },
                { key: 'action', label: '' },
              ]}
            >
              {server.tools.map((tool, index) => (
                <TableRow
                  key={tool.name}
                  index={index + 1}
                  main={tool.name}
                  title={`${tool.exposedName}: ${tool.description}`}
                  action={
                    <MenuSelect
                      compact
                      value={tool.permission as ToolPermission}
                      onSelect={(permission) => {
                        void buddy.setMcpToolPermission(server.id, tool.name, permission).then(setServers);
                      }}
                      options={[
                        { value: 'allow', label: 'Allow' },
                        { value: 'ask', label: 'Ask' },
                        { value: 'deny', label: 'Deny' },
                      ]}
                    />
                  }
                />
              ))}
            </Table>
          )}
        </div>
      ))}

      <Actions align="start">
        <Button onClick={() => openEditor()}>Add Server</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setSubform('import');
            setMessage('');
          }}
        >
          Import JSON
        </Button>
      </Actions>

      {subform === 'recommended' && picked && (
        <Subform>
          <p className="text-[13px] leading-5 text-muted">{picked.keyBlurb}</p>
          <TextInput
            type="password"
            placeholder={`${picked.label} API key${picked.keyRequired ? '' : ' (optional)'}`}
            value={pickedKey}
            onChange={(event) => setPickedKey(event.target.value)}
            action={{
              label: 'Add',
              disabled: picked.keyRequired && !pickedKey.trim(),
              onClick: () => addRecommended(picked, pickedKey),
            }}
          />
          <Actions>
            <Button variant="secondary" onClick={() => setSubform(null)}>
              Cancel
            </Button>
          </Actions>
        </Subform>
      )}

      {subform === 'import' && (
        <Subform>
          <p className="text-[13px] leading-5 text-muted">
            Paste a Claude Desktop-style <code className="font-mono text-[12px] text-muted">mcpServers</code> JSON
            block.
          </p>
          <Textarea
            mono
            rows={6}
            placeholder='{"mcpServers": {"exa": {"url": "https://mcp.exa.ai/mcp"}}}'
            value={importJson}
            onChange={(event) => setImportJson(event.target.value)}
          />
          <Actions>
            <Button
              onClick={async () => {
                const result = await buddy.importMcpServers(importJson);
                setServers(await buddy.getMcpServers());
                if (result.added > 0) setImportJson('');
                if (result.added > 0 || result.errors.length > 0) {
                  setSubform(result.errors.length > 0 ? 'import' : null);
                  setMessage(
                    [`Imported ${result.added} server${result.added === 1 ? '' : 's'}.`, ...result.errors].join(' '),
                  );
                }
              }}
            >
              Import
            </Button>
            <Button variant="secondary" onClick={() => setSubform(null)}>
              Cancel
            </Button>
          </Actions>
        </Subform>
      )}

      {subform === 'editor' && (
        <Modal title={draft.id ? `Edit ${draft.name || 'Server'}` : 'Add Server'} onClose={() => setSubform(null)}>
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              const next: McpServerDraft = {
                ...draft,
                name: draft.name.trim(),
                url: draft.url.trim(),
                headers: parseLines(headers, ':'),
                command: draft.command.trim(),
                args: args.trim().split(/\s+/).filter(Boolean),
                env: parseLines(env, '='),
              };
              if (!next.name || (next.transport === 'http' ? !next.url : !next.command)) {
                setMessage('A name and a URL (HTTP) or command (stdio) are required.');
                return;
              }
              void buddy.saveMcpServer(next).then((views) => {
                setServers(views);
                setSubform(null);
              });
            }}
          >
            <TextInput
              label="Name"
              placeholder="exa"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <MenuSelect
              label="Transport"
              value={draft.transport}
              onSelect={(transport) => setDraft({ ...draft, transport })}
              options={[
                { value: 'http', label: 'HTTP (remote server)' },
                { value: 'stdio', label: 'stdio (local command)' },
              ]}
            />
            {draft.transport === 'http' ? (
              <>
                <TextInput
                  label="URL"
                  placeholder="https://mcp.exa.ai/mcp"
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
                <Textarea
                  label={
                    <>
                      Headers (one per line, <code className="font-mono text-[12px] text-muted">Name: value</code>)
                    </>
                  }
                  mono
                  rows={3}
                  placeholder="x-api-key: YOUR_KEY"
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                />
              </>
            ) : (
              <>
                <p className="text-[13px] leading-5 text-warn">
                  ⚠ stdio runs a local program as you. Only add commands you trust.
                </p>
                <TextInput
                  label="Command"
                  placeholder="npx"
                  value={draft.command}
                  onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                />
                <TextInput
                  label="Arguments (space-separated)"
                  placeholder="-y exa-mcp-server"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
                <Textarea
                  label={
                    <>
                      Environment (one per line, <code className="font-mono text-[12px] text-muted">NAME=value</code>)
                    </>
                  }
                  mono
                  rows={3}
                  placeholder="EXA_API_KEY=YOUR_KEY"
                  value={env}
                  onChange={(event) => setEnv(event.target.value)}
                />
              </>
            )}
            <SwitchInput
              label="Enabled"
              checked={draft.enabled}
              onChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />
            <Actions>
              <Button type="submit">Save Server</Button>
              <Button variant="secondary" onClick={() => setSubform(null)}>
                Cancel
              </Button>
            </Actions>
            <Note>{message}</Note>
          </form>
        </Modal>
      )}
      {subform !== 'editor' && <Note>{message}</Note>}

      {suggestions.length > 0 && (
        <>
          <SectionHeader title="Recommended" description="One-click hosted servers." />
          <Table
            columns={[
              { key: '#', label: '#' },
              { key: 'main', label: 'Server name' },
              { key: 'action', label: '' },
            ]}
          >
            {suggestions.map((rec, index) => (
              <TableRow
                key={rec.name}
                index={index + 1}
                main={
                  <span className="flex items-center gap-2">
                    <SiteIcon host={serverHost(rec.url, rec.name)} />
                    {rec.label}
                  </span>
                }
                title={rec.blurb}
                action={
                  <LinkButton
                    tone="ink"
                    onClick={() => {
                      setMessage('');
                      // No key to ask for: one click adds it outright.
                      if (!rec.keyHeader) {
                        addRecommended(rec, '');
                        return;
                      }
                      setPicked(rec);
                      setPickedKey('');
                      setSubform('recommended');
                    }}
                  >
                    Add
                  </LinkButton>
                }
              />
            ))}
          </Table>
        </>
      )}

      <SectionHeader title="Tool result limit" description="Max characters sent to the model per tool result." />
      <Card>
        <TextInput
          label="Character count"
          type="number"
          min={1000}
          max={200000}
          value={view.settings.mcpResultLimit}
          onChange={(event) => void patch({ mcpResultLimit: clampNumber(event.target.value, 1000) })}
        />
      </Card>
    </>
  );
}
