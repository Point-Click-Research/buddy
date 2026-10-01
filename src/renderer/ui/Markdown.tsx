// The chat window's markdown: the shared parser rendered as React elements
// (never HTML strings), so model text can never inject markup.

import { Fragment, type ReactElement, type ReactNode } from 'react';
import { linkHost } from '../../shared/link-text';
import { parseMarkdown, splitBareLinks, type Inline, type Line } from '../shared/markdown';
import { SiteIcon } from './SiteIcon';

export function Markdown({
  text,
  onLink,
}: {
  text: string;
  /** Where links go when clicked; without it they render as plain styled text. */
  onLink?: (url: string) => void;
}): ReactElement {
  return (
    <>
      {parseMarkdown(text).map((block, i) =>
        block.kind === 'code' ? (
          <pre
            key={i}
            className="my-1.5 overflow-x-auto rounded-base bg-wash px-3 py-2 font-mono text-[12px] leading-5"
          >
            <code>{block.body}</code>
          </pre>
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && '\n'}
                {renderLine(line, onLink)}
              </Fragment>
            ))}
          </span>
        ),
      )}
    </>
  );
}

function renderLine(line: Line, onLink?: (url: string) => void): ReactNode {
  const parts = renderParts(line.parts, onLink);
  if (line.style === 'heading') return <strong>{parts}</strong>;
  if (line.style === 'bullet') return [`${line.indent}• `, ...parts];
  return parts;
}

/** Plain text with bare URLs drawn the same way as markdown links. */
export function LinkText({ text, onLink }: { text: string; onLink?: (url: string) => void }): ReactElement {
  return (
    <>
      {splitBareLinks(text).map((part, i) =>
        part.kind === 'text' ? part.body : <MessageLink key={i} url={part.url} onLink={onLink} />,
      )}
    </>
  );
}

/** The site's icon and the URL, inline, so a long link wraps with the sentence. */
function MessageLink({ url, onLink }: { url: string; onLink?: (url: string) => void }): ReactElement {
  return (
    <a
      href={url}
      className="cursor-pointer whitespace-normal text-link wrap-break-word"
      onClick={(event) => {
        event.preventDefault();
        onLink?.(url);
      }}
    >
      <SiteIcon host={linkHost(url)} className="mr-1.5 align-middle" />{url}
    </a>
  );
}

function renderParts(parts: Inline[], onLink?: (url: string) => void): ReactNode[] {
  return parts.map((part, i) => {
    switch (part.kind) {
      case 'text':
        return part.body;
      case 'code':
        return (
          <code key={i} className="rounded-[4px] bg-wash px-1 py-px font-mono text-[12px]">
            {part.body}
          </code>
        );
      case 'bold':
        return <strong key={i}>{renderParts(part.parts, onLink)}</strong>;
      case 'em':
        return <em key={i}>{part.body}</em>;
      case 'link':
        return <MessageLink key={i} url={part.url} onLink={onLink} />;
    }
  });
}
