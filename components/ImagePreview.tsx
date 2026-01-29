
import React from 'react';
import { CloseIcon, LoadingIcon } from './Icons';
import { ImageMetadata } from '../types';

interface ImagePreviewProps {
  images: ImageMetadata[];
  onRemoveImage: (index: number) => void;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ images, onRemoveImage }) => {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="flex overflow-x-auto gap-2 p-2 sm:gap-3 sm:p-3 bg-gray-900/50 rounded-t-lg border-b border-gray-700">
      {(images || []).map((meta, index) => (
        <div key={`${meta.file.name}-${index}-${meta.file.size}`} className="flex-shrink-0 flex flex-col items-center w-16 sm:w-24 text-center">
          {/* Image and close button container */}
          <div className="relative h-14 w-14 sm:h-20 sm:w-20 mb-2 bg-black/40 rounded-md border border-white/5 flex items-center justify-center overflow-hidden">
            <img
              src={meta.dataURL}
              alt={`preview ${index}`}
              className="w-full h-full object-contain rounded-md"
            />
            <button
              onClick={() => onRemoveImage(index)}
              className="absolute -top-2 -right-2 sm:top-0 sm:right-0 sm:-mt-1 sm:-mr-1 bg-red-600 text-white rounded-full p-1 sm:p-0.5 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white z-10 shadow-lg"
              aria-label={`Remove image ${index + 1}`}
            >
              <CloseIcon />
            </button>
          </div>
          
          {/* Summary container */}
          <div className="w-full">
              <h4 className="text-xs font-semibold text-gray-400 mb-1 hidden sm:block">Chart Summary</h4>
              <div className="text-[10px] sm:text-xs font-mono text-gray-300 min-h-[1.5rem] sm:min-h-[2rem] flex items-center justify-center">
                {meta.isLoading ? (
                  <LoadingIcon className="w-3 h-3 sm:w-5 sm:h-5 text-white" />
                ) : (
                  <span className="truncate max-w-full" title={meta.summary}>{meta.summary}</span>
                )}
              </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ImagePreview;
