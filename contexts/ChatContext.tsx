import React, { createContext, useContext } from 'react';
import { ChatContextProps } from '../components/chat/MessageItem';

/**
 * Chat Context — provides chat-related state and handlers to the component tree
 * without prop drilling through App → ChatArea → MessageItem.
 *
 * Usage:
 *   // In App.tsx (provider):
 *   <ChatProvider value={chatContext}>
 *     <ChatArea ... />
 *   </ChatProvider>
 *
 *   // In any child component (consumer):
 *   const { handleSaveAnalysis, activeConversation } = useChatContext();
 */

const ChatContext = createContext<ChatContextProps | null>(null);

export const ChatProvider: React.FC<{
  value: ChatContextProps;
  children: React.ReactNode;
}> = ({ value, children }) => {
  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChatContext = (): ChatContextProps => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
};

export default ChatContext;
