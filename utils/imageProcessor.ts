

import React from 'react';
import { ImageMetadata } from '../types';
import { ProviderConfig } from '../types/provider';
import { summarizeChartImage } from '../services/providers/GenericAnalysisService';
import { isQuotaError } from './errorUtils';

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
        const dataURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

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
