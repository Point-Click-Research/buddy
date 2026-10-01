/** A connected MCP server counts as web search when it is Exa. */

export function isExaServer(server: { name: string; url: string }): boolean {
  return server.name.toLowerCase() === 'exa' || server.url.toLowerCase().includes('mcp.exa.ai');
}

/** A leftover Parallel Search server. Web search is Exa only; these are dropped. */
export function isParallelServer(server: { name: string; url: string }): boolean {
  const name = server.name.toLowerCase();
  const url = server.url.toLowerCase();
  return name === 'parallel' || url.includes('search.parallel.ai');
}

export function isContext7Server(server: { name: string; url: string }): boolean {
  const name = server.name.toLowerCase();
  const url = server.url.toLowerCase();
  return name === 'context7' || url.includes('mcp.context7.com');
}
