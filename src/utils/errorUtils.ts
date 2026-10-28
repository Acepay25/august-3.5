
export const isQuotaError = (error: any): boolean => {
  if (error && error.status === 429) return true;
  const message = (error?.message || '').toLowerCase();
  // More specific check for Gemini quota errors
  return message.includes('quota') || (message.includes('resource has been exhausted') && (message.includes('requests per minute') || message.includes('daily') || message.includes('monthly')));
};
