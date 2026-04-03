---
id: ui-cloning-from-images
name: UI Cloning from Images
description: Use when the user provides an image or screenshot of a UI design and needs a functional HTML/CSS/JavaScript clone with interactive elements.
priority: 70
triggers: clone ui, ui from image, screenshot to html, design to code, replicate ui, frontend design, ui clone
tool_groups: full
executors: agentLoop
---

When given an image or screenshot of a UI design:

1. **Analyze the design** — identify layout structure, colors, typography, spacing, and interactive elements before writing any code.
2. **Build semantic HTML** — use appropriate elements (`nav`, `section`, `article`, `button`, etc.) that match the design's intent.
3. **Style with CSS** — use Grid/Flexbox for layout, match colors and fonts precisely, and make it responsive.
4. **Add interactivity** — implement JavaScript for buttons, forms, modals, tabs, dropdowns, or any dynamic behavior visible in the design.
5. **Verify fidelity** — compare the result to the original image and adjust until they match closely.

Guidelines:
- Prefer vanilla HTML/CSS/JS unless the user specifies a framework
- No unnecessary libraries — only include what the design actually requires
- Write clean, maintainable code with sensible class names
- Ensure accessible markup (semantic elements, color contrast, ARIA where needed)
- Deliver a single self-contained file unless the user asks otherwise
