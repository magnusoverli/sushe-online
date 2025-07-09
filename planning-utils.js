#!/usr/bin/env node

/**
 * Planning System Utilities
 * Helper functions and CLI tools for the planning system
 */

const fs = require('fs').promises;
const path = require('path');
const PlanningSystem = require('./planning-system');

class PlanningUtils {
  constructor(projectRoot = process.cwd()) {
    this.system = new PlanningSystem(projectRoot);
    this.projectRoot = projectRoot;
  }

  async createPlanFromTemplate(planData) {
    const template = await this.loadTemplate('plan-template.md');
    const planId = planData.id || `PLAN-${String(Date.now()).slice(-3)}`;
    const now = new Date().toISOString().split('T')[0];

    let content = template
      .replace(/PLAN-XXX/g, planId)
      .replace(/\[Plan Title\]/g, planData.title || 'Untitled Plan')
      .replace(/\[High\/Medium\/Low\]/g, planData.priority || 'Medium')
      .replace(/\[YYYY-MM-DD\]/g, now)
      .replace(/\[Owner Name\]/g, planData.owner || 'System')
      .replace(
        /\[Development\/Infrastructure\/Research\/Bug Fix\/Feature\]/g,
        planData.type || 'Development'
      )
      .replace(
        /\[Detailed description of what this plan aims to accomplish\]/g,
        planData.description || 'Plan description to be added.'
      )
      .replace(
        /\[Primary objective 1\]/g,
        planData.objectives?.[0] || 'Objective 1 to be defined'
      )
      .replace(
        /\[Primary objective 2\]/g,
        planData.objectives?.[1] || 'Objective 2 to be defined'
      )
      .replace(
        /\[Primary objective 3\]/g,
        planData.objectives?.[2] || 'Objective 3 to be defined'
      );

    // Add tasks if provided
    if (planData.tasks && planData.tasks.length > 0) {
      let tasksSection = '\n## Tasks Breakdown\n\n';
      planData.tasks.forEach((task, index) => {
        tasksSection += `- [ ] **TASK-${String(index + 1).padStart(3, '0')}**: ${task.description}\n`;
        if (task.dependencies)
          tasksSection += `  - **Dependencies**: ${task.dependencies}\n`;
        if (task.effort)
          tasksSection += `  - **Estimated Effort**: ${task.effort}\n`;
        tasksSection += '\n';
      });
      content = content.replace(
        /## Tasks Breakdown[\s\S]*?## Progress Tracking/,
        tasksSection + '## Progress Tracking'
      );
    }

    const fileName = `${planId.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
    const filePath = path.join(this.system.activeDir, fileName);

    await fs.writeFile(filePath, content, 'utf8');
    return planId;
  }

  async loadTemplate(templateName) {
    const templatePath = path.join(this.system.templatesDir, templateName);
    return await fs.readFile(templatePath, 'utf8');
  }

  async generateProjectPlan(projectData) {
    const planData = {
      title: `${projectData.name} Development Plan`,
      description: `Comprehensive development plan for ${projectData.name}`,
      priority: 'High',
      type: 'Development',
      objectives: [
        'Complete all planned features',
        'Ensure code quality and testing',
        'Deploy to production successfully',
      ],
      tasks:
        projectData.features?.map((feature, index) => ({
          description: `Implement ${feature}`,
          effort: '2-4 hours',
          dependencies:
            index > 0 ? `TASK-${String(index).padStart(3, '0')}` : 'None',
        })) || [],
    };

    return await this.createPlanFromTemplate(planData);
  }

  async analyzeProjectProgress() {
    await this.system.initialize();

    const analysis = {
      totalPlans: this.system.plans.size,
      activePlans: Array.from(this.system.plans.values()).filter(
        (p) => p.status === 'active'
      ).length,
      completedPlans: Array.from(this.system.plans.values()).filter(
        (p) => p.status === 'completed'
      ).length,
      totalTasks: this.system.tasks.size,
      completedTasks: Array.from(this.system.tasks.values()).filter(
        (t) => t.completed
      ).length,
      overallProgress: this.system.metrics.overallProgress,
      planDetails: [],
    };

    for (const plan of this.system.plans.values()) {
      const planTasks = Array.from(this.system.tasks.values()).filter(
        (t) => t.planId === plan.id
      );
      const completedPlanTasks = planTasks.filter((t) => t.completed);
      const planProgress =
        planTasks.length > 0
          ? Math.round((completedPlanTasks.length / planTasks.length) * 100)
          : 0;

      analysis.planDetails.push({
        id: plan.id,
        title: plan.title,
        status: plan.status,
        priority: plan.priority,
        progress: planProgress,
        totalTasks: planTasks.length,
        completedTasks: completedPlanTasks.length,
      });
    }

    return analysis;
  }

  async generateProgressReport() {
    const analysis = await this.analyzeProjectProgress();
    const now = new Date().toISOString().split('T')[0];

    let report = `# Project Progress Report - ${now}\n\n`;

    report += `## Summary\n`;
    report += `- **Total Plans**: ${analysis.totalPlans}\n`;
    report += `- **Active Plans**: ${analysis.activePlans}\n`;
    report += `- **Completed Plans**: ${analysis.completedPlans}\n`;
    report += `- **Total Tasks**: ${analysis.totalTasks}\n`;
    report += `- **Completed Tasks**: ${analysis.completedTasks}\n`;
    report += `- **Overall Progress**: ${analysis.overallProgress}%\n\n`;

    report += `## Plan Details\n\n`;
    for (const plan of analysis.planDetails) {
      report += `### ${plan.id}: ${plan.title}\n`;
      report += `- **Status**: ${plan.status}\n`;
      report += `- **Priority**: ${plan.priority}\n`;
      report += `- **Progress**: ${plan.progress}% (${plan.completedTasks}/${plan.totalTasks} tasks)\n\n`;
    }

    return report;
  }

