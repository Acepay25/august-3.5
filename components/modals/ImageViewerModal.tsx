import React, { useEffect, useRef } from 'react';
import { X } from '../shared/Icons';

interface ImageViewerModalProps {
    imageUrl: string | null;
    onClose: () => void;
}

/**
 * Full-screen image viewer modal
 * Replaces window.open() which doesn't work in Android WebView
 */
const ImageViewerModal: React.FC<ImageViewerModalProps> = ({ imageUrl, onClose }) => {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        closeButtonRef.current?.focus();
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose, imageUrl]);

    if (!imageUrl) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div
            className="fixed inset-0 z-confirm bg-black/95 flex items-center justify-center p-4"
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-label="Image viewer"
        >
            {/* Close button */}
            <button
                ref={closeButtonRef}
                onClick={onClose}
                className="absolute top-4 right-4 p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors z-10"
                aria-label="Close image"
            >
                <X className="h-5 w-5" aria-hidden="true" />
            </button>

            {/* Image container */}
            <div className="max-w-full max-h-full overflow-auto">
                <img
                    src={imageUrl}
                    alt="Full size preview"
                    className="max-w-full max-h-[90vh] object-contain rounded-lg"
                    onClick={(e) => e.stopPropagation()}
                />
            </div>

            {/* Hint text */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-zinc-500 text-ui-base">
                Tap outside or × to close
            </div>
        </div>
    );
};

export default ImageViewerModal;
