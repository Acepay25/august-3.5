import React from 'react';

interface ImageViewerModalProps {
    imageUrl: string | null;
    onClose: () => void;
}

/**
 * Full-screen image viewer modal
 * Replaces window.open() which doesn't work in Android WebView
 */
const ImageViewerModal: React.FC<ImageViewerModalProps> = ({ imageUrl, onClose }) => {
    if (!imageUrl) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4"
            onClick={handleBackdropClick}
        >
            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors z-10"
                aria-label="Close image"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-zinc-500 text-sm">
                Tap outside or × to close
            </div>
        </div>
    );
};

export default ImageViewerModal;
