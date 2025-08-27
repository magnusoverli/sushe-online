#!/usr/bin/env node

/**
 * Autonomous Planning & Tracking System
 * Manages plans, tasks, and automatically updates TODO.md
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');

class PlanningSystem {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.todoPath = path.join(projectRoot, 'TODO.md');
    this.plansDir = path.join(projectRoot, 'plans');
    this.activeDir = path.join(this.plansDir, 'active');
    this.backlogDir = path.join(this.plansDir, 'backlog');
    this.completedDir = path.join(this.plansDir, 'completed');
    this.templatesDir = path.join(this.plansDir, 'templates');

    this.plans = new Map();
    this.tasks = new Map(); // Simple standalone tasks
    this.metrics = {
      totalPlans: 0,
      activePlans: 0,
      completedPlans: 0,
      totalTasks: 0,
      completedTasks: 0,
      plansProgress: 0,
      tasksProgress: 0,
    };
  }

  async initialize() {
    await this.ensureDirectories();
    await this.loadPlans();
    await this.loadTasksFromTodo();
    await this.calculateMetrics();
  }

  async ensureDirectories() {
    const dirs = [
      this.plansDir,
      this.activeDir,
      this.backlogDir,
      this.completedDir,
      this.templatesDir,
    ];
    for (const dir of dirs) {
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }

  async loadPlans() {
    try {
      const activeFiles = await fs.readdir(this.activeDir).catch(() => []);
      const backlogFiles = await fs.readdir(this.backlogDir).catch(() => []);
      const completedFiles = await fs
        .readdir(this.completedDir)
        .catch(() => []);

      for (const file of activeFiles) {
        if (file.endsWith('.md')) {
          const plan = await this.parsePlanFile(
            path.join(this.activeDir, file)
          );
          if (plan) {
            plan.status = 'active';
            this.plans.set(plan.id, plan);
          }
        }
      }

      for (const file of backlogFiles) {
        if (file.endsWith('.md')) {
          const plan = await this.parsePlanFile(
            path.join(this.backlogDir, file)
          );
          if (plan) {
            plan.status = 'backlog';
            this.plans.set(plan.id, plan);
          }
        }
      }

      for (const file of completedFiles) {
        if (file.endsWith('.md')) {
          const plan = await this.parsePlanFile(
            path.join(this.completedDir, file)
          );
          if (plan) {
            plan.status = 'completed';
            this.plans.set(plan.id, plan);
          }
        }
      }
    } catch (error) {
      logger.warn('Could not load plans:', { error: error.message });
    }
  }

  async parsePlanFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const plan = { filePath };

      // Extract plan metadata
      const idMatch = content.match(/\*\*ID\*\*:\s*(.+)/);
      const titleMatch = content.match(/\*\*Title\*\*:\s*(.+)/);
      const statusMatch = content.match(/\*\*Status\*\*:\s*(.+)/);
      const priorityMatch = content.match(/\*\*Priority\*\*:\s*(.+)/);
      const createdMatch = content.match(/\*\*Created\*\*:\s*(.+)/);
      const progressMatch = content.match(/\*\*Overall Progress\*\*:\s*(.+)/);
      const phaseMatch = content.match(/\*\*Current Phase\*\*:\s*(.+)/);

      if (idMatch) plan.id = idMatch[1].trim();
      if (titleMatch) plan.title = titleMatch[1].trim();
      if (statusMatch) plan.status = statusMatch[1].trim();
      if (priorityMatch) plan.priority = priorityMatch[1].trim();
      if (createdMatch) plan.created = createdMatch[1].trim();
      if (progressMatch) plan.progress = progressMatch[1].trim();
      if (phaseMatch) plan.currentPhase = phaseMatch[1].trim();

      // Extract success criteria completion
      const successCriteria = content.match(
        /## Success Criteria\n([\s\S]*?)(?=\n##|$)/
      );
      if (successCriteria) {
        const criteriaText = successCriteria[1];
        const totalCriteria = (criteriaText.match(/- \[[ x]\]/g) || []).length;
        const completedCriteria = (criteriaText.match(/- \[x\]/g) || []).length;
        plan.criteriaProgress =
          totalCriteria > 0
            ? Math.round((completedCriteria / totalCriteria) * 100)
            : 0;
      }

      return plan;
    } catch (error) {
      logger.warn('Could not parse plan file:', {
        filePath,
        error: error.message,
      });
      return null;
    }
  }

  async loadTasksFromTodo() {
    try {
      const todoContent = await fs.readFile(this.todoPath, 'utf8');

      // Extract tasks from Quick Tasks section
      const tasksSection = todoContent.match(
        /## 📋 Quick Tasks\n([\s\S]*?)(?=\n##|$)/
      );
      if (tasksSection) {
        const taskMatches = tasksSection[1].matchAll(
          /- \[([ x])\] \*\*TASK-(\d+)\*\*:\s*(.+)/g
        );
        for (const match of taskMatches) {
          const [, completed, taskId, description] = match;
          this.tasks.set(`TASK-${taskId}`, {
            id: `TASK-${taskId}`,
            description: description.trim(),
            completed: completed === 'x',
            type: 'quick',
          });
        }
      }
    } catch (error) {
      logger.warn('Could not load tasks from TODO.md:', {
        error: error.message,
      });
    }
  }

  calculateMetrics() {
    this.metrics.totalPlans = this.plans.size;
    this.metrics.activePlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'active' || p.status === 'In Progress'
    ).length;
    this.metrics.backlogPlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'backlog'
    ).length;
    this.metrics.completedPlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'completed' || p.status === 'Completed'
    ).length;
    this.metrics.totalTasks = this.tasks.size;
    this.metrics.completedTasks = Array.from(this.tasks.values()).filter(
      (t) => t.completed
    ).length;

    // Calculate plans progress (average of all plan progress)
    const activePlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'active' || p.status === 'In Progress'
    );
    if (activePlans.length > 0) {
      const totalProgress = activePlans.reduce((sum, plan) => {
        const progress = plan.criteriaProgress || parseInt(plan.progress) || 0;
        return sum + progress;
      }, 0);
      this.metrics.plansProgress = Math.round(
        totalProgress / activePlans.length
      );
    } else {
      this.metrics.plansProgress = 0;
    }

    // Calculate tasks progress
    this.metrics.tasksProgress =
      this.metrics.totalTasks > 0
        ? Math.round(
            (this.metrics.completedTasks / this.metrics.totalTasks) * 100
          )
        : 0;
  }

  async updateTodoFile() {
    const activePlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'active' || p.status === 'In Progress'
    );
    const backlogPlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'backlog'
    );
    const completedPlans = Array.from(this.plans.values()).filter(
      (p) => p.status === 'completed' || p.status === 'Completed'
    );
    const activeTasks = Array.from(this.tasks.values()).filter(
      (t) => !t.completed
    );

    const now = new Date().toISOString().split('T')[0];

    let content = `# SuShe Online - Planning & Tracking System

*Last updated: ${now}*
*System version: 2.0.0*

## 📋 Backlog Plans

`;

    if (backlogPlans.length === 0) {
      content += '*No plans in backlog*\n\n';
    } else {
      for (const plan of backlogPlans) {
        const progress = plan.criteriaProgress || parseInt(plan.progress) || 0;
        content += `### [${plan.id}] ${plan.title}
- **Status**: ${plan.status}
- **Priority**: ${plan.priority}
- **Created**: ${plan.created}
- **Progress**: ${progress}%
- **Owner**: System
- **Description**: ${plan.title}
- **Location**: \`plans/backlog/${plan.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md\`

`;
      }
    }

    content += `## 🎯 Active Plans

`;

    if (activePlans.length === 0) {
      content += '*No active plans*\n\n';
    } else {
      for (const plan of activePlans) {
        const progress = plan.criteriaProgress || parseInt(plan.progress) || 0;
        content += `### [${plan.id}] ${plan.title}
- **Status**: ${plan.status}
- **Priority**: ${plan.priority}
- **Started**: ${plan.created}
- **Progress**: ${progress}%
- **Phase**: ${plan.currentPhase || 'Development'}
- **Owner**: System
- **Description**: ${plan.title}
- **Location**: \`plans/active/${plan.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md\`

`;
      }
    }

    content += `## ✅ Completed Plans

`;

    if (completedPlans.length === 0) {
      content += '*No completed plans yet*\n\n';
    } else {
      for (const plan of completedPlans) {
        content += `### [${plan.id}] ${plan.title}
- **Completed**: ${plan.completed || 'Unknown'}
- **Priority**: ${plan.priority}
- **Location**: \`plans/completed/${plan.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md\`

`;
      }
    }

    content += `## 📋 Quick Tasks

### High Priority
`;

    const highPriorityTasks = activeTasks.filter((t) => t.priority === 'High');
    if (highPriorityTasks.length === 0) {
      content += '*No high priority tasks*\n\n';
    } else {
      for (const task of highPriorityTasks) {
        content += `- [ ] **${task.id}**: ${task.description}
  - **Type**: ${task.type || 'Quick Fix'}
  - **Estimated**: ${task.estimated || '15 minutes'}
  - **Context**: ${task.context || 'N/A'}

`;
      }
    }

    content += `### Medium Priority
`;

    const mediumPriorityTasks = activeTasks.filter(
      (t) => t.priority === 'Medium'
    );
    if (mediumPriorityTasks.length === 0) {
      content += '*No medium priority tasks*\n\n';
    } else {
      for (const task of mediumPriorityTasks) {
        content += `- [ ] **${task.id}**: ${task.description}
  - **Type**: ${task.type || 'Quick Fix'}
  - **Estimated**: ${task.estimated || '15 minutes'}
  - **Context**: ${task.context || 'N/A'}

`;
      }
    }

    content += `### Low Priority
`;

    const lowPriorityTasks = activeTasks.filter((t) => t.priority === 'Low');
    if (lowPriorityTasks.length === 0) {
      content += '*No low priority tasks*\n\n';
    } else {
      for (const task of lowPriorityTasks) {
        content += `- [ ] **${task.id}**: ${task.description}
  - **Type**: ${task.type || 'Quick Fix'}
  - **Estimated**: ${task.estimated || '15 minutes'}
  - **Context**: ${task.context || 'N/A'}

`;
      }
    }

    content += `## 🚧 Blockers

*No active blockers*

## 📊 Current Focus

### This Week
${activePlans.length > 0 ? activePlans.map((p) => `- ${p.title}`).join('\n') : '- No active plans'}

### Next Week
- Monitor system performance
- Gather feedback and iterate

## 📈 Metrics

- **Total Plans**: ${this.metrics.totalPlans} (${this.metrics.backlogPlans} backlog, ${this.metrics.activePlans} active, ${this.metrics.completedPlans} completed)
- **Total Tasks**: ${this.metrics.totalTasks} (${this.metrics.completedTasks} completed, ${this.metrics.totalTasks - this.metrics.completedTasks} pending)
- **Plans Progress**: ${this.metrics.plansProgress}%
- **Tasks Completion Rate**: ${this.metrics.tasksProgress}%
- **System Health**: ✅ Operational

## 🔄 System Status

- **Last Auto-Update**: ${now}
- **Next Scheduled Update**: Auto (on file changes)
- **Auto-Planning**: ✅ Enabled
- **Auto-Tracking**: ✅ Enabled
- **Auto-Completion**: ✅ Enabled

---

*This file is automatically maintained by the Planning & Tracking System*
*Plans are self-contained units • Tasks are quick, simple changes*`;

    await fs.writeFile(this.todoPath, content, 'utf8');
  }

  async createPlan(planData) {
    // Ensure plans are loaded before generating ID
    if (this.plans.size === 0) {
      await this.loadPlans();
    }

    let planId;
    if (planData.id) {
      planId = planData.id;
    } else {
      // Generate unique ID by finding the highest existing plan number
      const existingIds = Array.from(this.plans.keys())
        .filter((id) => id.startsWith('PLAN-'))
        .map((id) => parseInt(id.replace('PLAN-', '')))
        .filter((num) => !isNaN(num));

      const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
      planId = `PLAN-${String(nextNum).padStart(3, '0')}`;
    }

    const fileName = `${planId.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;

    // Determine target directory based on status
    let targetDir = this.activeDir;
    if (planData.status === 'backlog') {
      targetDir = this.backlogDir;
    }

    const filePath = path.join(targetDir, fileName);

    const planContent = this.generatePlanTemplate(planData, planId);
    await fs.writeFile(filePath, planContent, 'utf8');

    await this.loadPlans();
    await this.calculateMetrics();
    await this.updateTodoFile();

    return planId;
  }

  generatePlanTemplate(planData, planId) {
    const now = new Date().toISOString().split('T')[0];
    const status = planData.status || 'Active';

    return `# ${planId}: ${planData.title}

## Plan Overview
- **ID**: ${planId}
- **Title**: ${planData.title}
- **Status**: ${status}
- **Priority**: ${planData.priority || 'Medium'}
- **Created**: ${now}
- **Started**: ${status === 'Active' ? now : 'Not started'}
- **Estimated Completion**: ${planData.estimatedCompletion || 'TBD'}
- **Owner**: ${planData.owner || 'System'}
- **Type**: ${planData.type || 'Development'}

## Description
${planData.description || 'Plan description to be added.'}

## Objectives
${planData.objectives ? planData.objectives.map((obj) => `- ${obj}`).join('\n') : '- Objectives to be defined'}

## Success Criteria
${planData.successCriteria ? planData.successCriteria.map((criteria) => `- [ ] ${criteria}`).join('\n') : '- [ ] Success criteria to be defined'}

## Tasks Breakdown
${planData.tasks ? planData.tasks.map((task) => `- [ ] **${task.id}**: ${task.description}`).join('\n') : '- [ ] Tasks to be defined'}

## Progress Tracking
- **Overall Progress**: 0%

## Dependencies
${planData.dependencies ? planData.dependencies.join(', ') : 'None'}

## Risks & Mitigation
${planData.risks ? planData.risks.map((risk) => `- **Risk**: ${risk.description}\n  - **Mitigation**: ${risk.mitigation}`).join('\n') : '- No identified risks'}

## Resources
- Project root: \`${this.projectRoot}\`

## Notes
${planData.notes || 'No additional notes.'}

## Change Log
- **${now}**: Plan created

---
*Auto-generated by Planning & Tracking System v1.0.0*`;
  }

  async completePlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan || plan.status === 'completed') {
      return false;
    }

    const oldPath = plan.filePath;
    const fileName = path.basename(oldPath);
    const newPath = path.join(this.completedDir, fileName);

    // Update plan content to mark as completed
    let content = await fs.readFile(oldPath, 'utf8');
    const now = new Date().toISOString().split('T')[0];
    content = content.replace(
      /- \*\*Status\*\*:\s*(.+)/,
      `- **Status**: Active`
    );
    content = content.replace(
      /## Change Log/,
      `## Change Log\n- **${now}**: Plan completed and moved to completed directory`
    );

    await fs.writeFile(newPath, content, 'utf8');
    await fs.unlink(oldPath);

    await this.loadPlans();
    await this.calculateMetrics();
    await this.updateTodoFile();

    return true;
  }

  async moveToBacklog(planId) {
    const plan = this.plans.get(planId);
    if (!plan || plan.status === 'backlog') {
      return false;
    }

    const oldPath = plan.filePath;
    const fileName = path.basename(oldPath);
    const newPath = path.join(this.backlogDir, fileName);

    // Update plan content to mark as backlog
    let content = await fs.readFile(oldPath, 'utf8');
    const now = new Date().toISOString().split('T')[0];
    content = content.replace(/\*\*Status\*\*:\s*(.+)/, `**Status**: Backlog`);
    content = content.replace(
      /## Change Log/,
      `## Change Log\n- **${now}**: Plan moved to backlog`
    );

    await fs.writeFile(newPath, content, 'utf8');
    await fs.unlink(oldPath);

    await this.loadPlans();
    await this.calculateMetrics();
    await this.updateTodoFile();

    return true;
  }

  async moveToActive(planId) {
    const plan = this.plans.get(planId);
    if (!plan || plan.status === 'active') {
      return false;
    }

    const oldPath = plan.filePath;
    const fileName = path.basename(oldPath);
    const newPath = path.join(this.activeDir, fileName);

    // Update plan content to mark as active
    let content = await fs.readFile(oldPath, 'utf8');
    const now = new Date().toISOString().split('T')[0];
    content = content.replace(/\*\*Status\*\*:\s*(.+)/, `**Status**: Active`);
    content = content.replace(
      /## Change Log/,
      `## Change Log\n- **${now}**: Plan moved to active`
    );

    await fs.writeFile(newPath, content, 'utf8');
    await fs.unlink(oldPath);

    await this.loadPlans();
    await this.calculateMetrics();
    await this.updateTodoFile();

    return true;
  }

  async autoUpdate() {
    await this.initialize();
    await this.updateTodoFile();
    logger.info('Planning system updated successfully');
  }

  async watchForChanges() {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch([this.activeDir, this.completedDir], {
      ignored: /(^|[/\\])\../,
      persistent: true,
    });

    watcher.on('change', () => this.autoUpdate());
    watcher.on('add', () => this.autoUpdate());
    watcher.on('unlink', () => this.autoUpdate());

    logger.info('Planning system is now watching for changes...');
  }
}

// CLI interface
if (require.main === module) {
  const system = new PlanningSystem();

  const command = process.argv[2];

  switch (command) {
    case 'init':
      system.initialize().then(() => {
        logger.info('Planning system initialized');
      });
      break;

    case 'update':
      system.autoUpdate();
      break;

    case 'watch':
      system.watchForChanges();
      break;

    case 'create-plan': {
      const planData = JSON.parse(process.argv[3] || '{}');
      system.createPlan(planData).then((planId) => {
        logger.info(`Created plan: ${planId}`);
      });
      break;
    }

    case 'complete-plan': {
      const planId = process.argv[3];
      system.completePlan(planId).then((success) => {
        logger.info(
          success
            ? `Plan ${planId} completed`
            : `Failed to complete plan ${planId}`
        );
      });
      break;
    }

    case 'backlog-plan': {
      const planId = process.argv[3];
      system.moveToBacklog(planId).then((success) => {
        logger.info(
          success
            ? `Plan ${planId} moved to backlog`
            : `Failed to move plan ${planId} to backlog`
        );
      });
      break;
    }

    case 'activate-plan': {
      const planId = process.argv[3];
      system.moveToActive(planId).then((success) => {
        logger.info(
          success
            ? `Plan ${planId} moved to active`
            : `Failed to move plan ${planId} to active`
        );
      });
      break;
    }

    default:
      // eslint-disable-next-line no-console
      console.log(`
Usage: node planning-system.js <command>

Commands:
   init          Initialize the planning system
   update        Update TODO.md and recalculate metrics
   watch         Watch for changes and auto-update
   create-plan   Create a new plan (requires JSON data as second argument)
   complete-plan Complete a plan (requires plan ID as second argument)
   backlog-plan  Move a plan to backlog (requires plan ID as second argument)
   activate-plan Move a plan to active (requires plan ID as second argument)
`);
  }
}

module.exports = PlanningSystem;
