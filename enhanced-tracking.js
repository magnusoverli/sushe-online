#!/usr/bin/env node

/**
 * Enhanced Tracking Module
 * Provides real-time metrics, progress auto-detection, and intelligent completion
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');

class EnhancedTracker {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.metricsPath = path.join(projectRoot, '.planning-metrics.json');
    this.plansDir = path.join(projectRoot, 'plans');
    this.activeDir = path.join(this.plansDir, 'active');
    this.completedDir = path.join(this.plansDir, 'completed');

    this.metrics = {
      realTime: {
        activePlans: 0,
        completedPlans: 0,
        totalProgress: 0,
        velocity: 0,
        efficiency: 0,
        lastUpdate: null,
      },
      historical: {
        completionTimes: [],
        accuracyScores: [],
        complexityVsTime: [],
        successPatterns: [],
      },
      predictions: {
        estimatedCompletion: null,
        riskLevel: 'Low',
        recommendedActions: [],
      },
      systemHealth: {
        status: 'Healthy',
        issues: [],
        performance: 100,
      },
    };

    this.progressPatterns = new Map();
    this.completionTriggers = new Set();
  }

  async initialize() {
    await this.loadMetrics();
    await this.setupProgressDetection();
    await this.calculateRealTimeMetrics();
  }

  async loadMetrics() {
    try {
      const metricsData = await fs.readFile(this.metricsPath, 'utf8');
      this.metrics = { ...this.metrics, ...JSON.parse(metricsData) };
      logger.info('Metrics loaded successfully');
    } catch (error) {
      logger.info('No existing metrics found, starting fresh');
      await this.saveMetrics();
    }
  }

  async saveMetrics() {
    try {
      await fs.writeFile(
        this.metricsPath,
        JSON.stringify(this.metrics, null, 2)
      );
    } catch (error) {
      logger.warn('Could not save metrics', { error: error.message });
    }
  }

  /**
   * Real-time metrics calculation
   */
  async calculateRealTimeMetrics() {
    const timestamp = new Date().toISOString();

    // Count active and completed plans
    const activePlans = await this.getActivePlans();
    const completedPlans = await this.getCompletedPlans();

    // Calculate overall progress
    const totalProgress = await this.calculateOverallProgress(activePlans);

    // Calculate velocity (progress per hour)
    const velocity = await this.calculateVelocity();

    // Calculate efficiency (actual vs estimated time)
    const efficiency = await this.calculateEfficiency();

    this.metrics.realTime = {
      activePlans: activePlans.length,
      completedPlans: completedPlans.length,
      totalProgress,
      velocity,
      efficiency,
      lastUpdate: timestamp,
    };

    await this.saveMetrics();
    return this.metrics.realTime;
  }

  async getActivePlans() {
    try {
      const files = await fs.readdir(this.activeDir);
      const plans = [];

      for (const file of files) {
        if (file.endsWith('.md')) {
          const planData = await this.parsePlanFile(
            path.join(this.activeDir, file)
          );
          if (planData) plans.push(planData);
        }
      }

      return plans;
    } catch (error) {
      logger.warn('Could not read active plans', { error: error.message });
      return [];
    }
  }

  async getCompletedPlans() {
    try {
      const files = await fs.readdir(this.completedDir);
      const plans = [];

      for (const file of files) {
        if (file.endsWith('.md')) {
          const planData = await this.parsePlanFile(
            path.join(this.completedDir, file)
          );
          if (planData) plans.push(planData);
        }
      }

      return plans;
    } catch (error) {
      logger.warn('Could not read completed plans', { error: error.message });
      return [];
    }
  }

  async parsePlanFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const plan = { filePath };

      // Extract basic metadata
      const idMatch = content.match(/\*\*ID\*\*:\s*(.+)/);
      const titleMatch = content.match(/\*\*Title\*\*:\s*(.+)/);
      const statusMatch = content.match(/\*\*Status\*\*:\s*(.+)/);
      const priorityMatch = content.match(/\*\*Priority\*\*:\s*(.+)/);
      const createdMatch = content.match(/\*\*Created\*\*:\s*(.+)/);
      const startedMatch = content.match(/\*\*Started\*\*:\s*(.+)/);

      if (idMatch) plan.id = idMatch[1].trim();
      if (titleMatch) plan.title = titleMatch[1].trim();
      if (statusMatch) plan.status = statusMatch[1].trim();
      if (priorityMatch) plan.priority = priorityMatch[1].trim();
      if (createdMatch) plan.created = createdMatch[1].trim();
      if (startedMatch) plan.started = startedMatch[1].trim();

      // Calculate progress from success criteria
      const successCriteria = content.match(
        /## Success Criteria\n([\s\S]*?)(?=\n##|$)/
      );
      if (successCriteria) {
        const criteriaText = successCriteria[1];
        const totalCriteria = (criteriaText.match(/- \[[ x]\]/g) || []).length;
        const completedCriteria = (criteriaText.match(/- \[x\]/g) || []).length;
        plan.progress =
          totalCriteria > 0
            ? Math.round((completedCriteria / totalCriteria) * 100)
            : 0;
        plan.totalCriteria = totalCriteria;
        plan.completedCriteria = completedCriteria;
      }

      // Extract AI insights if available
      const aiInsights = content.match(/## AI Insights\n([\s\S]*?)(?=\n##|$)/);
      if (aiInsights) {
        plan.aiGenerated = true;
        const confidenceMatch = aiInsights[1].match(
          /\*\*Confidence\*\*:\s*(.+)/
        );
        if (confidenceMatch) plan.confidence = parseFloat(confidenceMatch[1]);
      }

      return plan;
    } catch (error) {
      logger.warn('Could not parse plan file', {
        filePath,
        error: error.message,
      });
      return null;
    }
  }

  async calculateOverallProgress(activePlans) {
    if (activePlans.length === 0) return 100;

    const totalProgress = activePlans.reduce(
      (sum, plan) => sum + (plan.progress || 0),
      0
    );
    return Math.round(totalProgress / activePlans.length);
  }

  async calculateVelocity() {
    const completedPlans = await this.getCompletedPlans();
    if (completedPlans.length === 0) return 0;

    // Calculate average completion time for recent plans
    const recentPlans = completedPlans.slice(-10); // Last 10 plans
    let totalTime = 0;
    let validPlans = 0;

    for (const plan of recentPlans) {
      if (plan.created && plan.started) {
        const startTime = new Date(plan.started).getTime();
        const createTime = new Date(plan.created).getTime();
        const duration = startTime - createTime;
        if (duration > 0) {
          totalTime += duration;
          validPlans++;
        }
      }
    }

    if (validPlans === 0) return 0;

    const avgCompletionTime = totalTime / validPlans;
    const hoursPerPlan = avgCompletionTime / (1000 * 60 * 60);

    return Math.round((1 / hoursPerPlan) * 100) / 100; // Plans per hour
  }

  async calculateEfficiency() {
    // Compare estimated vs actual completion times
    const completedPlans = await this.getCompletedPlans();
    if (completedPlans.length === 0) return 100;

    // This would require estimated times to be stored in plans
    // For now, return a baseline efficiency
    return 85;
  }

  /**
   * Progress auto-detection
   */
  async setupProgressDetection() {
    const chokidar = require('chokidar');

    // Watch for file changes in the project
    const watcher = chokidar.watch(
      [
        path.join(this.projectRoot, 'src/**/*'),
        path.join(this.projectRoot, 'routes/**/*'),
        path.join(this.projectRoot, 'views/**/*'),
        path.join(this.projectRoot, 'test/**/*'),
        this.activeDir,
      ],
      {
        ignored: /(^|[/\\])\../,
        persistent: true,
      }
    );

    watcher.on('change', (filePath) => this.onFileChange(filePath));
    watcher.on('add', (filePath) => this.onFileAdd(filePath));

    logger.info('Progress auto-detection enabled');
  }

  async onFileChange(filePath) {
    // Detect progress based on file changes
    await this.detectProgressFromChanges(filePath);
    await this.checkForAutoCompletion();
    await this.calculateRealTimeMetrics();
  }

  async onFileAdd(filePath) {
    // Detect progress based on new files
    await this.detectProgressFromNewFiles(filePath);
    await this.checkForAutoCompletion();
    await this.calculateRealTimeMetrics();
  }

  async detectProgressFromChanges(filePath) {
    const fileType = this.categorizeFile(filePath);
    const activePlans = await this.getActivePlans();

    // Update progress patterns
    for (const plan of activePlans) {
      if (this.isFileRelevantToPlan(filePath, plan)) {
        await this.updatePlanProgress(plan, fileType, 'modified');
      }
    }
  }

  async detectProgressFromNewFiles(filePath) {
    const fileType = this.categorizeFile(filePath);
    const activePlans = await this.getActivePlans();

    for (const plan of activePlans) {
      if (this.isFileRelevantToPlan(filePath, plan)) {
        await this.updatePlanProgress(plan, fileType, 'created');
      }
    }
  }

  categorizeFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();

    if (ext === '.test.js' || fileName.includes('test')) return 'test';
    if (ext === '.js' && filePath.includes('/routes/')) return 'api';
    if (ext === '.js' && filePath.includes('/src/')) return 'frontend';
    if (ext === '.ejs' || ext === '.html') return 'view';
    if (ext === '.css' || ext === '.scss') return 'style';
    if (ext === '.md') return 'documentation';
    if (ext === '.sql' || fileName.includes('migration')) return 'database';

    return 'general';
  }

  isFileRelevantToPlan(filePath, plan) {
    if (!plan.aiGenerated) return false;

    // Simple relevance check based on plan keywords
    const fileName = path.basename(filePath).toLowerCase();
    const planTitle = (plan.title || '').toLowerCase();

    // Check if filename contains plan keywords
    const keywords = planTitle.split(' ').filter((word) => word.length > 3);
    return keywords.some((keyword) => fileName.includes(keyword));
  }

  async updatePlanProgress(plan, fileType, action) {
    // Update progress based on file changes
    const progressIncrement = this.getProgressIncrement(fileType, action);

    if (progressIncrement > 0) {
      // This would update the actual plan file
      logger.info('Progress detected', {
        planId: plan.id,
        fileType,
        action,
        increment: progressIncrement,
      });
    }
  }

  getProgressIncrement(fileType, action) {
    const increments = {
      test: { created: 15, modified: 5 },
      api: { created: 20, modified: 10 },
      frontend: { created: 15, modified: 8 },
      view: { created: 10, modified: 5 },
      database: { created: 25, modified: 10 },
      documentation: { created: 5, modified: 2 },
      general: { created: 5, modified: 2 },
    };

    return increments[fileType]?.[action] || 0;
  }

  /**
   * Smart auto-completion
   */
  async checkForAutoCompletion() {
    const activePlans = await this.getActivePlans();

    for (const plan of activePlans) {
      if (await this.shouldAutoComplete(plan)) {
        await this.autoCompletePlan(plan);
      }
    }
  }

  async shouldAutoComplete(plan) {
    // Check if all success criteria are met
    if (plan.progress >= 100) return true;

    // Check for completion patterns
    if (await this.matchesCompletionPattern(plan)) return true;

    // Check for explicit completion triggers
    if (this.completionTriggers.has(plan.id)) return true;

    return false;
  }

  async matchesCompletionPattern(plan) {
    // Analyze recent file changes to detect completion patterns
    // This is a simplified version - real implementation would be more sophisticated
    return plan.progress >= 90 && plan.completedCriteria === plan.totalCriteria;
  }

  async autoCompletePlan(plan) {
    try {
      // Move plan to completed directory
      const oldPath = plan.filePath;
      const fileName = path.basename(oldPath);
      const newPath = path.join(this.completedDir, fileName);

      // Update plan content
      let content = await fs.readFile(oldPath, 'utf8');
      const now = new Date().toISOString().split('T')[0];

      content = content.replace(
        /\*\*Status\*\*:\s*(.+)/,
        '**Status**: Completed'
      );
      content = content.replace(
        /\*\*Overall Progress\*\*:\s*(.+)/,
        '**Overall Progress**: 100%'
      );
      content += `\n\n## Auto-Completion\n- **Completed**: ${now}\n- **Method**: Automatic detection\n- **Trigger**: All success criteria met`;

      await fs.writeFile(newPath, content, 'utf8');
      await fs.unlink(oldPath);

      // Update metrics
      this.metrics.historical.completionTimes.push({
        planId: plan.id,
        completedAt: now,
        duration: this.calculatePlanDuration(plan),
      });

      await this.saveMetrics();

      logger.info('Plan auto-completed', { planId: plan.id });

      return true;
    } catch (error) {
      logger.warn('Could not auto-complete plan', {
        planId: plan.id,
        error: error.message,
      });
      return false;
    }
  }

  calculatePlanDuration(plan) {
    if (!plan.created || !plan.started) return null;

    const startTime = new Date(plan.started).getTime();
    const createTime = new Date(plan.created).getTime();
    return startTime - createTime;
  }

  /**
   * Predictive analytics
   */
  async generatePredictions() {
    const activePlans = await this.getActivePlans();
    const predictions = {
      estimatedCompletion: await this.predictCompletionTimes(activePlans),
      riskLevel: await this.assessRiskLevel(activePlans),
      recommendedActions: await this.generateRecommendations(activePlans),
    };

    this.metrics.predictions = predictions;
    await this.saveMetrics();

    return predictions;
  }

  async predictCompletionTimes(activePlans) {
    const predictions = {};

    for (const plan of activePlans) {
      const remainingProgress = 100 - (plan.progress || 0);
      const velocity = await this.calculateVelocity();

      if (velocity > 0) {
        const estimatedHours = remainingProgress / (velocity * 10); // Rough estimate
        const estimatedDays = Math.ceil(estimatedHours / 8);
        predictions[plan.id] = `${estimatedDays} days`;
      } else {
        predictions[plan.id] = 'Unknown';
      }
    }

    return predictions;
  }

  async assessRiskLevel(activePlans) {
    let riskScore = 0;

    // High number of active plans increases risk
    if (activePlans.length > 5) riskScore += 20;

    // Stalled plans increase risk
    const stalledPlans = activePlans.filter(
      (plan) => (plan.progress || 0) < 10
    );
    riskScore += stalledPlans.length * 15;

    // Low velocity increases risk
    const velocity = await this.calculateVelocity();
    if (velocity < 0.1) riskScore += 25;

    if (riskScore < 20) return 'Low';
    if (riskScore < 50) return 'Medium';
    return 'High';
  }

  async generateRecommendations(activePlans) {
    const recommendations = [];

    // Check for stalled plans
    const stalledPlans = activePlans.filter(
      (plan) => (plan.progress || 0) < 10
    );
    if (stalledPlans.length > 0) {
      recommendations.push(`Focus on ${stalledPlans.length} stalled plans`);
    }

    // Check for overload
    if (activePlans.length > 3) {
      recommendations.push('Consider reducing active plans to improve focus');
    }

    // Check for missing tests
    const plansWithoutTests = activePlans.filter(
      (plan) =>
        !plan.title.toLowerCase().includes('test') && (plan.progress || 0) > 50
    );
    if (plansWithoutTests.length > 0) {
      recommendations.push('Add testing tasks to plans nearing completion');
    }

    return recommendations;
  }

  /**
   * Generate comprehensive dashboard data
   */
  async generateDashboard() {
    await this.calculateRealTimeMetrics();
    await this.generatePredictions();

    return {
      realTime: this.metrics.realTime,
      predictions: this.metrics.predictions,
      systemHealth: await this.assessSystemHealth(),
      recentActivity: await this.getRecentActivity(),
      trends: await this.calculateTrends(),
    };
  }

  async assessSystemHealth() {
    const health = {
      status: 'Healthy',
      issues: [],
      performance: 100,
    };

    const activePlans = await this.getActivePlans();
    const velocity = await this.calculateVelocity();

    // Check for issues
    if (activePlans.length === 0) {
      health.issues.push('No active plans - system may be idle');
      health.performance -= 20;
    }

    if (velocity < 0.05) {
      health.issues.push('Low completion velocity detected');
      health.performance -= 30;
    }

    const stalledPlans = activePlans.filter(
      (plan) => (plan.progress || 0) < 10
    );
    if (stalledPlans.length > 2) {
      health.issues.push(`${stalledPlans.length} plans appear stalled`);
      health.performance -= 25;
    }

    // Determine overall status
    if (health.performance < 50) health.status = 'Critical';
    else if (health.performance < 75) health.status = 'Warning';

    this.metrics.systemHealth = health;
    return health;
  }

  async getRecentActivity() {
    // Get recent file changes and plan updates
    return {
      recentChanges: [],
      recentCompletions: this.metrics.historical.completionTimes.slice(-5),
      lastUpdate: this.metrics.realTime.lastUpdate,
    };
  }

  async calculateTrends() {
    const completionTimes = this.metrics.historical.completionTimes;

    return {
      velocityTrend: completionTimes.length > 1 ? 'stable' : 'unknown',
      completionRate: completionTimes.length,
      averageCompletionTime:
        completionTimes.length > 0
          ? completionTimes.reduce(
              (sum, item) => sum + (item.duration || 0),
              0
            ) / completionTimes.length
          : 0,
    };
  }
}

// CLI interface
if (require.main === module) {
  const tracker = new EnhancedTracker();

  const command = process.argv[2];

  switch (command) {
    case 'init':
      tracker.initialize().then(() => {
        console.log('Enhanced tracking initialized');
      });
      break;

    case 'metrics':
      tracker.calculateRealTimeMetrics().then((metrics) => {
        console.log(JSON.stringify(metrics, null, 2));
      });
      break;

    case 'dashboard':
      tracker.generateDashboard().then((dashboard) => {
        console.log(JSON.stringify(dashboard, null, 2));
      });
      break;

    case 'predictions':
      tracker.generatePredictions().then((predictions) => {
        console.log(JSON.stringify(predictions, null, 2));
      });
      break;

    case 'auto-complete':
      tracker.checkForAutoCompletion().then(() => {
        console.log('Auto-completion check completed');
      });
      break;

    default:
      console.log(`
Enhanced Tracking Commands:
  init              Initialize enhanced tracking system
  metrics           Calculate and display real-time metrics
  dashboard         Generate comprehensive dashboard data
  predictions       Generate predictive analytics
  auto-complete     Check for plans ready for auto-completion
`);
  }
}

module.exports = EnhancedTracker;
