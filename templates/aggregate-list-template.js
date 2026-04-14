const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '../views');
const aggregateListPageTemplateFn = ejs.compile(
  fs.readFileSync(path.join(viewsDir, 'aggregate-list-page.ejs'), 'utf8'),
  { filename: 'aggregate-list-page.ejs', cache: true }
);

function createAggregateListTemplate(deps) {
  const {
    asset,
    generateAccentCssVars,
    generateAccentOverrides,
    headerComponent,
  } = deps;

  return (user, year) =>
    aggregateListPageTemplateFn({
      user,
      year,
      asset,
      generateAccentCssVars,
      generateAccentOverrides,
      headerComponent,
    });
}

module.exports = {
  createAggregateListTemplate,
};
