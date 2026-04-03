import React from 'react';
import type { Message } from '../../shared/types';
import ToolActivity from './ToolActivity';

interface MessageBubbleProps {
  message: Message;
}

function renderContent(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex animate-slide-up ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          max-w-[88%] rounded-2xl px-4 py-3
          ${isUser
            ? 'bg-user-bubble text-text-primary rounded-br-md'
            : 'bg-transparent text-text-primary'
          }
        `}
      >
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolActivity tools={message.toolCalls} />
        )}

        {message.content && (
          <div
            className="message-prose text-[0.9rem] leading-relaxed px-3 py-0.5"
            dangerouslySetInnerHTML={{ __html: `<p>${renderContent(message.content)}</p>` }}
          />
        )}

        <div className={`mt-1.5 text-2xs ${isUser ? 'text-white/20' : 'text-text-muted'}`}>
          {message.timestamp}
        </div>
      </div>
    </div>
  );
}
