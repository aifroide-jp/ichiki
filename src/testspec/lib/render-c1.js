'use strict';
const { testCasePages, collapsedMembersOf } = require('./theme-model');

// Markdownテーブルのセル内で | や改行が構造を壊さないようにする
function cell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function visualDiffEvidence(vd) {
  if (!vd || (vd.desktopPct == null && vd.mobilePct == null)) return 'visual-diff未実行';
  const d = vd.desktopPct != null ? `${vd.desktopPct}%` : 'N/A';
  const m = vd.mobilePct != null ? `${vd.mobilePct}%` : 'N/A';
  return `デスクトップ diff: ${d} / モバイル diff: ${m}（参考値。最終判断は目視）`;
}

function responsiveEvidence(vd) {
  if (!vd || vd.mobilePct == null) return 'visual-diff未実行';
  return `モバイル diff: ${vd.mobilePct}%（参考値。最終判断は目視）`;
}

// ページ1件分の6種別を、Markdown/HTML共通の行データとして組み立てる
function buildPageRows(page, result) {
  const rows = [];

  rows.push({
    type: '表示確認',
    question: 'モックアップとの見た目一致（崩れ・文字化け・画像抜けがないか）',
    verdict: '要目視',
    evidence: visualDiffEvidence(result.visualDiff),
  });

  const acf = result.acf || { total: 0, matched: 0, missing: [], excludedImages: 0 };
  const acfOk = acf.missing.length === 0;
  let acfEvidence = `${acf.matched}/${acf.total} 一致`;
  if (acf.missing.length > 0) {
    acfEvidence += ` / 未検出: ${acf.missing.map(m => m.field_name).join(', ')}`;
  }
  if (acf.excludedImages > 0) {
    acfEvidence += ` / image型${acf.excludedImages}件は自動チェック対象外（要目視）`;
  }
  rows.push({
    type: 'ACF差し替え',
    question: 'ACFデフォルト値がライブページに反映されているか',
    verdict: acfOk ? '自動OK' : '自動NG',
    evidence: acfEvidence,
  });

  if (page.forms && page.forms.length > 0) {
    const cf7 = result.cf7;
    const ok = !!(cf7 && cf7.rendered);
    rows.push({
      type: 'フォーム送信',
      question: 'Contact Form 7 フォームが描画されているか',
      verdict: ok ? '自動OK（フォーム描画のみ。送信後のメール着信確認は要人手）' : '自動NG',
      evidence: ok ? 'wpcf7-form 検出' : 'wpcf7-form 未検出',
    });
  }

  const links = result.links || { checked: 0, broken: [] };
  let linksEvidence = `${links.checked}件確認`;
  if (links.broken.length > 0) {
    linksEvidence += ` / 切れリンク: ${links.broken.map(b => `${b.href}(${b.status})`).join(', ')}`;
  }
  rows.push({
    type: 'リンク遷移',
    question: 'ページ内リンクの遷移先が生存しているか',
    verdict: links.broken.length === 0 ? '自動OK' : '自動NG',
    evidence: linksEvidence,
  });

  rows.push({
    type: 'レスポンシブ',
    question: 'モバイル表示で文字・画像の重なり／はみ出しがないか',
    verdict: '要目視',
    evidence: responsiveEvidence(result.visualDiff),
  });

  const a11y = result.a11y;
  if (a11y) {
    const ok = a11y.violations === 0;
    rows.push({
      type: 'アクセシビリティ簡易チェック',
      question: 'pa11y-ci（axe-core）によるWCAG 2.0 AA自動検出',
      verdict: ok ? '自動OK' : `自動NG（違反${a11y.violations}件）`,
      evidence: 'pa11y-report.json より',
    });
  } else {
    rows.push({
      type: 'アクセシビリティ簡易チェック',
      question: 'pa11y-ci（axe-core）によるWCAG 2.0 AA自動検出',
      verdict: '未実行（別途 pa11y-ci を実行してください）',
      evidence: 'pa11y-report.json が見つからない',
    });
  }

  return rows;
}

