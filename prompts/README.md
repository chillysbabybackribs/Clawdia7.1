# Clawdia Prompts & Agents

This directory contains all system prompts, agent configurations, and tool definitions for the Clawdia project's AI-powered features.

## Directory Structure

```
prompts/
├── system/              # System prompts for different agents
│   ├── developer-assistant.md
│   ├── code-reviewer.md
│   └── [custom-agents].md
│
├── few-shot/           # Few-shot examples for prompt engineering
│   ├── debugging-examples.json
│   ├── refactoring-examples.json
│   └── [more-examples].json
│
└── templates/          # Templates for creating new prompts
    ├── system-prompt-template.md
    └── few-shot-template.json

agents/
├── developer-assistant.json    # Developer agent config
├── code-reviewer.json          # Code review agent config
├── config/
│   ├── agent-registry.json     # Central registry of all agents
│   └── routing-rules.json      # Routing configuration
└── [custom-agents].json

tools/
├── definitions/                # Tool schema definitions
│   ├── project-tools.json
│   └── [custom-tools].json
│
└── implementations/            # TypeScript implementations
    ├── agent-manager.ts
    ├── tool-executor.ts
    └── [other-implementations].ts
```

## Quick Start

### 1. Load Agents

```typescript
import { AgentManager } from './tools/implementations/agent-manager';

const manager = new AgentManager();
await manager.loadRegistry('./agents/config/agent-registry.json');

// Get a specific agent
const agent = manager.getAgent('developer-assistant');
const systemPrompt = manager.getSystemPrompt('developer-assistant');
```

### 2. Route Queries

```typescript
// Automatic routing based on query keywords
const agentId = manager.routeQuery('review my code please');
// Returns: 'code-reviewer'

const agentId = manager.routeQuery('help me debug this');
// Returns: 'developer-assistant'
```

### 3. Check Constraints

```typescript
// Validate command execution
const canRun = manager.canExecuteCommand(
  'developer-assistant',
  'npm test'
);

// Validate file access
const canAccess = manager.canAccessPath(
  'code-reviewer',
  './src/components/Button.tsx'
);
```

## System Prompts

### Available Prompts

#### Developer Assistant (`developer-assistant.md`)
**Purpose**: General development assistance, debugging, and code explanation
**Capabilities**: File reading/writing, command execution, code analysis
**Best for**: 
- Explaining code
- Debugging issues
- Writing new code
- Performance optimization suggestions

#### Code Reviewer (`code-reviewer.md`)
**Purpose**: Comprehensive code review with quality feedback
**Capabilities**: Code analysis, test checking, architecture review
**Focus areas**:
- Security vulnerabilities
- Performance issues
- Maintainability concerns
- Test coverage validation

### Adding a New System Prompt

1. **Copy the template**:
   ```bash
   cp prompts/templates/system-prompt-template.md prompts/system/my-agent.md
   ```

2. **Fill in the template** with your agent's specifications

3. **Create agent config** (`agents/my-agent.json`):
   ```json
   {
     "id": "my-agent",
     "name": "My Custom Agent",
     "system_prompt": {
       "path": "../prompts/system/my-agent.md",
       "priority": "high",
       "version": "1.0"
     },
     // ... rest of config
   }
   ```

4. **Register in agent registry** (`agents/config/agent-registry.json`):
   ```json
   {
     "agents": [
       {
         "id": "my-agent",
         "enabled": true,
         "config_path": "./agents/my-agent.json"
       }
     ]
   }
   ```

## Few-Shot Examples

Few-shot examples help Claude understand the expected format and behavior by showing examples.

### Structure

```json
{
  "examples": [
    {
      "id": "unique-id",
      "type": "debugging|refactoring|explanation",
      "category": "topic-category",
      "input": {
        // What the user provides
      },
      "expected_output": {
        // What the agent should return
      }
    }
  ]
}
```

### Using Examples

Reference examples in your system prompt:

```markdown
## Examples

When responding to debugging questions, follow these patterns:

[Reference few-shot/debugging-examples.json]

Your responses should follow the same structure:
1. Error summary
2. Root cause
3. Solution with code
4. Prevention tips
```

## Agent Configuration

### Required Fields

Every agent configuration must include:

```json
{
  "id": "unique-id",                          // Unique identifier
  "name": "Display Name",                      // Human-readable name
  "version": "1.0.0",                          // SemVer version
  "description": "What this agent does",       // Clear description
  "system_prompt": {                           // System prompt config
    "path": "path/to/prompt.md",
    "priority": "high",
    "version": "1.0"
  },
  "capabilities": {                            // What it can do
    "tools": [],                               // Available tools
    "max_tokens_output": 2048,
    "temperature": 0.7,
    "top_p": 0.9
  },
  "constraints": {                             // What it cannot do
    "file_operations": {},
    "command_restrictions": {}
  }
}
```

