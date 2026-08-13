import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  /** Markdown text to render. */
  content: string;
  /** Extra classes for the prose wrapper (e.g. text color overrides). */
  className?: string;
}

/**
 * Heavy markdown renderer (react-markdown + remark-gfm). Kept in its own
 * module so MarkdownContent can lazy-load it — this whole chunk (the largest
 * single dependency in the app) is only fetched on the first render of an
 * AI message instead of being bundled into the startup entry.
 * ReactMarkdown escapes raw HTML by default, so AI output can't inject markup.
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={`text-sm leading-relaxed text-zinc-300 prose prose-invert prose-sm max-w-none ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => (
            <pre className="my-2 rounded-lg bg-black/50 border border-white/10 p-3 overflow-x-auto text-[11px] font-mono leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {children}
            </pre>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            // Fenced blocks carry a language-* class and live inside the
            // boxed <pre>; bare backticks are inline highlights.
            const isBlock = /language-/.test(String(codeClassName || ''));
            if (isBlock) {
              return (
                <code className="font-mono text-zinc-300" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-cyan-500/10 border border-cyan-500/15 px-1 py-0.5 text-[11px] font-mono text-cyan-200" {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-[11px] border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-white/15 bg-zinc-800/60 px-2 py-1 text-zinc-200 font-semibold text-left">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-white/5 px-2 py-1 text-zinc-400 align-top">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-cyan-500/40 pl-3 text-zinc-400">{children}</blockquote>
          ),
          h1: ({ children }) => <h1 className="mt-6 mb-3 text-lg font-semibold text-zinc-100">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-6 mb-3 text-base font-semibold text-zinc-100">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-5 mb-2 text-sm font-semibold text-zinc-100">{children}</h3>,
          p: ({ children }) => <p className="my-4 leading-8 text-zinc-300">{children}</p>,
          ul: ({ children }) => <ul className="my-4 list-disc space-y-2.5 pl-5 text-zinc-300">{children}</ul>,
          ol: ({ children }) => <ol className="my-4 list-decimal space-y-2.5 pl-5 text-zinc-300">{children}</ol>,
          li: ({ children }) => <li className="leading-8">{children}</li>,
          em: ({ children }) => <em className="italic text-zinc-200">{children}</em>,
          strong: ({ children }) => <strong className="font-bold text-zinc-50">{children}</strong>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">{children}</a>
          ),
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
};

export default memo(MarkdownRenderer);
