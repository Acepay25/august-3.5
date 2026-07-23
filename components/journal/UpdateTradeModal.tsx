
import React, { useState, useRef } from 'react';
import { ImageMetadata, Message } from '../../types';
import ImagePreview from '../shared/ImagePreview';
import { UploadIcon, LoadingIcon, UpdateIcon } from '../shared/Icons';
import { processImagesForSummarization } from '../../utils/imageProcessor';

export const UpdateTradeModal: React.FC<{
    message: Message;
    onClose: () => void;
    onConfirm: (text: string, images: ImageMetadata[]) => void;
    onAutoCapture?: () => void;
    isCapturing?: boolean;
    ocrModel: string;
    onQuotaExceeded: (modelId: string) => void;
}> = ({ message, onClose, onConfirm, onAutoCapture, isCapturing = false, ocrModel, onQuotaExceeded }) => {
    const [updateText, setUpdateText] = useState('');
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const newFiles: File[] = Array.from(event.target.files);
            const placeholderMetadata: ImageMetadata[] = newFiles.map(file => ({ file, dataURL: '', isLoading: true }));
            setImages(prev => [...prev, ...placeholderMetadata].slice(0, 5));
            processImagesForSummarization(newFiles, images.length, ocrModel, setImages, onQuotaExceeded);
            if (event.target) event.target.value = '';
        }
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const isProcessing = images.some(img => img.isLoading);

    const handleConfirm = () => {
        onConfirm(updateText, images);
    };

    const coinName = message.analysis?.coinName || 'this trade';

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg border border-cyan-500/30 animate-fade-in">
                {/* Header */}
                <div className="p-5 border-b border-white/5 bg-cyan-500/10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                            <UpdateIcon className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-cyan-400">
                                Update Trade Setup
                            </h3>
                            <p className="text-sm text-zinc-400 mt-0.5">
                                Re-evaluate <span className="text-white font-semibold">{coinName}</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Options */}
                <div className="p-5 space-y-4">
                    {/* Auto Capture Option */}
                    {onAutoCapture && (
                        <button
                            onClick={onAutoCapture}
                            disabled={isCapturing || isProcessing}
                            className="w-full p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/30 hover:bg-cyan-950/50 hover:border-cyan-500/40 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
                        >
                            {isCapturing && (
                                <div className="absolute inset-0 bg-cyan-500/10 animate-pulse" />
                            )}
                            <div className="flex items-start gap-4 relative z-10">
                                <div className="text-3xl">{isCapturing ? '⏳' : '⚡'}</div>
                                <div className="flex-1">
                                    <div className="font-bold text-cyan-300 group-hover:text-cyan-200 transition-colors flex items-center gap-2">
                                        {isCapturing ? 'Fetching Market Data...' : 'Auto-Capture Market Data'}
                                        {!isCapturing && (
                                            <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                                                Recommended
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                                        {isCapturing
                                            ? 'Fetching current market data from Binance...'
                                            : 'Instantly fetch current market data via Hybrid Intelligence.'
                                        }
                                    </div>
                                </div>
                            </div>
                        </button>
                    )}

                    {/* Divider with OR */}
                    {onAutoCapture && (
                        <div className="flex items-center gap-3">
                            <div className="flex-1 h-px bg-white/5"></div>
                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Or Manual Input</span>
                            <div className="flex-1 h-px bg-white/5"></div>
                        </div>
                    )}

                    {/* Manual Text Input */}
                    <div>
                        <textarea
                            value={updateText}
                            onChange={(e) => setUpdateText(e.target.value)}
                            placeholder="Describe market changes..."
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 min-h-[80px] resize-none"
                            disabled={isCapturing}
                        />
                    </div>

                    {/* Image Upload Section */}
                    <div className="bg-zinc-800/50 p-3 rounded-xl border border-white/5">
                        <ImagePreview images={images} onRemoveImage={removeImage} />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full mt-2 flex items-center justify-center gap-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-bold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                            disabled={isProcessing || isCapturing}
                        >
                            <UploadIcon /> {isProcessing ? 'Processing...' : 'Upload Updated Chart'}
                        </button>
                        <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={isProcessing || isCapturing} />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-white/5 bg-zinc-950/50 flex flex-col sm:flex-row justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isCapturing}
                        className="py-2 px-4 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-sm disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isProcessing || isCapturing || (updateText.trim() === '' && images.length === 0)}
                        className="py-2 px-4 rounded-lg text-white bg-cyan-600 hover:bg-cyan-700 transition-colors font-bold disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed flex items-center gap-2 justify-center"
                    >
                        {isProcessing ? <LoadingIcon /> : 'Run Manual Update'}
                    </button>
                </div>
            </div>
        </div>
    );
};