### Constraints

Agents should have clear constraints to prevent misuse:

```json
{
  "constraints": {
    "file_operations": {
      "allowed_paths": ["./src/**", "./tests/**"],
      "forbidden_paths": ["./node_modules/**", "./.git/**"],
      "require_approval": true
    },
    "command_restrictions": {
      "allowed_patterns": ["npm test", "npm run"],
      "forbidden_patterns": ["sudo", "rm -rf", "git push"]
    }
  }
}
```

## Tools

### Tool Definition

Tools are defined in `tools/definitions/` as JSON schemas:

```json
{
  "name": "tool_name",
  "description": "What the tool does",
  "input_schema": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "Parameter description"
      }
    },
    "required": ["param1"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "result": { "type": "string" }
    }
  }
}
```

### Tool Implementation

Implement tools in `tools/implementations/`:

```typescript
interface Input {
  // Define input type
}

interface Output {
  // Define output type
}

async function executeTask(input: Input): Promise<Output> {
  // Implementation
}
```

## Best Practices

### ✅ DO

1. **Version your prompts**: Use semantic versioning
2. **Document thoroughly**: Include examples and edge cases
3. **Test regularly**: Verify prompt behavior with test inputs
4. **Keep prompts DRY**: Reuse templates and patterns
5. **Set clear constraints**: Define what agents can/cannot do
6. **Monitor usage**: Track token usage and performance
7. **Update registry**: Keep agent-registry.json current

### ❌ DON'T

1. **Hardcode values**: Use configuration files
2. **Ignore constraints**: Always set security boundaries
3. **Over-prompt**: Keep system prompts concise (1500 tokens max)
4. **Forget testing**: Always test before deploying
5. **Mix concerns**: Keep roles, rules, and examples separate
6. **Skip documentation**: Document changes and versions

## Versioning Prompts

When you modify a prompt:

1. **Update the markdown file**
2. **Increment version** in agent config:
   ```json
   "system_prompt": {
     "version": "1.1"  // Was 1.0
   }
   ```
3. **Update last_updated** in prompt:
   ```markdown
   **Last Updated**: March 30, 2024
   **Version**: 1.1
   ```
4. **Add changelog entry**:
   ```markdown
   ## Changelog
   - 1.1 (Mar 30): Added example for edge case handling
   - 1.0 (Mar 29): Initial version
   ```

## Monitoring & Metrics

The AgentManager tracks:
- Tokens used
- Tool calls made
- Error rates
- Response times
- Usage patterns

```typescript
const context = manager.getContextMetrics(conversationId);
console.log(`Tokens: ${context.tokensUsed}`);
console.log(`Tool calls: ${context.toolCallCount}`);
```

## Troubleshooting

### Agent Not Loading
```
Error: System prompt not found for agent
```
**Solution**: Check that the system_prompt.path is correct relative to the agent config file

### Command Execution Denied
```
Error: Command execution denied for agent
```
**Solution**: Add the command pattern to allowed_patterns in constraints, or check forbidden_patterns

### Routing Not Working
```
Agent routed to wrong handler
```
**Solution**: Check routing rules priority in agent-registry.json, higher priority matches first

## Examples

### Using with Claude API

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { AgentManager } from './tools/implementations/agent-manager';

const client = new Anthropic();
const manager = new AgentManager();
await manager.loadRegistry('./agents/config/agent-registry.json');

// Route to appropriate agent
const agentId = manager.routeQuery(userQuery);
const agent = manager.getAgent(agentId);
const systemPrompt = manager.getSystemPrompt(agentId);

// Call Claude with agent's system prompt
const response = await client.messages.create({
  model: 'claude-3-opus-20240229',
  max_tokens: agent.capabilities.max_tokens_output,
  system: systemPrompt,
  temperature: agent.capabilities.temperature,
  messages: [
    { role: 'user', content: userQuery }
  ]
});
```

## Resources

- **System Prompts Guide**: https://docs.anthropic.com/en/docs/guides/system-prompts
- **Tool Use Guide**: https://docs.anthropic.com/en/docs/guides/tool-use
- **Claude API Docs**: https://docs.anthropic.com

## Contributing

To add a new agent:

1. Create system prompt in `prompts/system/`
2. Create agent config in `agents/`
3. Define tools in `tools/definitions/`
4. Implement tools in `tools/implementations/`
5. Register in `agents/config/agent-registry.json`
6. Test thoroughly
7. Document changes

---

**Last Updated**: March 29, 2024  
**Maintained by**: Clawdia Team
