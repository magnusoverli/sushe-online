#!/usr/bin/env node

/**
 * Smart Planning Interface
 * Integrates AI planning, enhanced tracking, and existing planning system
 */

const AIPlanningEngine = require('./ai-planning');
const EnhancedTracker = require('./enhanced-tracking');
const PlanningSystem = require('./planning-system');
const logger = require('./utils/logger');

class SmartPlanningInterface {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.aiPlanning = new AIPlanningEngine(projectRoot);
    this.tracker = new EnhancedTracker(projectRoot);
    this.planningSystem = new PlanningSystem(projectRoot);
  }

  async initialize() {
    await this.aiPlanning.initialize?.();
    await this.tracker.initialize();
    await this.planningSystem.initialize();
    logger.info('Smart Planning Interface initialized');
  }

  /**
   * Create a plan from natural language request
   */
  async createSmartPlan(userRequest, context = {}) {
    logger.info('Creating smart plan', { request: userRequest });

    try {
      // Generate AI plan
      const aiPlan = await this.aiPlanning.generatePlan(userRequest, context);

      // Create plan using existing system
      const planId = await this.planningSystem.createPlan(aiPlan);

      // Start tracking
      await this.tracker.calculateRealTimeMetrics();

      logger.info('Smart plan created successfully', { planId });

      return {
        success: true,
        planId,
        plan: aiPlan,
        message: `Created plan ${planId} with AI assistance`,
      };
    } catch (error) {
      logger.error('Failed to create smart plan', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get comprehensive dashboard
   */
  async getDashboard() {
    const dashboard = await this.tracker.generateDashboard();
    const aiMetrics = await this.aiPlanning.generateMetrics();

    return {
      ...dashboard,
      ai: aiMetrics,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Auto-update all systems
   */
  async autoUpdate() {
    await this.planningSystem.autoUpdate();
    await this.tracker.calculateRealTimeMetrics();
    await this.tracker.checkForAutoCompletion();

    logger.info('Smart planning system updated');
  }

  /**
   * Start watching for changes
   */
  async startWatching() {
    await this.planningSystem.watchForChanges();
    await this.tracker.setupProgressDetection();

    logger.info('Smart planning system is now watching for changes');
  }

  /**
   * Analyze current state and provide recommendations
   */
  async analyzeAndRecommend() {
    const dashboard = await this.getDashboard();
    const recommendations = [];

    // AI-based recommendations
    if (dashboard.ai.planHistorySize < 5) {
      recommendations.push({
        type: 'learning',
        priority: 'medium',
        message: 'Create more plans to improve AI accuracy',
        action: 'Continue using the system to build historical data',
      });
    }

    // Performance recommendations
    if (dashboard.realTime.velocity < 0.1) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Low completion velocity detected',
        action: 'Consider breaking down complex plans into smaller tasks',
      });
    }

    // System health recommendations
    if (dashboard.systemHealth.status !== 'Healthy') {
      recommendations.push({
        type: 'health',
        priority: 'high',
        message: `System health: ${dashboard.systemHealth.status}`,
        action: 'Review and address identified issues',
      });
    }

    return {
      dashboard,
      recommendations,
      summary: this.generateSummary(dashboard, recommendations),
    };
  }

  generateSummary(dashboard, recommendations) {
    const activePlans = dashboard.realTime.activePlans;
    const completedPlans = dashboard.realTime.completedPlans;
    const progress = dashboard.realTime.totalProgress;
    const highPriorityIssues = recommendations.filter(
      (r) => r.priority === 'high'
    ).length;

    return {
      status: highPriorityIssues > 0 ? 'Needs Attention' : 'Good',
      activePlans,
      completedPlans,
      overallProgress: progress,
      criticalIssues: highPriorityIssues,
      message: this.generateStatusMessage(
        activePlans,
        completedPlans,
        progress,
        highPriorityIssues
      ),
    };
  }

  generateStatusMessage(active, completed, progress, issues) {
    if (issues > 0) {
      return `${issues} critical issues need attention. ${active} plans active, ${progress}% average progress.`;
    }

    if (active === 0) {
      return `All plans completed! ${completed} total plans finished. Ready for new work.`;
    }

    if (progress > 80) {
      return `Excellent progress! ${active} plans active with ${progress}% average completion.`;
    }

    if (progress > 50) {
      return `Good progress on ${active} active plans. ${progress}% average completion.`;
    }

    return `${active} plans in progress. Consider focusing efforts to improve ${progress}% completion rate.`;
  }

  /**
   * Quick plan creation with minimal input
   */
  async quickPlan(description) {
    const context = {
      quick: true,
      timestamp: new Date().toISOString(),
    };

    return await this.createSmartPlan(description, context);
  }

  /**
   * Bulk operations
   */
  async bulkComplete(planIds) {
    const results = [];

    for (const planId of planIds) {
      try {
        const success = await this.planningSystem.completePlan(planId);
        results.push({ planId, success });
      } catch (error) {
        results.push({ planId, success: false, error: error.message });
      }
    }

    await this.autoUpdate();
    return results;
  }

  /**
   * Export planning data
   */
  async exportData(format = 'json') {
    const dashboard = await this.getDashboard();
    const timestamp = new Date().toISOString().split('T')[0];

    const exportData = {
      exportDate: timestamp,
      system: 'Smart Planning Interface',
      version: '1.0.0',
      data: dashboard,
    };

    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'csv':
        return this.convertToCSV(exportData);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  convertToCSV(data) {
    // Simple CSV conversion for metrics
    const lines = [
      'Metric,Value',
      `Active Plans,${data.data.realTime.activePlans}`,
      `Completed Plans,${data.data.realTime.completedPlans}`,
      `Total Progress,${data.data.realTime.totalProgress}%`,
      `Velocity,${data.data.realTime.velocity}`,
      `System Health,${data.data.systemHealth.status}`,
      `Last Update,${data.data.realTime.lastUpdate}`,
    ];

    return lines.join('\n');
  }
}

// CLI interface
if (require.main === module) {
  const smartPlanning = new SmartPlanningInterface();

  const command = process.argv[2];
  const input = process.argv[3];

  async function runCommand() {
    await smartPlanning.initialize();

    switch (command) {
      case 'create': {
        if (!input) {
          console.log(
            'Usage: node smart-planning.js create "your plan description"'
          );
          return;
        }
        const result = await smartPlanning.createSmartPlan(input);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'quick': {
        if (!input) {
          console.log(
            'Usage: node smart-planning.js quick "quick task description"'
          );
          return;
        }
        const quickResult = await smartPlanning.quickPlan(input);
        console.log(JSON.stringify(quickResult, null, 2));
        break;
      }

      case 'dashboard': {
        const dashboard = await smartPlanning.getDashboard();
        console.log(JSON.stringify(dashboard, null, 2));
        break;
      }

      case 'analyze': {
        const analysis = await smartPlanning.analyzeAndRecommend();
        console.log(JSON.stringify(analysis, null, 2));
        break;
      }

      case 'update':
        await smartPlanning.autoUpdate();
        console.log('System updated successfully');
        break;

      case 'watch':
        await smartPlanning.startWatching();
        console.log('Smart planning system is now watching for changes...');
        // Keep the process running
        process.stdin.resume();
        break;

      case 'export': {
        const format = input || 'json';
        const exportData = await smartPlanning.exportData(format);
        console.log(exportData);
        break;
      }

      case 'status': {
        const statusAnalysis = await smartPlanning.analyzeAndRecommend();
        console.log('\n=== Smart Planning System Status ===');
        console.log(`Status: ${statusAnalysis.summary.status}`);
        console.log(`Active Plans: ${statusAnalysis.summary.activePlans}`);
        console.log(
          `Completed Plans: ${statusAnalysis.summary.completedPlans}`
        );
        console.log(
          `Overall Progress: ${statusAnalysis.summary.overallProgress}%`
        );
        console.log(
          `Critical Issues: ${statusAnalysis.summary.criticalIssues}`
        );
        console.log(`\nSummary: ${statusAnalysis.summary.message}`);

        if (statusAnalysis.recommendations.length > 0) {
          console.log('\n=== Recommendations ===');
          statusAnalysis.recommendations.forEach((rec, i) => {
            console.log(
              `${i + 1}. [${rec.priority.toUpperCase()}] ${rec.message}`
            );
            console.log(`   Action: ${rec.action}\n`);
          });
        }
        break;
      }

      default:
        console.log(`
Smart Planning Interface Commands:

Plan Management:
  create <description>     Create a new plan from natural language description
  quick <description>      Create a quick plan with minimal setup
  update                   Update all planning systems
  
Monitoring:
  dashboard               Show comprehensive dashboard
  analyze                 Analyze current state and get recommendations
  status                  Show system status summary
  
System:
  watch                   Start watching for file changes (runs continuously)
  export [format]         Export planning data (json/csv)

Examples:
  node smart-planning.js create "Add user authentication system"
  node smart-planning.js quick "Fix typo in login page"
  node smart-planning.js status
  node smart-planning.js dashboard
`);
    }
  }

  runCommand().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

module.exports = SmartPlanningInterface;
