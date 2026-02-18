/**
 * LinkifiedText - Renders plain text with URLs converted to clickable links.
 *
 * Detects http/https URLs in a string and wraps them in <a> tags.
 * Non-URL text is rendered as-is. Links open in new tabs with
 * noopener/noreferrer for security.
 *
 * URLs also get OG metadata previews (title, description, image) below them
 * via the useLinkPreview hook + /api/unfurl endpoint.
 */

import type { CSSProperties } from 'react';
import { useLinkPreview } from '@/hooks/useLinkPreview';

const URL_REGEX = /https?:\/\/[^\s]+/g;

const linkStyle: CSSProperties = {
  color: 'var(--color-gold)',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
};

const previewCardStyle: CSSProperties = {
  display: 'flex',
  gap: '8px',
  padding: '8px',
  marginTop: '4px',
  marginBottom: '4px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(255,255,255,0.03)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const previewTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8px',
  fontWeight: 500,
  color: 'rgba(255,255,255,0.75)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const previewDescStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '7px',
  color: 'rgba(255,255,255,0.40)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

/** Inline preview card for a single URL. */
function LinkPreviewCard({ url }: { url: string }) {
  const { data } = useLinkPreview(url);
  if (!data || (!data.title && !data.description)) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={previewCardStyle}
      onClick={(e) => e.stopPropagation()}
      data-testid="link-preview-card"
    >
      {data.image && (
        <img
          src={data.image}
          alt=""
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '6px',
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {data.title && <div style={previewTitleStyle}>{data.title}</div>}
        {data.description && (
          <div style={previewDescStyle}>{data.description}</div>
        )}
      </div>
    </a>
  );
}

interface LinkifiedTextProps {
  text: string;
  style?: CSSProperties;
  /** Show OG metadata preview cards below detected URLs. */
  showPreviews?: boolean;
}

/**
 * Split text into segments of plain text and URL matches,
 * rendering URLs as clickable anchor elements.
 */
export function LinkifiedText({
  text,
  style,
  showPreviews = false,
}: LinkifiedTextProps) {
  if (!text) return null;

  const parts: (string | { url: string })[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state (global flag)
  URL_REGEX.lastIndex = 0;

  while ((match = URL_REGEX.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({ url: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // Push remaining plain text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no URLs found, just return text as-is
  if (parts.length === 1 && typeof parts[0] === 'string') {
    return <span style={style}>{parts[0]}</span>;
  }

  // Collect URLs for previews
  const urls = showPreviews
    ? parts.filter((p): p is { url: string } => typeof p !== 'string')
    : [];

  return (
    <span style={style} data-testid="linkified-text">
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <a
            key={i}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {part.url}
          </a>
        )
      )}
      {urls.map((u, i) => (
        <LinkPreviewCard key={`preview-${i}`} url={u.url} />
      ))}
    </span>
  );
}
