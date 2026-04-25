import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, lineHeight: 1.5 },
  coverTitle: { fontSize: 28, marginBottom: 4 },
  coverSub: { fontSize: 10, color: '#666', marginBottom: 24 },
  coverNarrative: { fontSize: 12, marginBottom: 24 },
  rankNarrative: { fontSize: 11, marginBottom: 24 },
  h2: { fontSize: 16, marginTop: 16, marginBottom: 10 },
  h3: { fontSize: 13, fontWeight: 'bold', marginTop: 12, marginBottom: 6 },
  matchTitle: { fontSize: 14, fontWeight: 'bold' },
  matchMeta: { fontSize: 9, color: '#666', marginBottom: 8 },
  materialBlock: { fontSize: 10, marginTop: 4 },
  filteredBlurb: { fontSize: 10, marginBottom: 6, borderLeft: '2pt solid #ccc', paddingLeft: 8 },
  hr: { borderBottom: '1pt solid #ddd', marginTop: 12, marginBottom: 12 },
});

export type PdfMatch = {
  name: string;
  url: string;
  deadline: string | null;
  award_summary: string | null;
  prestige_tier: string;
  fit_score: number;
  composite_score: number | null;
  reasoning: string;
  artist_statement: string | null;
  project_proposal: string | null;
  // WALKTHROUGH Note 22-fix.3: cv_formatted dropped — master CV lives at the
  // dossier level (see DossierDocument.masterCv prop) and renders once in
  // the appendix, not duplicated on every per-opp page.
  cover_letter: string | null;
};

export type PdfFiltered = { name: string; blurb: string };

export function DossierDocument(props: {
  cover: string;
  ranking: string;
  matches: PdfMatch[];
  filteredOut: PdfFiltered[];
  // WALKTHROUGH Note 22-fix.3: master CV rendered once in the appendix.
  // Null when the run pre-dates the master_cv migration.
  masterCv: string | null;
  // WALKTHROUGH Note 4: PDF cover byline uses artist_name (the public-facing
  // identity), never legal_name. legal_name belongs in tax/contract blocks
  // only — the dossier cover is the public packet.
  artistName: string;
}) {
  return (
    <Document>
      {/* Cover page */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.coverTitle}>Career Dossier</Text>
        <Text style={styles.coverSub}>{props.artistName}</Text>
        {paragraphs(props.cover).map((p, i) => (
          <Text key={i} style={styles.coverNarrative}>
            {p}
          </Text>
        ))}
      </Page>

      {/* Ranking intro */}
      {props.matches.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.h2}>Ranked Opportunities ({props.matches.length})</Text>
          {paragraphs(props.ranking).map((p, i) => (
            <Text key={i} style={styles.rankNarrative}>
              {p}
            </Text>
          ))}
        </Page>
      )}

      {/* One page per match */}
      {props.matches.map((m, i) => (
        <Page key={i} size="LETTER" style={styles.page}>
          <Text style={styles.matchTitle}>
            {i + 1}. {m.name}
          </Text>
          <Text style={styles.matchMeta}>
            {m.prestige_tier} · {m.deadline ? `deadline ${m.deadline}` : 'rolling'} ·{' '}
            {m.award_summary ?? 'see page'} · fit {m.fit_score.toFixed(2)} · composite{' '}
            {(m.composite_score ?? 0).toFixed(2)}
          </Text>
          <Text style={styles.h3}>Why this match</Text>
          <Text style={styles.materialBlock}>{m.reasoning}</Text>

          {m.artist_statement && (
            <>
              <View style={styles.hr} />
              <Text style={styles.h3}>Artist Statement</Text>
              {paragraphs(m.artist_statement).map((p, j) => (
                <Text key={j} style={styles.materialBlock}>
                  {p}
                </Text>
              ))}
            </>
          )}
          {m.project_proposal && (
            <>
              <View style={styles.hr} />
              <Text style={styles.h3}>Project Proposal</Text>
              {paragraphs(m.project_proposal).map((p, j) => (
                <Text key={j} style={styles.materialBlock}>
                  {p}
                </Text>
              ))}
            </>
          )}
          {m.cover_letter && (
            <>
              <View style={styles.hr} />
              <Text style={styles.h3}>Cover Letter</Text>
              {paragraphs(m.cover_letter).map((p, j) => (
                <Text key={j} style={styles.materialBlock}>
                  {p}
                </Text>
              ))}
            </>
          )}
        </Page>
      ))}

      {/* WALKTHROUGH Note 22-fix.3: master CV appendix — one canonical CV
          for the whole dossier, instead of duplicating it on every per-opp
          page. */}
      {props.masterCv && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.h2}>Curriculum Vitae</Text>
          {paragraphs(props.masterCv).map((p, i) => (
            <Text key={i} style={styles.materialBlock}>
              {p}
            </Text>
          ))}
        </Page>
      )}

      {/* Filtered-out page */}
      {props.filteredOut.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.h2}>Filtered Out</Text>
          {props.filteredOut.map((f, i) => (
            <Text key={i} style={styles.filteredBlurb}>
              {f.blurb}
            </Text>
          ))}
        </Page>
      )}
    </Document>
  );
}

function paragraphs(s: string): string[] {
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
