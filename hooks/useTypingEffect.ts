import { useState, useEffect, useRef } from 'react';

export const useTypingEffect = (text: string | null, baseSpeed: number = 10): [string, boolean] => {
  const [displayedText, setDisplayedText] = useState('');
  const [isFinished, setIsFinished] = useState(false);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Clear existing timeouts on unmount or text change
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];

    if (text === null || text === undefined) {
      setDisplayedText('');
      setIsFinished(false);
      return;
    }

    if (text === '') {
      setDisplayedText('');
      setIsFinished(true);
      return;
    }

    setIsFinished(false);
    setDisplayedText('');

    const words = text.split(/(\s+)/);
    const totalWords = words.length;

    // Dynamic batch size and speed based on text length to ensure UI doesn't lag
    // For very long text, render chunks of words instead of one by one
    const isLongText = totalWords > 100;
    const batchSize = isLongText ? 3 : 1;
    // Faster speed for longer text
    const dynamicSpeed = isLongText ? Math.max(1, Math.floor(baseSpeed / 2)) : baseSpeed;

    let currentWordIndex = 0;
    let accumulatedText = '';

    const typeNextBatch = () => {
      const startTime = Date.now();

      // Add a batch of words
      for (let i = 0; i < batchSize && currentWordIndex < totalWords; i++) {
        accumulatedText += words[currentWordIndex];
        currentWordIndex++;
      }

      setDisplayedText(accumulatedText);

      if (currentWordIndex < totalWords) {
        // Calculate delay adjustments
        const elapsed = Date.now() - startTime;
        const nextDelay = Math.max(0, dynamicSpeed - elapsed);

        const timeoutId = setTimeout(typeNextBatch, nextDelay);
        timeouts.current.push(timeoutId);
      } else {
        setIsFinished(true);
      }
    };

    // Start typing
    typeNextBatch();

    return () => {
      timeouts.current.forEach(clearTimeout);
    };
  }, [text, baseSpeed]);

  return [displayedText, isFinished];
};