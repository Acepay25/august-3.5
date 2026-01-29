# AGENTS.md

This file contains guidelines and commands for agentic coding agents working in this repository.

## Project Overview

August 3.5 is a React + TypeScript trading analysis application that uses multiple AI providers to deliver trading insights, pattern recognition, and post-trade analysis. The app features ensemble AI debates, accuracy mode validation, hybrid intelligence with real-time market data, and comprehensive trade logging with learning capabilities.

## Build Commands

```bash
# Development
npm run dev                 # Start development server on port 3000

# Build & Deploy
npm run build              # Build for production
npm run preview            # Preview production build locally

# No test framework configured
# No linting configured
# No type checking configured
```

## Project Structure

```
src/
├── components/          # React UI components
├── services/           # AI provider integrations & business logic
├── utils/              # Helper functions and utilities
├── constants/          # Configuration constants
├── types.ts            # TypeScript type definitions
└── App.tsx             # Main application component
```

## Code Style Guidelines

### TypeScript & Types
- Use strict TypeScript - all functions must have return types
- Import types from `types.ts` - don't redefine common types
- Use interfaces for object shapes, enums for constants
- Prefer union types over enums for simple string constants
- Use generic types where appropriate (`<T>`, `<K extends string>`)

### Import Organization
```typescript
// 1. React & UI libraries
import React, { useState, useEffect } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';

// 2. Internal types (always first)
import { Message, TradeAnalysis, AIProvider } from './types';

// 3. Internal services (alphabetical)
import * as openaiService from './services/openaiService';
import * as dbService from './services/dbService';

// 4. Internal components (alphabetical)
import { Header } from './components/Header';
import { ChatArea } from './components/ChatArea';

// 5. Utilities (alphabetical)
import { sanitizeAIResponse } from './utils/sanitizers';
import { constructOptimizedContext } from './utils/memoryUtils';
```

### Component Patterns
- Use functional components with hooks
- Define props interfaces separately: `interface ComponentProps { ... }`
- Use `React.FC<ComponentProps>` type annotation
- Extract complex logic into custom hooks or services
- Use memo for performance-critical components: `React.memo(Component)`

### State Management
- Use `useState` for simple local state
- Use `useReducer` for complex state logic
- Use `useCallback` for event handlers to prevent unnecessary re-renders
- Use `useMemo` for expensive computations
- Store refs for values that don't trigger re-renders: `const messagesRef = useRef<Message[]>([])`

### Error Handling
- Always wrap async operations in try-catch blocks
- Use specific error types: `throw new Error("Descriptive message")`
- Log errors with context: `console.error("ServiceName: operation failed", error)`
- Return fallback values for non-critical failures
- Use error boundaries for React component errors

### Service Layer Architecture
- Each AI provider has its own service file: `openaiService.ts`, `geminiService.ts`
- Export functions with consistent naming: `analyzeTradingView`, `summarizeChartImage`
- Use response format objects for structured outputs
- Sanitize all AI responses before using: `sanitizeAIResponse()`, `sanitizeTradeAnalysis()`
- Handle rate limits and API errors gracefully

### Database & Persistence
- Use SQLite via Capacitor for native, IndexedDB for web
- All database operations go through `dbService`
- Use type-safe interfaces for all stored data
- Implement data integrity checks and migrations
- Create backups before major data operations

### Constants & Configuration
- Store AI model definitions in `constants/models.ts`
- Use enums for provider names and message roles
- Keep API keys and secrets in environment variables
- Define default values for all configurable options

### Naming Conventions
- Components: PascalCase (`Header`, `ChatArea`)
- Functions: camelCase (`analyzeTradingView`, `sanitizeAIResponse`)
- Variables: camelCase (`activeConversation`, `selectedModel`)
- Constants: UPPER_SNAKE_CASE (`DEFAULT_FRAMEWORKS`, `MAX_TRADE_SUMMARIES`)
- Files: camelCase for services/utils, PascalCase for components

### Code Organization
- Keep files focused on single responsibility
- Extract reusable logic into utility functions
- Use barrel exports for service modules: `export * from './openaiService'`
- Group related functionality in folders
- Use index files for clean imports

### Performance Guidelines
- Lazy load heavy components with `React.lazy()`
- Use virtualization for long lists (react-virtuoso)
- Implement debouncing for user inputs
- Cache API responses when appropriate
- Optimize re-renders with memo and useMemo

### Security Best Practices
- Never commit API keys or secrets
- Sanitize all user inputs and AI responses
- Use environment variables for configuration
- Validate data from external sources
- Implement proper error boundaries

## AI Provider Integration

When working with AI services:
1. Always check if the provider is enabled before making requests
2. Handle rate limits and quota errors gracefully
3. Use the correct model ID from `constants/models.ts`
4. Implement proper error handling and fallbacks
5. Sanitize responses before using in UI

## Testing Notes

This project doesn't have automated tests configured. When adding features:
1. Test manually in development mode
2. Verify functionality across different AI providers
3. Check data persistence and integrity
4. Test error scenarios and edge cases

## Common Patterns

### Async Service Calls
```typescript
const result = await service.operation(params);
if (!result) throw new Error("Operation failed");
return sanitizeResponse(result);
```

### State Updates
```typescript
updateActiveConversation(conv => ({
  ...conv,
  messages: updater(conv.messages)
}));
```

### Error Handling
```typescript
try {
  const result = await operation();
  return result;
} catch (error) {
  console.error("Context: operation failed", error);
  return fallbackValue;
}
```

## Environment Variables

Required environment variables (set in `.env.local`):
- `GEMINI_API_KEY` - Google Gemini API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `GROQ_API_KEY` - Groq API key
- `ZHIPU_API_KEY` - Zhipu AI API key

## Development Notes

- The app uses Vite for fast development and building
- Capacitor is used for native mobile deployment
- React 19 with strict mode enabled
- TypeScript with strict type checking
- No CSS framework - uses Tailwind CSS classes directly