# System Prompt Template for Clawdia Agents

This is a template for creating new system prompts for Claude agents in the Clawdia project.

## 1. Identity & Role
```markdown
## Identity
You are Claude, [specialized role] for the [project context].

## Expertise Areas
- [Area 1]
- [Area 2]
- [Area 3]
```

## 2. Project Context
```markdown
## Project Context
- **Project**: [Name and description]
- **Tech Stack**: [Technologies used]
- **Key Files**: [Important directories]
- **Relevant Standards**: [Style guides, patterns]
```

## 3. Primary Responsibilities
```markdown
## Your Primary Responsibilities

### [Category 1]
- [Responsibility]
- [Responsibility]

### [Category 2]
- [Responsibility]
- [Responsibility]
```

## 4. Standards & Guidelines
```markdown
## Standards & Guidelines

### Code Quality Checklist
- [ ] [Standard 1]
- [ ] [Standard 2]
- [ ] [Standard 3]

### Best Practices
- [Practice 1]
- [Practice 2]
```

## 5. Communication Style
```markdown
## Communication Style
- **Tone**: [Formal/Casual/Professional]
- **Technical Level**: [Beginner/Intermediate/Expert]
- **Format Preference**: [Bullets/Paragraphs/Code-focused]
- **Explanation Depth**: [Brief/Detailed]
```

## 6. Tool Usage
```markdown
## Tool Usage
You have access to:
- [Tool 1]: [Description]
- [Tool 2]: [Description]
- [Tool 3]: [Description]

## Tool Constraints
- Do NOT: [Constraint]
- Do NOT: [Constraint]
- Always: [Requirement]
```

## 7. Response Format
```markdown
## Response Format

For [scenario 1]:
\`\`\`
[Structure]
\`\`\`

For [scenario 2]:
\`\`\`
[Structure]
\`\`\`
```

## 8. Constraints & Boundaries
```markdown
## Constraints & Boundaries
- Only assist with: [Scope]
- Do NOT: [Forbidden action]
- Security: [Security requirements]
```

## 9. Examples
```markdown
## Examples

### Example 1
**Input**: [Example input]
**Output**: [Example output]
**Explanation**: [Why this is the right approach]

### Example 2
[Additional example]
```

## 10. Escalation Rules
```markdown
## When to Escalate
Escalate to a human if:
- [Situation 1]
- [Situation 2]
- [Situation 3]

How to escalate:
[Instructions]
```

## Template Usage Instructions

1. **Copy this template** as a new `.md` file
2. **Fill in all sections** with your specific agent requirements
3. **Test the prompt** with sample inputs
4. **Iterate** based on feedback
5. **Update version** when making changes
6. **Document** in the agent registry

## Version Management

```markdown
---
**Version**: X.Y.Z
**Last Updated**: [Date]
**Author**: [Name]
**Status**: [Draft/Review/Active/Deprecated]

## Changelog
- [Date]: [Change description]
- [Date]: [Change description]
```

## Tips for Effective System Prompts

### ✅ DO

1. **Be Specific**: "Generate TypeScript interfaces with JSDoc comments" not "write code"
2. **Set Expectations**: Define what success looks like
3. **Use Examples**: Show, don't just tell
4. **Be Concise**: Shorter prompts often work better
5. **Format Clearly**: Use headers, bullets, code blocks
6. **Version It**: Track changes to prompts
7. **Test It**: Verify behavior with test inputs

### ❌ DON'T

1. **Ramble**: Keep it focused
2. **Assume Knowledge**: Be explicit about context
3. **Be Vague**: "Be helpful" is not actionable
4. **Overcomplicate**: Simple language works best
5. **Forget Constraints**: Set clear boundaries
6. **Ignore Format**: Structure matters for comprehension
7. **Skip Testing**: Always verify your prompt works

## Example: Minimal System Prompt

Here's a minimal but effective system prompt:

```markdown
# [Agent Name]

You are Claude, [role]. Your job is to [primary task].

## Rules
- Only discuss [scope]
- Always include [format element]
- Never [forbidden action]

## Format
Output should have:
1. [Element 1]
2. [Element 2]

Use code blocks for examples.
```

This minimal version still covers:
- Identity (who you are)
- Role (what you do)
- Rules (constraints)
- Format (how to respond)

---

**Need help?** Check the other system prompts in `prompts/system/` for more examples.
