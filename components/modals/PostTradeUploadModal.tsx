

import React, { useState, useRef } from 'react';
import { ImageMetadata, Message, TradeOutcome } from '../../types';
import ImagePreview from '../shared/ImagePreview';
import { UploadIcon, LoadingIcon } from '../shared/Icons';
import { processImagesForSummarization } from '../../utils/imageProcessor';

export type PostMortemCandidate = {
    message: Message;
    outcome: TradeOutcome;
    feedback: {
        pnlAmount?: number;
        correctedEntry?: string;
        correctedStopLoss?: string;
        correctedTakeProfit?: string;
    };
};

export const PostTradeUploadModal: React.FC<{
  candidate: PostMortemCandidate;
  onClose: () => void;
  onAnalyze: (summaries?: string[], images?: string[]) => void;
  ocrModel: string;
  onQuotaExceeded: (modelId: string) => void;
}> = ({ candidate, onClose, onAnalyze, ocrModel, onQuotaExceeded }) => {
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

    const handleAnalyzeWithImages = () => {
        const summaries = images.map(i => i.fullAnalysisText).filter(Boolean) as string[];
        const urls = images.map(i => i.dataURL);
        onAnalyze(summaries, urls);
    };

    const handleAnalyzeWithoutImages = () => {
        onAnalyze();
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Enhance post-mortem analysis">
            <div className="bg-zinc-900 rounded-2xl shadow-2xl p-6 w-full max-w-lg border border-white/10 animate-fade-in max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-bold text-cyan-400 mb-2">Enhance Post-Mortem Analysis?</h3>
                <p className="text-sm text-zinc-400 mb-4">
                    Uploading screenshots of what happened <strong className="text-cyan-300">after</strong> the trade was called will significantly improve the AI's learning and future accuracy.
                </p>
                
                <div className="bg-zinc-950/50 p-3 rounded-xl border border-white/10">
                    <ImagePreview images={images} onRemoveImage={removeImage} />
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full mt-2 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-2 px-4 rounded-xl disabled:opacity-50"
                        disabled={isProcessing}
                    >
                        <UploadIcon /> {isProcessing ? 'Processing...' : 'Upload Post-Trade Screenshots'}
                    </button>
                    <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={isProcessing} />
                </div>
                
                <div className="mt-6 flex flex-col sm:flex-row justify-end gap-4">
                    <button 
                        onClick={handleAnalyzeWithoutImages} 
                        disabled={isProcessing}
                        className="py-2 px-4 rounded-xl text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                    >
                        Analyze without Screenshots
                    </button>
                    <button 
                        onClick={handleAnalyzeWithImages} 
                        disabled={isProcessing || images.length === 0}
                        className="py-2 px-4 rounded-xl text-white bg-cyan-600 hover:bg-cyan-700 transition-colors disabled:bg-zinc-700 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? <LoadingIcon /> : `Analyze with ${images.length} Screenshot(s)`}
                    </button>
                </div>
            </div>
        </div>
    );
};