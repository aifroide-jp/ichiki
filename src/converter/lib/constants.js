'use strict';

// 語彙由来の定数は proposal/shared/constants.js が唯一の定義場所。
// ここでは再エクスポートと、変換器だけが使う定数の定義を行う。
const {
  TAG_TO_TYPE,
  DERIVABLE_TAGS,
  VALID_ACF_TYPES,
  VALID_DATA_PAGE,
  ACF_NAME_RE,
} = require('../../shared/constants');

// 構造宣言の一覧も lint と共有する（2箇所に書くと必ずズレるため）。
const { DECLARATION_ATTRS } = require('../../shared/declaration-attrs');

// --- 変換器だけが使うもの ----------------------------------------------
// CPT スラッグの接頭辞。モック側は素のスラッグ（spot / center）を書き、
// nkk_ を付けるのは変換器の責務（vocabulary.md 1章）。
const CPT_PREFIX = 'nkk_';

module.exports = {
  TAG_TO_TYPE,
  DERIVABLE_TAGS,
  VALID_ACF_TYPES,
  VALID_DATA_PAGE,
  ACF_NAME_RE,
  CPT_PREFIX,
  DECLARATION_ATTRS,
};
