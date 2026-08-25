'use strict';

// 定義は src/shared/constants.js にある。ここでは再エクスポートするだけ。
// 2箇所に書くと語彙を変えたときに片方だけ直して必ず乖離するため。
const {
  TAG_TO_TYPE,
  DERIVABLE_TAGS,
  VALID_ACF_TYPES,
  VALID_DATA_PAGE,
  ACF_NAME_RE,
} = require('../../shared/constants');

module.exports = {
  TAG_TO_TYPE,
  DERIVABLE_TAGS,
  VALID_ACF_TYPES,
  VALID_DATA_PAGE,
  ACF_NAME_RE,
};
