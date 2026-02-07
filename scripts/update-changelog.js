#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');

class ChangelogUpdater {
  constructor() {
    this.categories = {
      feature: '✨ Features',
      fix: '🐛 Bug Fixes',
      perf: '⚡ Performance',
      security: '🔒 Security',
      ui: '💄 UI/UX',
      docs: '📝 Documentation',
    };
  }

  async promptForInput(question) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  async interactiveUpdate() {
    console.log('\n📝 Changelog Update Assistant\n');

    // Get category
    console.log('Categories:');
    Object.entries(this.categories).forEach(([key, label]) => {
      console.log(`  ${key}: ${label}`);
    });

    const category =
      (await this.promptForInput(
        '\nSelect category (or press Enter for "feature"): '
      )) || 'feature';

    if (!this.categories[category]) {
      console.error(`❌ Invalid category: ${category}`);
      process.exit(1);
    }

    // Get description
    const description = await this.promptForInput('Enter change description: ');

    if (!description) {
      console.error('❌ Description is required');
      process.exit(1);
    }

    // Get optional details
    const details = await this.promptForInput(
      'Add details (optional, press Enter to skip): '
    );

    // Update changelog
    this.updateChangelog(category, description, details);
  }

  parseGitCommit() {
    // Parse from git commit message format
    const commitMsg = process.argv[2];

    if (!commitMsg) {
      return null;
    }

    // Patterns to detect category from commit
    const patterns = {
      feature: /^(feat|feature|add):/i,
      fix: /^(fix|bugfix|patch):/i,
      perf: /^(perf|performance|optimize):/i,
      security: /^(security|sec):/i,
      ui: /^(ui|ux|style):/i,
      docs: /^(docs|doc):/i,
    };

    let category = 'feature';
    let description = commitMsg;

    for (const [cat, pattern] of Object.entries(patterns)) {
      if (pattern.test(commitMsg)) {
        category = cat;
        description = commitMsg.replace(pattern, '').trim();
        break;
      }
    }

    return { category, description };
  }

  updateChangelog(category, description, details = '') {
    const today = new Date().toISOString().split('T')[0];

    // Read existing changelog
    let content;
    if (fs.existsSync(CHANGELOG_PATH)) {
      content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    } else {
      content =
        '# Changelog\n\nAll notable user-facing changes to this project will be documented in this file.\n\n## Recent Updates\n';
    }

    // Check if today's date section exists
    const dateHeader = `### ${today}`;
    const lines = content.split('\n');
    let dateIndex = lines.findIndex((line) => line === dateHeader);

    if (dateIndex === -1) {
      // Add new date section after "## Recent Updates"
      const recentIndex = lines.findIndex(
        (line) => line === '## Recent Updates'
      );
      if (recentIndex !== -1) {
        lines.splice(recentIndex + 1, 0, '', dateHeader, '');
        dateIndex = recentIndex + 2;
      }
    }

    // Format the entry
    let entry = `- **${description}**`;
    if (details) {
      entry += ` - ${details}`;
    }

    // Find where to insert the entry
    if (dateIndex !== -1) {
      // Find the next section or end of current date section
      let insertIndex = dateIndex + 1;
      while (
        insertIndex < lines.length &&
        !lines[insertIndex].startsWith('###') &&
        !lines[insertIndex].startsWith('##')
      ) {
        if (lines[insertIndex] === '') {
          // Found empty line after date header
          break;
        }
        insertIndex++;
      }

      // Insert the new entry
      lines.splice(insertIndex, 0, entry);
    }

    // Write back to file
    fs.writeFileSync(CHANGELOG_PATH, lines.join('\n'), 'utf8');

    console.log(`\n✅ Changelog updated successfully!`);
    console.log(`   Category: ${this.categories[category]}`);
    console.log(`   Entry: ${entry}\n`);
  }

  async quickUpdate(description, category = 'feature') {
    if (!description) {
      console.error('❌ Description is required');
      process.exit(1);
    }

    if (!this.categories[category]) {
      console.error(`❌ Invalid category: ${category}`);
      process.exit(1);
    }

    this.updateChangelog(category, description);
  }

  async run() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
      // Interactive mode
      await this.interactiveUpdate();
    } else if (args[0] === '--help' || args[0] === '-h') {
      this.showHelp();
    } else if (args[0] === '--git') {
      // Parse from git commit
      const parsed = this.parseGitCommit();
      if (parsed) {
        this.updateChangelog(parsed.category, parsed.description);
      } else {
        console.error('❌ Could not parse git commit message');
        process.exit(1);
      }
    } else if (args.length === 1) {
      // Quick update with description only
      await this.quickUpdate(args[0]);
    } else if (args.length === 2) {
      // Quick update with category and description
      await this.quickUpdate(args[1], args[0]);
    } else {
      this.showHelp();
    }
  }

  showHelp() {
    console.log(`
📝 Changelog Updater

Usage:
  node scripts/update-changelog.js                    # Interactive mode
  node scripts/update-changelog.js "description"      # Quick update (feature)
  node scripts/update-changelog.js category "desc"    # Quick update with category
  node scripts/update-changelog.js --git "msg"        # Parse from git commit

Categories:
  feature  - New features
  fix      - Bug fixes  
  perf     - Performance improvements
  security - Security updates
  ui       - UI/UX changes
  docs     - Documentation

Examples:
  npm run changelog                                   # Interactive
  npm run changelog "Added dark mode support"         # Quick feature
  npm run changelog fix "Fixed login validation"      # Quick fix
  npm run changelog:git "feat: Added user profiles"   # From git commit
`);
  }
}

// Run the updater
const updater = new ChangelogUpdater();
updater.run().catch(console.error);
