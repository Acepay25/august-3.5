import React, { memo, useMemo } from 'react';
import MarkdownContent from './MarkdownContent';
import { splitStreamingBlocks } from '../../utils/incrementalMarkdown';

interface StreamingMarkdownProps {
    /** Markdown source (possibly still streaming). */
    text: string;
    /** While live, freeze the head blocks and render only the tail hot. */
    live?: boolean;
    className?: string;
}

/** A completed block — stable content, so memo skips re-parsing on each delta. */
const FrozenBlock = memo(function FrozenBlock({ block, className }: { block: string; className?: string }) {
    return <MarkdownContent content={block} className={className} />;
});

/**
 * Append-only streaming markdown (DeepSeek-style). Every chunk used to
 * re-parse the whole reply (O(n²)); here all but the trailing blocks are
 * frozen into memoized renders keyed to content that never changes again, so
 * each delta only re-renders the small live tail. When the stream settles,
 * the full text renders through a single MarkdownContent pass.
 */
const StreamingMarkdown: React.FC<StreamingMarkdownProps> = ({ text, live = false, className }) => {
    const blocks = useMemo(
        () => (live ? splitStreamingBlocks(text) : null),
        [text, live],
    );
    if (!live || !blocks) {
        return <MarkdownContent content={text} className={className} />;
    }
    return (
        <div>
            {blocks.frozen.map((block, index) => (
                <FrozenBlock key={`blk-${index}-${block.length}`} block={block} className={className} />
            ))}
            <div className={`whitespace-pre-wrap break-words ${className ?? ''}`}>
                {blocks.tail}
            </div>
        </div>
    );
};

export default StreamingMarkdown;
