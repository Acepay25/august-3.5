
import React, { useEffect } from 'react';
import { useTypingEffect } from '../../../hooks/useTypingEffect';

export const TypingRenderer: React.FC<{ fullText: string, onComplete: () => void, className: string, speed?: number }> = ({ fullText, onComplete, className, speed = 8 }) => {
    const [typedText, isFinished] = useTypingEffect(fullText, speed);
    useEffect(() => {
        if (isFinished) {
            onComplete();
        }
    }, [isFinished, onComplete]);

    return <p className={className}>{typedText}</p>;
};
