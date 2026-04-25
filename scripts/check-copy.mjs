#!/usr/bin/env node
/**
 * CI grep guard for user-facing internal vocabulary.
 *
 * Fails the build if any banned term appears in app/** or components/**
 * outside the explicit allowlist (lib/ui/copy.ts, comments, server-only
 * agent files, CSS, build output). The point: keep the user-facing
 * surface free of internal jargon. See lib/ui/design-system.md.
 *
 * Run: pnpm check:copy
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app', 'components'];
const ALLOW_FILES = new Set([
  // Internal architecture docs / comments are exempt — only USER-VISIBLE
  // strings count. Files where comments inevitably mention these terms.
  'app/api', // server routes can name internal concepts
  'lib', // server-only
]);

// Each pattern: substring or regex, plus a contextual rule for HOW to
// detect "user-visible". We match the literal token in TSX text/string
// literals only — code identifiers (constant names, type aliases) are
// allowed. Heuristic: a banned term inside a JSX text node, a
// double-quoted JSX attribute string, or a placeholder/label is flagged.
const BANNED = [
  { term: 'composite_score', why: 'use tier label via fitTier() / lib/ui/copy.ts' },
  { term: 'fit_score', why: 'use tier label via fitTier() / lib/ui/copy.ts' },
  // "AKB" as a standalone capitalized token (not "akb_..." identifiers)
  { term: '\\bAKB\\b', why: 'say "Knowledge Base"', regex: true },
  { term: 'Rubric Matcher', why: 'describe the work, not the agent name' },
  { term: 'Style Analyst', why: 'describe the work, not the agent name' },
  { term: 'Knowledge Extractor', why: 'describe the work, not the agent name' },
  { term: 'Opportunity Scout', why: 'describe the work, not the agent name' },
  { term: 'Package Drafter', why: 'describe the work, not the agent name' },
  // ingest/ingested → import/added — only flag when standalone words, not
  // identifier substrings like "ingestUrls"
  { term: '\\bingest(ed|ing|ion)?\\b', why: 'say "import" / "added"', regex: true },
];

// Files we deliberately allow internal terms in (architecture comments,
// server-only modules, build artifacts).
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'tests',
  '.git',
]);
const SKIP_BASENAMES = new Set([
  // The drafter sometimes refers to AKB in its system prompts (server-only)
  // — agent prompts are not user-visible UI strings.
]);

// Allowlist files that may legitimately reference these terms in user
// text — typically files that explain/manage the terms themselves.
const ALLOWLIST_FILES = new Set([
  'app/_components/cycling-status.tsx',
  // dossier-view's filtered-out section displays the Rubric's reasoning;
  // its own UI copy is clean now but the type definition references
  // composite_score as a property — that's OK (it's a JS field, not user text).

  // Server data-fetch component — composite_score / fit_score appear
  // inside SQL string literals (column names), never rendered to user.
  'app/(dashboard)/dossier/[runId]/page.tsx',
  // DossierMatch type definition uses fit_score / composite_score as
  // FIELD names — those are JS object keys, never JSX text. The actual
  // user-rendered cards use fitTier() per Note 13.
  'app/(dashboard)/dossier/[runId]/dossier-view.tsx',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) walk(path, out);
    else if (['.ts', '.tsx'].includes(extname(entry)) && !SKIP_BASENAMES.has(entry)) {
      out.push(path);
    }
  }
  return out;
}

function isAllowlisted(file) {
  const norm = file.replace(/^\.\//, '');
  if (ALLOWLIST_FILES.has(norm)) return true;
  // Skip files inside app/api/** and lib/** entirely — those are server
  // code, not user-visible UI surfaces.
  if (norm.startsWith('app/api/') || norm.startsWith('lib/')) return true;
  // The internal type definitions on the dossier are inside dossier-view's
  // `DossierMatch` type — a TS field name, not visible string. We allow
  // dossier-view to keep `fit_score` / `composite_score` as type fields
  // because the values are not rendered (Note 13).
  return false;
}

function findHits(text, pattern) {
  if (pattern.regex) {
    const re = new RegExp(pattern.term, 'g');
    const hits = [];
    let m;
    while ((m = re.exec(text)) !== null) hits.push({ index: m.index, match: m[0] });
    return hits;
  }
  const hits = [];
  let i = 0;
  while ((i = text.indexOf(pattern.term, i)) !== -1) {
    hits.push({ index: i, match: pattern.term });
    i += pattern.term.length;
  }
  return hits;
}

function lineOfIndex(text, idx) {
  return text.slice(0, idx).split('\n').length;
}

function isUserVisibleText(text, idx, matchLen) {
  // Conservative heuristic — flag the hit ONLY when it sits inside a
  // JSX text node (between > and <) OR inside a quoted string that
  // contains a space (i.e. looks like prose, not an enum / field name /
  // path). Skip identifiers (adjacent word chars), comments, imports,
  // type-property names like `ingested: number`, and single-token enum
  // string literals like `'ingesting'`.
  const before = text.slice(Math.max(0, idx - 120), idx);
  const after = text.slice(idx, idx + 200);
  // adjacent word char → identifier substring
  const prevChar = text[idx - 1] ?? '';
  const nextChar = text[idx + matchLen] ?? '';
  if (/[A-Za-z0-9_]/.test(prevChar)) return false;
  if (/[A-Za-z0-9_]/.test(nextChar)) return false;
  // import paths, single-line comments, block comments
  if (/from\s+['"][^'"]*$/.test(before)) return false;
  if (/\/\/[^\n]*$/.test(before)) return false;
  const lastBlockOpen = before.lastIndexOf('/*');
  const lastBlockClose = before.lastIndexOf('*/');
  if (lastBlockOpen > lastBlockClose) return false;

  // JSDoc / TSDoc comment context — same idea, captured loosely
  if (/^\s*\*\s.*$/m.test(text.slice(text.lastIndexOf('\n', idx) + 1, idx))) return false;

  // type-property name like `ingested: number,` or interface member shape
  const lineStart = text.lastIndexOf('\n', idx) + 1;
  const lineUpToHit = text.slice(lineStart, idx);
  const lineTail = text.slice(idx + matchLen, idx + matchLen + 40);
  if (/^\s*$/.test(lineUpToHit) && /^\s*[:?]/.test(lineTail)) return false;

  // Find the surrounding quoted-string boundary (single or double quote
  // OR backtick). Cheap walk-back from idx until quote / boundary.
  let i = idx - 1;
  let openQuote = '';
  while (i >= 0) {
    const c = text[i];
    if (c === '\n') break;
    if (c === '"' || c === "'" || c === '`') {
      openQuote = c;
      break;
    }
    i--;
  }
  if (openQuote) {
    // find matching close on the same/forward line
    let j = idx + matchLen;
    let body = text.slice(i + 1, idx + matchLen);
    while (j < text.length && text[j] !== openQuote && text[j] !== '\n') {
      body += text[j];
      j++;
    }
    // single-token (no space) string literal → likely an enum / status /
    // path / API URL, not user prose. Skip.
    if (!/\s/.test(body)) return false;
    // string starts with '/' → URL/path
    if (body.startsWith('/')) return false;
    return true;
  }

  // No surrounding quote — could be JSX text node. JSX text appears
  // outside braces between > and <. Look back for nearest > and forward
  // for nearest <.
  const lastGt = text.lastIndexOf('>', idx);
  const lastLt = text.lastIndexOf('<', idx);
  if (lastGt > lastLt) {
    // we're between a > and a... check forward for <
    const fwdLt = text.indexOf('<', idx);
    const fwdGt = text.indexOf('>', idx);
    if (fwdLt !== -1 && (fwdGt === -1 || fwdLt < fwdGt)) return true;
  }
  return false;
}

function main() {
  const files = ROOTS.flatMap((r) => {
    try {
      return walk(r);
    } catch {
      return [];
    }
  });
  const violations = [];
  for (const file of files) {
    if (isAllowlisted(file)) continue;
    const text = readFileSync(file, 'utf-8');
    for (const pat of BANNED) {
      const hits = findHits(text, pat);
      for (const h of hits) {
        if (!isUserVisibleText(text, h.index, h.match.length)) continue;
        violations.push({
          file,
          line: lineOfIndex(text, h.index),
          term: h.match,
          why: pat.why,
        });
      }
    }
  }
  if (violations.length === 0) {
    console.log('[check-copy] OK — no banned terms in user-facing surfaces');
    return;
  }
  console.error(`[check-copy] ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  "${v.term}"  → ${v.why}`);
  }
  console.error('');
  console.error('Move user-facing strings to lib/ui/copy.ts or rephrase using the design system vocabulary.');
  process.exit(1);
}

main();
