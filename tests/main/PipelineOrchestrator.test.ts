import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock agentLoop so workers don't actually call the LLM
vi.mock('../../src/main/agent/agentLoop', () => ({
  agentLoop: vi.fn().mockResolvedValue('worker result'),
}));

// Mock streamLLM for planner and synthesizer calls
vi.mock('../../src/main/agent/streamLLM', () => ({
  streamLLM: vi.fn(),
}));

// Mock runTracker so no DB needed
vi.mock('../../src/main/runTracker', () => ({
  startRun: vi.fn().mockReturnValue('run-test-123'),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

// Mock db so no SQLite needed
vi.mock('../../src/main/db', () => ({
  createRun: vi.fn(),
  updateRun: vi.fn(),
  getConversation: vi.fn().mockReturnValue({ id: 'conv-1', title: 'test' }),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  updateConversation: vi.fn(),
}));

import { PipelineOrchestrator } from '../../src/main/core/PipelineOrchestrator';
import { streamLLM } from '../../src/main/agent/streamLLM';
import { agentLoop } from '../../src/main/agent/agentLoop';

const mockStreamLLM = vi.mocked(streamLLM);
const mockAgentLoop = vi.mocked(agentLoop);

const baseOptions = {
  provider: 'anthropic' as const,
  apiKey: 'test-key',
  model: 'claude-sonnet-4-6',
  conversationId: 'conv-1',
  signal: new AbortController().signal,
  browserService: undefined as any,
  unrestrictedMode: false,
};

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamLLM.mockReset();
    mockAgentLoop.mockReset();
    mockAgentLoop.mockResolvedValue('worker result');
  });

  it('classifyIntent returns true for complex multi-part goals', async () => {
    const result = await PipelineOrchestrator.classifyIntent(
      'Research AI trends across multiple vendors, compare the top 5 companies, and synthesize the main differences.',
    );
    expect(result).toBe(true);
  });

  it('classifyIntent returns false for simple goals', async () => {
    const result = await PipelineOrchestrator.classifyIntent('what is the weather today');
    expect(result).toBe(false);
  });

  it('classifyIntent returns false for short ambiguous prompts', async () => {
    const result = await PipelineOrchestrator.classifyIntent('something');
    expect(result).toBe(false);
  });

  it('run calls planner, then workers in parallel, then synthesizer', async () => {
    // Planner response
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify([
        { id: 'sub-1', subtask: 'Research market trends', goal: 'Find top 3 market trends' },
        { id: 'sub-2', subtask: 'Analyze competitors', goal: 'List 3 main competitors' },
      ]),
      toolBlocks: [],
    });
    // Synthesizer response
    mockStreamLLM.mockResolvedValueOnce({
      text: '## Findings\n\nsome findings\n\n## Summary\n\nsome summary',
      toolBlocks: [],
    });

    const stateUpdates: any[] = [];
    const result = await PipelineOrchestrator.run('research the AI market', {
      ...baseOptions,
      onStateChanged: (s) => stateUpdates.push(JSON.parse(JSON.stringify(s))),
      onText: vi.fn(),
    });

    // Workers ran
    expect(mockAgentLoop).toHaveBeenCalledTimes(2);

    // State transitions: planning → workers running → workers done → synthesizing → done
    const statuses = stateUpdates.map(s => s.agents.map((a: any) => a.status));
    expect(stateUpdates[0].agents[0].status).toBe('running'); // planner running
    expect(result).toContain('Findings');
  });

  it('run continues with partial results when a worker fails', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify([
        { id: 'sub-1', subtask: 'Task 1', goal: 'Goal 1' },
        { id: 'sub-2', subtask: 'Task 2', goal: 'Goal 2' },
      ]),
      toolBlocks: [],
    });
    // Worker 1 succeeds, Worker 2 fails
    mockAgentLoop
      .mockResolvedValueOnce('worker 1 result')
      .mockRejectedValueOnce(new Error('worker 2 failed'));
    // Synthesizer
    mockStreamLLM.mockResolvedValueOnce({ text: '## Summary\n\npartial results', toolBlocks: [] });

    const result = await PipelineOrchestrator.run('some task', {
      ...baseOptions,
      onStateChanged: vi.fn(),
      onText: vi.fn(),
    });

    // Synthesizer still called with partial results
    expect(mockStreamLLM).toHaveBeenCalledTimes(2); // planner + synthesizer
    expect(result).toContain('Summary');
  });

  it('run tolerates planner prose around a fenced JSON array', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: [
        'Here is the plan:',
        '```json',
        JSON.stringify([
          { id: 'sub-1', subtask: 'Task 1', goal: 'Goal 1' },
          { id: 'sub-2', subtask: 'Task 2', goal: 'Goal 2' },
        ]),
        '```',
        'These are the best parallel splits.',
      ].join('\n'),
      toolBlocks: [],
    });
    mockStreamLLM.mockResolvedValueOnce({
      text: '## Summary\n\nparsed planner output',
      toolBlocks: [],
    });

    const result = await PipelineOrchestrator.run('some task', {
      ...baseOptions,
      onStateChanged: vi.fn(),
      onText: vi.fn(),
    });

    expect(mockAgentLoop).toHaveBeenCalledTimes(2);
    expect(result).toContain('Summary');
  });

  it('run tolerates planner JSON wrapped in an object', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify({
        subtasks: [
          { id: 'sub-1', subtask: 'Task 1', goal: 'Goal 1' },
          { id: 'sub-2', subtask: 'Task 2', goal: 'Goal 2' },
        ],
      }),
      toolBlocks: [],
    });
    mockStreamLLM.mockResolvedValueOnce({
      text: '## Summary\n\nparsed planner object',
      toolBlocks: [],
    });

    const result = await PipelineOrchestrator.run('some task', {
      ...baseOptions,
      onStateChanged: vi.fn(),
      onText: vi.fn(),
    });

    expect(mockAgentLoop).toHaveBeenCalledTimes(2);
    expect(result).toContain('Summary');
  });

  it('run tolerates planner markdown list output', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: [
        'Plan:',
        '1. Research market trends: Find the top three current trends.',
        '2. Analyze competitors: Identify the main competing products.',
      ].join('\n'),
      toolBlocks: [],
    });
    mockStreamLLM.mockResolvedValueOnce({
      text: '## Summary\n\nparsed planner list',
      toolBlocks: [],
    });

    const result = await PipelineOrchestrator.run('some task', {
      ...baseOptions,
      onStateChanged: vi.fn(),
      onText: vi.fn(),
    });

    expect(mockAgentLoop).toHaveBeenCalledTimes(2);
    expect(mockAgentLoop).toHaveBeenNthCalledWith(
      1,
      'Find the top three current trends.',
      [],
      expect.objectContaining({ runId: expect.any(String) }),
    );
    expect(mockAgentLoop).toHaveBeenNthCalledWith(
      2,
      'Identify the main competing products.',
      [],
      expect.objectContaining({ runId: expect.any(String) }),
    );
    expect(result).toContain('Summary');
  });
});
