'use client';

import { useSlot } from '../theme/SlotsProvider.js';

export type RenderedDocumentProps = {
  name: string;
  kind: 'html' | 'markdown';
  /** Inline document. Used by the sandbox preview, which has no base URL. */
  text?: string;
  /** Published bundle URL. Relative CSS and images resolve against it. */
  contentUrl?: string;
};

/** HTML and Markdown preview shared by the file pane and the artifact viewer. */
export function RenderedDocument({ name, kind, text, contentUrl }: RenderedDocumentProps) {
  const Markdown = useSlot('Markdown');
  if (kind === 'html') {
    return (
      <iframe
        title={name}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        {...(contentUrl != null ? { src: contentUrl } : { srcDoc: text ?? '' })}
        className="absolute inset-0 h-full w-full border-0 bg-white"
      />
    );
  }
  return (
    <div className="px-4 py-3">
      <Markdown content={text ?? ''} />
    </div>
  );
}