function renderC1Markdown(model, checkResultsByPageId) {
  const cases = testCasePages(model.pages);
  const lines = [];

  lines.push('# Phase2 テスト仕様書（C1: 自動チェック結果つき）');
  lines.push('');
  lines.push('- 入力: acf-map.yaml');
  lines.push(`- acf-map.yaml 全ページ数: ${model.pages.length}`);
  lines.push(`- テストケース数: ${cases.length}（CPTは代表1件に集約。他は付録参照）`);
  lines.push('');
  lines.push('凡例: 「自動OK/自動NG」= 機械的に判定済み／「要目視」= 人が見て判断する項目（Excel/CSVの方はL1向け l1-checklist.tsv を参照。判定列は黄=要目視・未実行（未確定）・赤=自動NGで色分け）');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const page of cases) {
    const result = checkResultsByPageId[page.id] || {};
    lines.push(`## ${cell(page.title)} (${page.urlPath} → ${page.template})`);
    lines.push('');
    lines.push(`URL: ${page.liveUrl}`);
    lines.push('');

    if (page.kind === 'cpt-single' && page.representative) {
      const collapsed = collapsedMembersOf(model.pages, page.id);
      if (collapsed.length > 0) {
        const names = collapsed.map(c => c.title).join('、');
        lines.push(`※ 同じテンプレートを使う他${collapsed.length}件（${names}）は本ケースの結果に準ずる`);
        lines.push('');
      }
    }

    lines.push('| 種別 | 確認内容 | 判定 | 根拠 |');
    lines.push('|---|---|---|---|');
    for (const row of buildPageRows(page, result)) {
      lines.push(`| ${row.type} | ${cell(row.question)} | ${verdictCell(row.verdict)} | ${cell(row.evidence)} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 付録: テンプレート共有により集約されたページ一覧');
  lines.push('');
  const reps = cases.filter(p => p.kind === 'cpt-single' && p.representative);
  if (reps.length === 0) {
    lines.push('（該当なし）');
  } else {
    for (const rep of reps) {
      const collapsed = collapsedMembersOf(model.pages, rep.id);
      lines.push(`- 代表: ${rep.title}（${rep.template}） — 集約された他${collapsed.length}件:`);
      if (collapsed.length === 0) {
        lines.push('  - （なし）');
      } else {
        for (const c of collapsed) {
          lines.push(`  - ${c.title}（${c.urlPath}）`);
        }
      }
    }
  }
  lines.push('');

  lines.push('## ⚠ 要確認');
  lines.push('');
  const flagged = model.pages.filter(p => p.kind === 'unknown' || p.unresolved === true);
  if (flagged.length === 0) {
    lines.push('（該当なし）');
  } else {
    lines.push('以下は seed-posts.php に対応する投稿が見つからない、またはページ種別を判定できないため、手動確認が必要です。');
    lines.push('');
    for (const p of flagged) {
      const reasons = [];
      if (p.kind === 'unknown') reasons.push('ページ種別を判定できない');
      if (p.unresolved) reasons.push('seed-posts.php に対応投稿なし');
      lines.push(`- ${p.title}（${p.file}） — ${reasons.join(' / ')}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// 判定文字列から文字色を決める。要目視・未実行（=まだ確定していない）=黄系、自動NG系=赤系、自動OK=無色
function rowColor(verdict) {
  if (verdict.startsWith('要目視') || verdict.startsWith('未実行')) return '#b8860b';
  if (verdict.startsWith('自動NG')) return '#c62828';
  return '';
}

// GitHub等のHTML対応Markdownレンダラー向けに、判定セルだけ<span>で色付けする
function verdictCell(verdict) {
  const color = rowColor(verdict);
  const text = cell(verdict);
  return color ? `<span style="color:${color}">${text}</span>` : text;
}

module.exports = { renderC1Markdown };