  async autoCompleteFinishedPlans() {
    await this.system.initialize();
    const completedPlans = [];

    for (const plan of this.system.plans.values()) {
      if (plan.status === 'active') {
        const planTasks = Array.from(this.system.tasks.values()).filter(
          (t) => t.planId === plan.id
        );
        const completedTasks = planTasks.filter((t) => t.completed);

        if (
          planTasks.length > 0 &&
          completedTasks.length === planTasks.length
        ) {
          await this.system.completePlan(plan.id);
          completedPlans.push(plan.id);
        }
      }
    }

    return completedPlans;
  }

  async setupAutomation() {
    // Add npm scripts for planning system
    const packageJsonPath = path.join(this.projectRoot, 'package.json');

    try {
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf8')
      );

      if (!packageJson.scripts) {
        packageJson.scripts = {};
      }

      packageJson.scripts['plan:init'] = 'node planning-system.js init';
      packageJson.scripts['plan:update'] = 'node planning-system.js update';
      packageJson.scripts['plan:watch'] = 'node planning-system.js watch';
      packageJson.scripts['plan:report'] = 'node planning-utils.js report';
      packageJson.scripts['plan:auto-complete'] =
        'node planning-utils.js auto-complete';

      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2),
        'utf8'
      );
      console.log('Added planning system scripts to package.json');
    } catch (error) {
      console.warn('Could not update package.json:', error.message);
    }
  }
}

// CLI interface
if (require.main === module) {
  const utils = new PlanningUtils();
  const command = process.argv[2];

  switch (command) {
    case 'create-plan':
      const planData = JSON.parse(process.argv[3] || '{}');
      utils.createPlanFromTemplate(planData).then((planId) => {
        console.log(`Created plan: ${planId}`);
      });
      break;

    case 'generate-project-plan':
      const projectData = JSON.parse(process.argv[3] || '{}');
      utils.generateProjectPlan(projectData).then((planId) => {
        console.log(`Generated project plan: ${planId}`);
      });
      break;

    case 'report':
      utils.generateProgressReport().then((report) => {
        console.log(report);
      });
      break;

    case 'analyze':
      utils.analyzeProjectProgress().then((analysis) => {
        console.log(JSON.stringify(analysis, null, 2));
      });
      break;

    case 'auto-complete':
      utils.autoCompleteFinishedPlans().then((completed) => {
        if (completed.length > 0) {
          console.log(`Auto-completed plans: ${completed.join(', ')}`);
        } else {
          console.log('No plans ready for auto-completion');
        }
      });
      break;

    case 'setup':
      utils.setupAutomation().then(() => {
        console.log('Planning system automation setup complete');
      });
      break;

    default:
      console.log(`
Usage: node planning-utils.js <command>

Commands:
  create-plan           Create a new plan from template (requires JSON data)
  generate-project-plan Generate a plan for a project (requires JSON data)
  report               Generate a progress report
  analyze              Analyze project progress (JSON output)
  auto-complete        Auto-complete finished plans
  setup                Setup automation scripts in package.json
`);
  }
}

module.exports = PlanningUtils;
