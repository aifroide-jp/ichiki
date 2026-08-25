'use strict';

const structure = require('./structure');
const acfFields = require('./acf-fields');
const crossCpt = require('./cross-cpt');
const commonNav = require('./common-nav');
const forms = require('./forms');
const cssInline = require('./css-inline');
const images = require('./images');
const headings = require('./headings');
const textCoverage = require('./text-coverage');
const absoluteRefs = require('./absolute-refs');
const linkTargets = require('./link-targets');
const fieldTypes = require('./field-types');
const docTitle = require('./doc-title');

// 単一ページで完結するルール(L01,L02,L03,L04,L05,L06,L07,L10,L11,L12,L13,L14,L15,L18,L19,L20,L21)
function runPerPageRules(page, rootDir) {
  return [
    ...structure.run(page),
    ...acfFields.run(page),
    ...forms.run(page),
    ...cssInline.run(page),
    ...images.runPerPage(page, rootDir),
    ...headings.run(page),
    ...textCoverage.run(page),
    ...absoluteRefs.run(page),
  ];
}

// ディレクトリ全体を見てから判定するルール(L08,L09,L16,L30,L31,L32)
function runCrossPageRules(pages, rootDir) {
  return [
    ...crossCpt.run(pages),
    ...commonNav.run(pages),
    ...images.runImagesRegistry(rootDir),
    ...linkTargets.run(pages),
    ...fieldTypes.run(pages),
    ...docTitle.run(pages),
  ];
}

module.exports = { runPerPageRules, runCrossPageRules };
