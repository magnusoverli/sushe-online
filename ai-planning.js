#!/usr/bin/env node

/**
 * AI-Powered Planning & Analysis Module
 * Provides intelligent plan creation, codebase analysis, and automated tracking
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');

class AIPlanningEngine {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.codebaseCache = new Map();
    this.planHistory = [];
    this.metrics = {
      planAccuracy: 0,
      completionVelocity: 0,
      riskPredictionAccuracy: 0,
      lastAnalysis: null,
    };
  }

  /**
   * Analyze user request and generate intelligent plan
   */
  async generatePlan(userRequest, context = {}) {
    logger.info('AI Planning: Analyzing request', { request: userRequest });

    const analysis = await this.analyzeRequest(userRequest, context);
    const codebaseContext = await this.analyzeCodebase(analysis.scope);
    const planStructure = await this.createPlanStructure(
      analysis,
      codebaseContext
    );

    return {
      ...planStructure,
      aiGenerated: true,
      confidence: analysis.confidence,
      analysisTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Analyze user request to understand intent, scope, and complexity
   */
  async analyzeRequest(request, context) {
    const analysis = {
      intent: this.classifyIntent(request),
      complexity: this.assessComplexity(request),
      scope: this.identifyScope(request),
      priority: this.suggestPriority(request, context),
      type: this.classifyWorkType(request),
      confidence: 0.85,
      keywords: this.extractKeywords(request),
      estimatedEffort: this.estimateEffort(request),
    };

    // Adjust confidence based on clarity and specificity
    analysis.confidence = this.calculateConfidence(request, analysis);

    return analysis;
  }

  classifyIntent(request) {
    const intentPatterns = {
      create: /\b(add|create|implement|build|develop|new)\b/i,
      fix: /\b(fix|repair|resolve|debug|correct|bug)\b/i,
      improve: /\b(improve|enhance|optimize|refactor|upgrade)\b/i,
      remove: /\b(remove|delete|clean|eliminate)\b/i,
      update: /\b(update|modify|change|edit|adjust)\b/i,
      analyze: /\b(analyze|review|audit|investigate|examine)\b/i,
    };

    for (const [intent, pattern] of Object.entries(intentPatterns)) {
      if (pattern.test(request)) {
        return intent;
      }
    }
    return 'general';
  }

  assessComplexity(request) {
    let complexity = 1; // Base complexity

    // Complexity indicators
    const complexityFactors = {
      database: /\b(database|db|sql|migration|schema)\b/i,
      authentication: /\b(auth|login|user|session|security)\b/i,
      api: /\b(api|endpoint|route|service)\b/i,
      ui: /\b(ui|interface|component|page|view)\b/i,
      integration: /\b(integrate|connect|sync|webhook)\b/i,
      performance: /\b(performance|optimize|cache|speed)\b/i,
      testing: /\b(test|testing|spec|coverage)\b/i,
      deployment: /\b(deploy|deployment|ci|cd|docker)\b/i,
    };

    for (const [, pattern] of Object.entries(complexityFactors)) {
      if (pattern.test(request)) {
        complexity += 0.5;
      }
    }

    // Multiple system involvement increases complexity
    const systemCount = (
      request.match(/\b(frontend|backend|database|api|ui|server)\b/gi) || []
    ).length;
    complexity += systemCount * 0.3;

    return Math.min(complexity, 5); // Cap at 5
  }

  identifyScope(request) {
    const scopePatterns = {
      frontend:
        /\b(ui|interface|component|page|view|css|html|javascript|react)\b/i,
      backend: /\b(server|api|endpoint|route|service|controller)\b/i,
      database: /\b(database|db|sql|migration|schema|table)\b/i,
      auth: /\b(auth|login|user|session|security|password)\b/i,
      testing: /\b(test|testing|spec|coverage|unit|integration)\b/i,
      deployment: /\b(deploy|deployment|ci|cd|docker|build)\b/i,
      documentation: /\b(docs|documentation|readme|guide)\b/i,
    };

    const scope = [];
    for (const [area, pattern] of Object.entries(scopePatterns)) {
      if (pattern.test(request)) {
        scope.push(area);
      }
    }

    return scope.length > 0 ? scope : ['general'];
  }

  suggestPriority(request, context) {
    let priority = 'Medium'; // Default

    // High priority indicators
    if (
      /\b(urgent|critical|important|asap|immediately|security|bug|broken|down)\b/i.test(
        request
      )
    ) {
      priority = 'High';
    }

    // Low priority indicators
    if (
      /\b(nice to have|eventually|someday|minor|cosmetic|cleanup)\b/i.test(
        request
      )
    ) {
      priority = 'Low';
    }

    // Context-based priority adjustment
    if (
      context.currentSprint &&
      /\b(sprint|deadline|release)\b/i.test(request)
    ) {
      priority = 'High';
    }

    return priority;
  }

  classifyWorkType(request) {
    const typePatterns = {
      Feature: /\b(add|create|implement|build|develop|new feature)\b/i,
      'Bug Fix': /\b(fix|repair|resolve|debug|correct|bug)\b/i,
      Refactor: /\b(refactor|restructure|reorganize|clean up)\b/i,
      Enhancement: /\b(improve|enhance|optimize|upgrade)\b/i,
      Infrastructure: /\b(deploy|deployment|ci|cd|docker|infrastructure)\b/i,
      Documentation: /\b(docs|documentation|readme|guide|comment)\b/i,
      Testing: /\b(test|testing|spec|coverage)\b/i,
      Security: /\b(security|auth|authentication|vulnerability)\b/i,
    };

    for (const [type, pattern] of Object.entries(typePatterns)) {
      if (pattern.test(request)) {
        return type;
      }
    }
    return 'Development';
  }

  extractKeywords(request) {
    // Remove common words and extract meaningful keywords
    const commonWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'must',
    ]);

    return request
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !commonWords.has(word))
      .slice(0, 10); // Top 10 keywords
  }

  estimateEffort(request) {
    const complexity = this.assessComplexity(request);
    const scope = this.identifyScope(request);

    // Base effort in hours
    let effort = 2;

    // Complexity multiplier
    effort *= complexity;

    // Scope multiplier
    effort *= Math.max(1, scope.length * 0.5);

    // Round to reasonable increments
    if (effort < 4) return '2-4 hours';
    if (effort < 8) return '4-8 hours';
    if (effort < 16) return '1-2 days';
    if (effort < 40) return '3-5 days';
    return '1+ weeks';
  }

  calculateConfidence(request, analysis) {
    let confidence = 0.7; // Base confidence

    // Higher confidence for specific requests
    if (request.length > 50) confidence += 0.1;
    if (analysis.keywords.length > 3) confidence += 0.1;
    if (analysis.scope.length > 0) confidence += 0.1;

    // Lower confidence for vague requests
    if (/\b(something|anything|maybe|perhaps|might)\b/i.test(request)) {
      confidence -= 0.2;
    }

    return Math.max(0.3, Math.min(0.95, confidence));
  }

  /**
   * Analyze codebase to understand current state and context
   */
  async analyzeCodebase(scope) {
    const analysis = {
      structure: await this.analyzeProjectStructure(),
      dependencies: await this.analyzeDependencies(),
      patterns: await this.identifyCodePatterns(scope),
      techStack: await this.identifyTechStack(),
      complexity: await this.assessCodebaseComplexity(),
      recentChanges: await this.analyzeRecentChanges(),
    };

    this.codebaseCache.set('latest', {
      ...analysis,
      timestamp: new Date().toISOString(),
    });

    return analysis;
  }

  async analyzeProjectStructure() {
    try {
      const structure = {};
      const dirs = [
        'src',
        'routes',
        'views',
        'public',
        'utils',
        'middleware',
        'db',
        'test',
      ];

      for (const dir of dirs) {
        const dirPath = path.join(this.projectRoot, dir);
        try {
          const files = await fs.readdir(dirPath, { recursive: true });
          structure[dir] = {
            fileCount: files.length,
            types: this.categorizeFiles(files),
          };
        } catch {
          // Directory doesn't exist
        }
      }

      return structure;
    } catch (error) {
      logger.warn('Could not analyze project structure', {
        error: error.message,
      });
      return {};
    }
  }

  categorizeFiles(files) {
    const types = {};
    files.forEach((file) => {
      const ext = path.extname(file).toLowerCase();
      types[ext] = (types[ext] || 0) + 1;
    });
    return types;
  }

  async analyzeDependencies() {
    try {
      const packagePath = path.join(this.projectRoot, 'package.json');
      const packageContent = await fs.readFile(packagePath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      return {
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
        scripts: Object.keys(packageJson.scripts || {}),
        framework: this.identifyFramework(packageJson),
      };
    } catch (error) {
      logger.warn('Could not analyze dependencies', { error: error.message });
      return {};
    }
  }

  identifyFramework(packageJson) {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps.express) return 'Express.js';
    if (deps.react) return 'React';
    if (deps.vue) return 'Vue.js';
    if (deps.angular) return 'Angular';
    if (deps.next) return 'Next.js';

    return 'Node.js';
  }

  async identifyCodePatterns() {
    const patterns = {
      authPattern: await this.checkForPattern(/passport|auth|login/i),
      databasePattern: await this.checkForPattern(
        /pg|mysql|mongodb|sequelize/i
      ),
      apiPattern: await this.checkForPattern(/router|route|endpoint/i),
      testPattern: await this.checkForPattern(/test|spec|jest|mocha/i),
    };

    return patterns;
  }

  async checkForPattern(pattern) {
    try {
      // Simple pattern check - in a real implementation, this would scan files
      const packagePath = path.join(this.projectRoot, 'package.json');
      const content = await fs.readFile(packagePath, 'utf8');
      return pattern.test(content);
    } catch {
      return false;
    }
  }

  async identifyTechStack() {
    const dependencies = await this.analyzeDependencies();
    const stack = {
      backend: [],
      frontend: [],
      database: [],
      testing: [],
      deployment: [],
    };

    const techMap = {
      express: 'backend',
      ejs: 'frontend',
      pg: 'database',
      passport: 'backend',
      tailwindcss: 'frontend',
      vite: 'frontend',
      nodemon: 'backend',
      eslint: 'testing',
      prettier: 'testing',
    };

    [...dependencies.dependencies, ...dependencies.devDependencies].forEach(
      (dep) => {
        const category = techMap[dep];
        if (category) {
          stack[category].push(dep);
        }
      }
    );

    return stack;
  }

  async assessCodebaseComplexity() {
    const structure = await this.analyzeProjectStructure();
    let complexity = 1;

    // File count complexity
    const totalFiles = Object.values(structure).reduce(
      (sum, dir) => sum + (dir.fileCount || 0),
      0
    );
    complexity += Math.log10(totalFiles + 1);

    // Directory complexity
    complexity += Object.keys(structure).length * 0.1;

    return Math.min(complexity, 5);
  }

  async analyzeRecentChanges() {
    // In a real implementation, this would analyze git history
    return {
      recentCommits: 0,
      changedFiles: [],
      activeAreas: [],
    };
  }

  /**
   * Create structured plan based on analysis
   */
  async createPlanStructure(analysis, codebaseContext) {
    const planId = `PLAN-${String(Date.now()).slice(-3)}`;

    const plan = {
      id: planId,
      title: this.generateTitle(analysis),
      description: this.generateDescription(analysis, codebaseContext),
      type: analysis.type,
      priority: analysis.priority,
      estimatedEffort: analysis.estimatedEffort,
      objectives: this.generateObjectives(analysis, codebaseContext),
      successCriteria: this.generateSuccessCriteria(analysis, codebaseContext),
      risks: this.identifyRisks(analysis, codebaseContext),
      dependencies: this.identifyDependencies(analysis, codebaseContext),
      tasks: this.generateTasks(analysis, codebaseContext),
      aiInsights: {
        confidence: analysis.confidence,
        complexity: analysis.complexity,
        scope: analysis.scope,
        keywords: analysis.keywords,
        recommendedApproach: this.recommendApproach(analysis, codebaseContext),
      },
    };

    return plan;
  }

  generateTitle(analysis) {
    const intent = analysis.intent;
    const keywords = analysis.keywords.slice(0, 3).join(' ');

    const titleTemplates = {
      create: `Implement ${keywords}`,
      fix: `Fix ${keywords} issues`,
      improve: `Enhance ${keywords}`,
      update: `Update ${keywords}`,
      remove: `Remove ${keywords}`,
      analyze: `Analyze ${keywords}`,
    };

    return (
      titleTemplates[intent] ||
      `${intent} ${keywords}`.replace(/^\w/, (c) => c.toUpperCase())
    );
  }

  generateDescription(analysis, codebaseContext) {
    const scope = analysis.scope.join(', ');
    const framework =
      codebaseContext.dependencies?.framework || 'the application';

    return (
      `${analysis.type} work focusing on ${scope} within ${framework}. ` +
      `Estimated complexity: ${analysis.complexity}/5. ` +
      `This work involves ${analysis.keywords.slice(0, 5).join(', ')}.`
    );
  }

  generateObjectives(analysis, _codebaseContext) {
    const objectives = [];

    // Intent-based objectives
    switch (analysis.intent) {
      case 'create':
        objectives.push('Design and implement new functionality');
        objectives.push('Ensure integration with existing systems');
        objectives.push('Add appropriate tests and documentation');
        break;
      case 'fix':
        objectives.push('Identify root cause of the issue');
        objectives.push(
          'Implement fix without breaking existing functionality'
        );
        objectives.push('Add tests to prevent regression');
        break;
      case 'improve':
        objectives.push('Analyze current implementation');
        objectives.push('Implement performance/quality improvements');
        objectives.push('Maintain backward compatibility');
        break;
      default:
        objectives.push('Complete the requested changes');
        objectives.push('Ensure code quality and testing');
        objectives.push('Update documentation as needed');
    }

    // Scope-specific objectives
    if (analysis.scope.includes('database')) {
      objectives.push('Handle database migrations safely');
    }
    if (analysis.scope.includes('auth')) {
      objectives.push('Maintain security best practices');
    }
    if (analysis.scope.includes('frontend')) {
      objectives.push('Ensure responsive design and accessibility');
    }

    return objectives;
  }

  generateSuccessCriteria(analysis, _codebaseContext) {
    const criteria = [];

    // Universal criteria
    criteria.push('All existing tests continue to pass');
    criteria.push('Code follows project style guidelines');
    criteria.push('No security vulnerabilities introduced');

    // Intent-specific criteria
    switch (analysis.intent) {
      case 'create':
        criteria.push('New functionality works as specified');
        criteria.push('New tests added with >80% coverage');
        break;
      case 'fix':
        criteria.push('Original issue is resolved');
        criteria.push('No new bugs introduced');
        break;
      case 'improve':
        criteria.push('Performance metrics show improvement');
        criteria.push('Code complexity is reduced');
        break;
    }

    // Scope-specific criteria
    if (analysis.scope.includes('database')) {
      criteria.push('Database migrations run successfully');
      criteria.push('Data integrity is maintained');
    }
    if (analysis.scope.includes('frontend')) {
      criteria.push('UI/UX meets design requirements');
      criteria.push('Cross-browser compatibility verified');
    }
    if (analysis.scope.includes('api')) {
      criteria.push('API endpoints return correct responses');
      criteria.push('API documentation is updated');
    }

    return criteria;
  }

  identifyRisks(analysis, _codebaseContext) {
    const risks = [];

    // Complexity-based risks
    if (analysis.complexity > 3) {
      risks.push({
        description: 'High complexity may lead to longer development time',
        mitigation: 'Break down into smaller, manageable tasks',
      });
    }

    // Scope-based risks
    if (analysis.scope.includes('database')) {
      risks.push({
        description: 'Database changes could affect data integrity',
        mitigation: 'Create backup and test migrations thoroughly',
      });
    }
    if (analysis.scope.includes('auth')) {
      risks.push({
        description: 'Authentication changes could lock out users',
        mitigation: 'Test with multiple user scenarios and have rollback plan',
      });
    }
    if (analysis.scope.length > 3) {
      risks.push({
        description: 'Multiple system changes increase integration risk',
        mitigation: 'Implement and test changes incrementally',
      });
    }

    // Default risk if none identified
    if (risks.length === 0) {
      risks.push({
        description: 'Unexpected edge cases may arise during implementation',
        mitigation: 'Thorough testing and code review',
      });
    }

    return risks;
  }

  identifyDependencies(analysis, _codebaseContext) {
    const dependencies = [];

    // Scope-based dependencies
    if (analysis.scope.includes('database') && analysis.scope.includes('api')) {
      dependencies.push(
        'Database schema changes must be completed before API updates'
      );
    }
    if (
      analysis.scope.includes('auth') &&
      analysis.scope.includes('frontend')
    ) {
      dependencies.push(
        'Authentication backend must be ready before frontend integration'
      );
    }
    if (analysis.scope.includes('testing')) {
      dependencies.push(
        'Core functionality must be implemented before comprehensive testing'
      );
    }

    return dependencies.length > 0 ? dependencies : ['None identified'];
  }

  generateTasks(analysis, _codebaseContext) {
    const tasks = [];
    let taskId = 1;

    // Planning phase tasks
    tasks.push({
      id: `TASK-${String(taskId++).padStart(3, '0')}`,
      description:
        'Review requirements and create detailed implementation plan',
      phase: 'Planning',
      estimated: '30 minutes',
    });

    // Implementation phase tasks based on scope
    if (analysis.scope.includes('database')) {
      tasks.push({
        id: `TASK-${String(taskId++).padStart(3, '0')}`,
        description: 'Create database migration scripts',
        phase: 'Implementation',
        estimated: '1 hour',
      });
    }

    if (analysis.scope.includes('backend') || analysis.scope.includes('api')) {
      tasks.push({
        id: `TASK-${String(taskId++).padStart(3, '0')}`,
        description: 'Implement backend logic and API endpoints',
        phase: 'Implementation',
        estimated: '2-4 hours',
      });
    }

    if (analysis.scope.includes('frontend')) {
      tasks.push({
        id: `TASK-${String(taskId++).padStart(3, '0')}`,
        description: 'Create/update frontend components and UI',
        phase: 'Implementation',
        estimated: '2-3 hours',
      });
    }

    // Testing phase tasks
    tasks.push({
      id: `TASK-${String(taskId++).padStart(3, '0')}`,
      description: 'Write and run comprehensive tests',
      phase: 'Testing',
      estimated: '1-2 hours',
    });

    // Documentation phase tasks
    tasks.push({
      id: `TASK-${String(taskId++).padStart(3, '0')}`,
      description: 'Update documentation and code comments',
      phase: 'Documentation',
      estimated: '30 minutes',
    });

    return tasks;
  }

  recommendApproach(analysis, _codebaseContext) {
    const approaches = [];

    // Complexity-based approach
    if (analysis.complexity > 3) {
      approaches.push('Break down into smaller, incremental changes');
      approaches.push('Use feature flags for gradual rollout');
    } else {
      approaches.push('Direct implementation with thorough testing');
    }

    // Scope-based approach
    if (analysis.scope.includes('database')) {
      approaches.push(
        'Database-first approach with careful migration planning'
      );
    }
    if (analysis.scope.includes('auth')) {
      approaches.push('Security-first approach with extensive testing');
    }
    if (analysis.scope.length > 2) {
      approaches.push(
        'Layer-by-layer implementation (backend → API → frontend)'
      );
    }

    return approaches;
  }

  /**
   * Enhanced tracking and metrics
   */
  async trackProgress(planId, progressData) {
    const timestamp = new Date().toISOString();

    // Update plan progress
    await this.updatePlanProgress(planId, progressData);

    // Calculate velocity metrics
    await this.updateVelocityMetrics(planId, progressData);

    // Check for auto-completion
    await this.checkAutoCompletion(planId);

    // Update learning data
    await this.updateLearningData(planId, progressData);

    logger.info('Progress tracked', { planId, timestamp });
  }

  async updatePlanProgress(_planId, _progressData) {
    // Implementation would update plan file with progress data
    // This is a placeholder for the actual file update logic
  }

  async updateVelocityMetrics(planId, progressData) {
    // Calculate completion velocity based on historical data
    const now = Date.now();
    const planStartTime = progressData.startTime || now;
    const timeElapsed = now - planStartTime;
    const progressPercent = progressData.progress || 0;

    if (progressPercent > 0) {
      const velocity = progressPercent / (timeElapsed / (1000 * 60 * 60)); // Progress per hour
      this.metrics.completionVelocity = velocity;
    }
  }

  async checkAutoCompletion(_planId) {
    // Check if all success criteria are met and auto-complete if so
    // This would integrate with the existing planning system
  }

  async updateLearningData(planId, progressData) {
    // Store data for improving future predictions
    this.planHistory.push({
      planId,
      timestamp: new Date().toISOString(),
      progressData,
      metrics: { ...this.metrics },
    });

    // Keep only recent history (last 100 plans)
    if (this.planHistory.length > 100) {
      this.planHistory = this.planHistory.slice(-100);
    }
  }

  /**
   * Generate real-time metrics and insights
   */
  async generateMetrics() {
    return {
      ...this.metrics,
      cacheStatus: this.codebaseCache.size > 0 ? 'Active' : 'Empty',
      planHistorySize: this.planHistory.length,
      lastUpdate: new Date().toISOString(),
      systemHealth: this.assessSystemHealth(),
    };
  }

  assessSystemHealth() {
    const health = {
      status: 'Healthy',
      issues: [],
    };

    if (this.metrics.planAccuracy < 0.7) {
      health.issues.push(
        'Low plan accuracy - consider refining analysis algorithms'
      );
    }
    if (this.metrics.completionVelocity < 0.1) {
      health.issues.push('Low completion velocity - plans may be too complex');
    }
    if (this.planHistory.length < 5) {
      health.issues.push(
        'Insufficient historical data for accurate predictions'
      );
    }

    if (health.issues.length > 0) {
      health.status = health.issues.length > 2 ? 'Needs Attention' : 'Warning';
    }

    return health;
  }
}

// CLI interface
if (require.main === module) {
  const aiPlanning = new AIPlanningEngine();

  const command = process.argv[2];
  const input = process.argv[3];

  switch (command) {
    case 'generate-plan':
      aiPlanning.generatePlan(input).then((plan) => {
        console.log(JSON.stringify(plan, null, 2));
      });
      break;

    case 'analyze-request':
      aiPlanning.analyzeRequest(input).then((analysis) => {
        console.log(JSON.stringify(analysis, null, 2));
      });
      break;

    case 'analyze-codebase':
      aiPlanning.analyzeCodebase([]).then((analysis) => {
        console.log(JSON.stringify(analysis, null, 2));
      });
      break;

    case 'metrics':
      aiPlanning.generateMetrics().then((metrics) => {
        console.log(JSON.stringify(metrics, null, 2));
      });
      break;

    default:
      console.log(`
AI Planning Engine Commands:
  generate-plan <request>    Generate a complete plan from user request
  analyze-request <request>  Analyze user request for intent and complexity
  analyze-codebase          Analyze current codebase structure and patterns
  metrics                   Show current AI planning metrics and health
`);
  }
}

module.exports = AIPlanningEngine;
