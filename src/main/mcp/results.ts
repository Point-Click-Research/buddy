// Converts an MCP tool result into Anthropic tool_result content: text is
// truncated to a limit (with a note), images pass through as image blocks.
// Pure module: no Electron imports, fully unit-testable.

import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ToolOutcome } from '../ai/tools';

/** The MCP result shape we consume (structural, so tests need no SDK types). */
export interface McpCallResult {
  content?: unknown;
  isError?: boolean;
}

interface McpContentBlock {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** The image formats the Anthropic API accepts. */
const IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** The text cut to `max` characters, saying so, so the model knows it saw part of it. */
export function truncateResult(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[Result truncated: showing ${max} of ${text.length} characters.]`;
}

export function toToolOutcome(result: McpCallResult, maxTextChars: number): ToolOutcome {
  const blocks = Array.isArray(result.content) ? (result.content as McpContentBlock[]) : [];
  const texts: string[] = [];
  const images: ImageBlockParam[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (
      block.type === 'image' &&
      typeof block.data === 'string' &&
      typeof block.mimeType === 'string' &&
      IMAGE_TYPES.has(block.mimeType)
    ) {
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: block.mimeType as ImageMediaType, data: block.data },
      });
    } else {
      texts.push(`[unsupported ${String(block.type)} content omitted]`);
    }
  }

  const text = truncateResult(texts.join('\n'), maxTextChars);
  const isError = result.isError === true;
  if (images.length === 0) return { content: text || '(empty result)', ...(isError ? { isError } : {}) };

  const content: Array<TextBlockParam | ImageBlockParam> = text
    ? [{ type: 'text', text }, ...images]
    : images;
  return { content, ...(isError ? { isError } : {}) };
}
