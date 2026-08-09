

import React from 'react';
import { ImageMetadata } from '../types';
import { ProviderConfig } from '../types/provider';
import { summarizeChartImage } from '../services/providers/GenericAnalysisService';
import { isQuotaError } from './errorUtils';

/**
 * Downscale an image file to a base64 data URL.
 *
 * Reads the file, draws it onto a canvas capped at MAX_DIMENSION px on the
 * longest side and re-encodes as JPEG — a 5MB chart export used to become a
 * ~6.7MB base64 string per message (held in memory, persisted, and echoed
 * into composer previews). Downscaled data URLs keep charts legible while
 * cutting memory/storage roughly 5-10x.
 *
 * Decode path: `createImageBitmap(file)` when available — the decode runs
 * off the main thread and never materializes the image as a giant base64
 * string (a 12MP screenshot used to create a ~16MB data URL on the main
 * thread, then a ~48MB RGBA decode, before being drawn at 1600px). The
 * decoded bitmap is explicitly `close()`d to release its backing memory.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const readFileAsDownscaledDataUrl = (file: File): Promise<string> => {
  if (typeof createImageBitmap === 'function') {
    return (async () => {
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        if (scale >= 1) {
          // Small enough already — keep the original (PNG stays lossless).
          return readFileAsDataUrl(file);
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return readFileAsDataUrl(file);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      } catch {
        return readFileAsDataUrl(file);
      } finally {
        bitmap?.close();
      }
    })();
  }

  // Legacy fallback (old WebViews without createImageBitmap): decode via an
  // <img> element from the data URL.
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const original = reader.result as string;
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
          if (scale >= 1) {
            resolve(original);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(original);
            return;
          }
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch {
          resolve(original);
        }
      };
      image.onerror = () => resolve(original);
      image.src = original;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const processImagesForSummarization = async (
  files: File[],
  startingIndex: number,
  visionConfig: ProviderConfig,
  setImages: React.Dispatch<React.SetStateAction<ImageMetadata[]>>,
  onQuotaExceeded: (modelId: string) => void
) => {
  const ocrModel = visionConfig.selectedModel;

  files.forEach((file: File, index: number) => {
    const processFile = async () => {
      try {
        const dataURL = await readFileAsDownscaledDataUrl(file);

        const chartNumber = startingIndex + index + 1;
        const { uiSummary, fullSummary } = await summarizeChartImage(visionConfig, file, chartNumber);

        setImages(prevImages => {
          const updatedImages = [...prevImages];
          const imageIndex = updatedImages.findIndex(p => p.file === file);
          if (imageIndex !== -1) {
            updatedImages[imageIndex] = {
              file,
              dataURL,
              summary: uiSummary,
              fullAnalysisText: fullSummary,
              isLoading: false,
              ocrModelUsed: ocrModel,
            };
          }
          return updatedImages;
        });

      } catch (err: any) {
        console.error("Error processing image:", err);
        const chartNumber = startingIndex + index + 1;
        let summaryText = `Chart ${chartNumber} | Analysis Failed`;
        if (isQuotaError(err)) {
          onQuotaExceeded(ocrModel);
          summaryText = `Chart ${chartNumber} | Quota Exceeded`;
        }

        setImages(prevImages => {
          const updatedImages = [...prevImages];
          const imageIndex = updatedImages.findIndex(p => p.file === file);
          if (imageIndex !== -1) {
            updatedImages[imageIndex] = {
              ...updatedImages[imageIndex],
              summary: summaryText,
              fullAnalysisText: `Analysis failed for Chart ${chartNumber}. Reason: ${err.message}`,
              isLoading: false,
              ocrModelUsed: ocrModel,
            };
          }
          return updatedImages;
        });
      }
    };
    processFile();
  });
};
