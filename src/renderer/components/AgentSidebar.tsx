// src/renderer/components/AgentSidebar.tsx
import React, { useState } from 'react';
import VideoExtractorAgent from './agents/VideoExtractorAgent';

type AgentId = 'video-extractor';

export default function AgentSidebar() {
  const [openAgent, setOpenAgent] = useState<AgentId | null>('video-extractor');

  const toggle = (id: AgentId) => {
    setOpenAgent((current) => (current === id ? null : id));
  };

  return (
    <nav
      className="flex h-full flex-shrink-0 flex-col border-r border-white/[0.06] bg-surface-1 overflow-y-auto"
      style={{ width: '300px' }}
    >
      <VideoExtractorAgent
        isOpen={openAgent === 'video-extractor'}
        onToggle={() => toggle('video-extractor')}
      />
    </nav>
  );
}
