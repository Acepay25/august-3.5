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
 *
 * Typography: tighter paragraphs (my-3,
 * 1.65 line-height instead of my-4/leading-8), neutral zinc inline code
 * pills and blockquote borders (cyan is reserved for interactive links —
 * the monochrome doctrine), denser lists.
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={`text-sm leading-relaxed text-zinc-300 prose prose-invert prose-sm max-w-none ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => (
            <pre className="my-3 rounded-lg bg-black/50 border border-white/10 p-3 overflow-x-auto text-[12px] font-mono leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {children}
            </pre>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            // Fenced blocks carry a language-* class and live inside the
            // boxed <pre>; bare backticks are neutral zinc pills.
            const isBlock = /language-/.test(String(codeClassName || ''));
            if (isBlock) {
              return (
                <code className="font-mono text-zinc-300" {...props}>{children}</code>
              );
            }
            return (
              <code
                {...props}
                className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-mono text-[12.5px] text-zinc-200"
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-xs border-collapse tabular-nums">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-white/15 bg-zinc-800/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 text-left">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-white/5 px-3 py-1.5 text-[13px] text-zinc-300 align-middle leading-snug">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-white/15 pl-3 text-zinc-400 italic">{children}</blockquote>
          ),
          h1: ({ children }) => <h1 className="mt-5 mb-2.5 text-lg font-semibold text-zinc-100">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-5 mb-2.5 text-base font-semibold text-zinc-100">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-4 mb-2 text-sm font-semibold text-zinc-100">{children}</h3>,
          hr: () => <hr className="my-4 border-white/10" />,
          p: ({ children }) => <p className="my-3 leading-[1.65] text-zinc-300">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-zinc-300 marker:text-zinc-600">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-zinc-300 marker:text-zinc-600">{children}</ol>,
          li: ({ children }) => <li className="leading-[1.65]">{children}</li>,
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
