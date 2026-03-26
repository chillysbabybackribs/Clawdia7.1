// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelineBlock from '../../src/renderer/components/PipelineBlock';
import type { SwarmState } from '../../src/shared/types';

// Mock the clawdia API
const mockOnStateChanged = vi.fn();
const mockOff = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, 'clawdia', {
    value: {
      swarm: {
        onStateChanged: (cb: (s: SwarmState) => void) => {
          mockOnStateChanged.mockImplementation(cb);
          return mockOff;
        },
      },
    },
    configurable: true,
    writable: true,
  });
});

const runningState: SwarmState = {
  runId: 'run-1',
  totalAgents: 3,
  startedAt: Date.now() - 5000,
  agents: [
    { id: 'planner', role: 'coordinator', goal: 'Plan tasks', status: 'done', startedAt: Date.now() - 5000, completedAt: Date.now() - 4000, toolCallCount: 0 },
    { id: 'sub-1', role: 'analyst', goal: 'Research trends', status: 'running', startedAt: Date.now() - 4000, toolCallCount: 9 },
    { id: 'synthesizer', role: 'synthesizer', goal: 'Synthesize results', status: 'queued', toolCallCount: 0 },
  ],
};

const completedState: SwarmState = {
  ...runningState,
  completedAt: Date.now(),
  agents: runningState.agents.map(a => ({ ...a, status: 'done' as const, completedAt: Date.now() })),
};

describe('PipelineBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no state received yet', () => {
    const { container } = render(<PipelineBlock />);
    expect(container.firstChild).toBeNull();
  });

  it('shows running state with agent list when state arrives', async () => {
    render(<PipelineBlock />);
    act(() => mockOnStateChanged(runningState));
    expect(screen.getByText(/Running pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Research trends/i)).toBeInTheDocument();
    expect(screen.getByText(/9 tools/i)).toBeInTheDocument();
  });

  it('collapses to single line on completion', async () => {
    render(<PipelineBlock />);
    act(() => mockOnStateChanged(completedState));
    expect(screen.getByText(/Pipeline complete/i)).toBeInTheDocument();
    // Agent rows should not be visible in collapsed state
    expect(screen.queryByText(/Research trends/i)).not.toBeInTheDocument();
  });

  it('toggles expanded/collapsed on header click', async () => {
    const user = userEvent.setup();
    render(<PipelineBlock />);
    act(() => mockOnStateChanged(runningState));
    // Initially expanded (running state auto-expands)
    expect(screen.getByText(/Research trends/i)).toBeInTheDocument();
    // Click to collapse
    await user.click(screen.getByText(/Running pipeline/i));
    expect(screen.queryByText(/Research trends/i)).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<PipelineBlock />);
    unmount();
    expect(mockOff).toHaveBeenCalled();
  });
});
