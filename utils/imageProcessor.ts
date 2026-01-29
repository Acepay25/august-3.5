

import React from 'react';
import { ImageMetadata } from '../types';
import * as geminiService from '../services/geminiService';
import * as zhipuService from '../services/zhipuService';
import * as groqService from '../services/groqService';
import * as openaiService from '../services/openaiService';
import { isQuotaError } from './errorUtils';

export const processImagesForSummarization = async (
  files: File[],
  startingIndex: number,
  ocrModel: string,
  setImages: React.Dispatch<React.SetStateAction<ImageMetadata[]>>,
  onQuotaExceeded: (modelId: string) => void
) => {
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
        let uiSummary: string;
        let fullSummary: string;

        if (ocrModel.startsWith('gemini')) {
          ({ uiSummary, fullSummary } = await geminiService.summarizeChartImage(file, chartNumber, ocrModel));
        } else if (ocrModel.startsWith('glm')) {
          ({ uiSummary, fullSummary } = await zhipuService.summarizeChartImage(file, chartNumber, ocrModel));
        } else if (ocrModel.startsWith('meta-llama')) {
          ({ uiSummary, fullSummary } = await groqService.summarizeChartImage(file, chartNumber, ocrModel));
        } else if (ocrModel.startsWith('gpt-')) {
          ({ uiSummary, fullSummary } = await openaiService.summarizeChartImage(file, chartNumber, ocrModel));
        } else if (ocrModel.startsWith('grok-')) {
          const grokNativeService = await import('../services/grokNativeService');
          ({ uiSummary, fullSummary } = await grokNativeService.summarizeChartImage(file, chartNumber, ocrModel));
        } else {
          console.warn(`Unknown OCR model selected: ${ocrModel}. Falling back to Gemini service.`);
          ({ uiSummary, fullSummary } = await geminiService.summarizeChartImage(file, chartNumber, 'gemini-2.5-flash'));
        }

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