# Planning & Tracking System

A streamlined autonomous planning and tracking system for the SuShe Online project.

## Overview

The system uses a clean separation between **Plans** and **Tasks**:

- **Plans**: Self-contained units for complex, multi-step work (features, refactors, infrastructure)
- **Tasks**: Quick, simple changes (fix typos, update colors, small content changes)

## Files Structure

```
├── TODO.md                    # Main tracking file (auto-maintained)
├── plans/
│   ├── active/                # Active plans
│   ├── completed/             # Completed plans
│   └── templates/             # Plan templates
├── planning-system.js         # Core system
├── planning-utils.js          # Utilities and helpers
└── PLANNING.md               # This documentation
```

## Usage

### NPM Scripts

```bash
# Initialize the system
npm run plan:init

# Update TODO.md manually
npm run plan:update

# Watch for changes and auto-update
npm run plan:watch

# Create a new plan
npm run plan:create

# Generate progress report
npm run plan:report

# Auto-complete finished plans
npm run plan:complete
```

### Creating Plans

Plans are self-contained units that track their own progress through success criteria:

```bash
# Create a plan with JSON data
node planning-utils.js create-plan '{
  "title": "Add Dark Mode",
  "description": "Implement dark mode toggle for better user experience",
  "priority": "High",
  "type": "Feature",
  "objectives": [
    "Add theme toggle component",
    "Implement dark color scheme",
    "Save user preference"
  ]
}'
```

### Managing Tasks

Tasks are simple, quick changes that don't require complex planning:

1. Add tasks directly to TODO.md under "Quick Tasks"
2. Use format: `- [ ] **TASK-XXX**: Description`
3. Include type, estimated time, and context

### Plan Lifecycle

1. **Create**: Plans start in `plans/active/`
2. **Track**: Progress tracked through success criteria checkboxes
3. **Complete**: When all criteria met, move to `plans/completed/`
4. **Archive**: Completed plans remain for reference

## Key Features

- **Autonomous**: System automatically updates TODO.md
- **Self-contained Plans**: No complex task breakdown within plans
- **Simple Tasks**: Quick fixes separate from complex work
- **Progress Tracking**: Visual progress through success criteria
- **Integration**: Works with existing development workflow

## Philosophy

- Plans should be complete, coherent units of work
- Tasks should be simple, quick changes (< 30 minutes)
- System should be autonomous and low-maintenance
- Focus on clarity and simplicity over complex features

## Examples

### Good Plan Examples

- "Implement user authentication system"
- "Add real-time notifications"
- "Refactor database layer"
- "Set up CI/CD pipeline"

### Good Task Examples

- "Fix typo in login page title"
- "Update copyright year in footer"
- "Change button color to blue"
- "Add missing alt text to logo"

### What NOT to do

- Don't break plans into sub-tasks
- Don't create plans for simple changes
- Don't manually edit TODO.md (use the system)
- Don't create overly complex plans

## System Status

The planning system is operational and integrated with the project workflow. It automatically maintains the TODO.md file and tracks progress across all plans and tasks.
