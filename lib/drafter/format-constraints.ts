/**
 * WALKTHROUGH Note 33-fix.8 — deterministic format-constraint parser for
 * opportunity-page text. Atelier's prior pipeline shipped non-panoramic
 * frames as samples for Epson International Pano Awards because nothing
 * downstream knew the category required ≥ 2:1 aspect crops. This module
 * extracts hard format requirements from the fetched opportunity page
 * text and returns a structured constraints object the work-sample
 * selector applies as a hard filter on the candidate pool.
 *
 * Pure regex. No LLM call. No false confidence: when the page text is
 * silent on format, returns an empty constraints object and the selector
 * falls back to its previous behavior.
 */

export type FormatConstraints = {
  /** Image's `width / height` must be at least this. */
  minAspect?: number;
  /** Image's `width / height` must be at most this. */
  maxAspect?: number;
  /** Width strictly greater than height (landscape orientation required). */
  requiresLandscape?: boolean;
  /** Height strictly greater than width (portrait orientation required). */
  requiresPortrait?: boolean;
  /** Aspect ratio must be ~1.0 (within ±5%). */
  requiresSquare?: boolean;
  /** Maximum images allowed in the submission set. */
  maxImages?: number;
  /** Human-readable notes for the dossier UI warning. */
  notes: string[];
};

/**
 * Returns a constraints object derived from the opportunity page text
 * AND the opportunity name. The page text often hides the actual rules
 * behind a "Competition Rules" link the cheerio scrape doesn't follow,
 * so the opp name is treated as a reliable secondary signal — a
 * competition called "Pano Awards" / "Panoramic Photographer of the
 * Year" really is panoramic-only regardless of what the home-page body
 * says. `notes` is always present and contains every detected
 * constraint as a short human-readable string for surfacing to the
 * user.
 */
export function parseFormatConstraints(
  text: string | undefined | null,
  oppName?: string | undefined | null,
): FormatConstraints {
  const out: FormatConstraints = { notes: [] };
  if ((!text || text.length === 0) && (!oppName || oppName.length === 0)) return out;

  const lower = (text ?? '').toLowerCase();
  const nameLower = (oppName ?? '').toLowerCase();

  // 1. Explicit aspect-ratio call-outs ("2:1 minimum", "minimum 2:1 aspect",
  //    "ratio of at least 2:1"). Capture the W:H pair.
  const minAspectMatch = lower.match(/\b(?:minimum|min\.?|at least|≥|>=)\s*(?:aspect[- ]?ratio[: ]+)?(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\b/);
  if (minAspectMatch) {
    const w = Number(minAspectMatch[1]);
    const h = Number(minAspectMatch[2]);
    if (w > 0 && h > 0) {
      out.minAspect = w / h;
      out.notes.push(`category requires aspect ratio at least ${w}:${h}`);
    }
  }

  // Same shape, "X:Y or wider" / "X:Y and wider".
  if (out.minAspect === undefined) {
    const orWiderMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s+(?:or\s+wider|and\s+wider|or\s+more|or\s+greater)\b/);
    if (orWiderMatch) {
      const w = Number(orWiderMatch[1]);
      const h = Number(orWiderMatch[2]);
      if (w > 0 && h > 0) {
        out.minAspect = w / h;
        out.notes.push(`category requires aspect ratio at least ${w}:${h}`);
      }
    }
  }

  // 2. Panoramic-format inference. Two sources, either is sufficient:
  //    (a) the opp NAME contains "pano" / "panoramic" — competitions
  //        called "Pano Awards" / "Panoramic Photographer of the Year"
  //        are reliably panoramic-only (the rules page would say so but
  //        the home-page text often hides it behind a Rules link the
  //        cheerio scrape doesn't follow). Defaults to 2:1 floor.
  //    (b) the page text has an explicit "panoramic [only/required/
  //        format/minimum]" phrase. Tightened from a loose word match
  //        because the loose form falsely matched NANPA's Scapes-
  //        category description that mentions panoramic frames in
  //        passing.
  if (out.minAspect === undefined) {
    const nameSignal = /\b(pano|panoramic)\b/.test(nameLower);
    const textSignal =
      (text && (
        /\bpanoramic\s+(?:only|required|format|minimum|category|images?\s+only)\b/i.test(text) ||
        /\b(?:panoramic|panorama)\s+aspect\s+ratio\b/i.test(text) ||
        /\bmust\s+be\s+(?:a\s+)?panoramic\b/i.test(text)
      )) ?? false;
    if (nameSignal || textSignal) {
      out.minAspect = 2.0;
      out.notes.push('category requires panoramic format (≥ 2:1 aspect)');
    }
  }

  // 3. Square-only call-outs.
  if (text && /\b(square[- ]?(?:only|format only|format required))\b/i.test(text)) {
    out.requiresSquare = true;
    out.notes.push('category requires square (1:1) format');
  }

  // 4. Portrait-only / vertical-only call-outs.
  if (text && /\b(portrait[- ]?orientation|vertical[- ]?(?:only|format)|portrait[- ]?(?:only|format))\b/i.test(text)) {
    out.requiresPortrait = true;
    out.notes.push('category requires portrait / vertical orientation');
  }

  // 5. Landscape-only / horizontal-only call-outs.
  if (text && /\b(landscape[- ]?orientation\s+(?:only|required)|horizontal[- ]?(?:only|format))\b/i.test(text)) {
    out.requiresLandscape = true;
    out.notes.push('category requires landscape / horizontal orientation');
  }

  // 6. Maximum-image-count call-outs. Tightened to require the phrase
  //    "single image" / "one image" to appear next to an actual
  //    submission/entry/limit verb. Prior loose regex falsely matched
  //    natural-language phrases like "your single best image" or
  //    "a single panoramic entry from this body" in the page prose,
  //    capping the auto-selection at 1 image when no real limit existed.
  //    Also extracts numeric per-entry limits like "submit up to 4 images".
  const singleStrictMatch = text
    ? /\b(?:submit|enter|submission|entry|category(?:\s+limit)?|limit(?:ed)?)\s+(?:is\s+)?(?:to\s+|of\s+)?(?:a\s+|one\s+)?single[- ]image\b/i.test(text) ||
      /\b(?:submit|enter)\s+(?:exactly\s+|only\s+|just\s+)?one\s+(?:image|photograph)\b/i.test(text) ||
      /\bone[- ]image[- ]per[- ]entry\b/i.test(text) ||
      /\bsingle[- ]image\s+(?:entry|category|required|only|submission|limit)\b/i.test(text)
    : false;
  if (singleStrictMatch) {
    out.maxImages = 1;
    out.notes.push('single-image entry');
  } else {
    const maxMatch = lower.match(/\b(?:submit|enter|maximum|max\.?|up to|no more than)\s+(\d{1,2})\s+(?:images|photographs|photos|prints|works)\b/);
    if (maxMatch) {
      const n = Number(maxMatch[1]);
      if (n > 0 && n <= 50) {
        out.maxImages = n;
        out.notes.push(`maximum ${n} images per entry`);
      }
    }
  }

  return out;
}

/**
 * Returns `true` if the image's dimensions satisfy every constraint that
 * is present. Constraints not specified are not enforced.
 *
 * Missing dimensions: when ANY format constraint is active, a candidate
 * with null/zero dimensions is treated as FAILING (we cannot prove it
 * matches, and in a format-constrained competition we'd rather under-
 * select format-confident images than ship format-uncertain ones as if
 * verified). When NO constraint is active, missing dimensions pass.
 */
export function imageMatchesFormat(
  width: number | null | undefined,
  height: number | null | undefined,
  c: FormatConstraints,
): boolean {
  const noDims = !width || !height || width <= 0 || height <= 0;
  if (noDims) return !hasAnyFormatConstraint(c);
  const aspect = width! / height!;
  if (c.minAspect !== undefined && aspect < c.minAspect - 0.01) return false;
  if (c.maxAspect !== undefined && aspect > c.maxAspect + 0.01) return false;
  if (c.requiresSquare && Math.abs(aspect - 1.0) > 0.05) return false;
  if (c.requiresPortrait && height! <= width!) return false;
  if (c.requiresLandscape && width! <= height!) return false;
  return true;
}

/**
 * Returns `true` if the constraints object specifies any hard filter
 * (i.e. would change behavior compared to the no-constraints baseline).
 * Used by the work-sample selector to decide whether to apply the
 * format-aware filter at all.
 */
export function hasAnyFormatConstraint(c: FormatConstraints): boolean {
  return (
    c.minAspect !== undefined ||
    c.maxAspect !== undefined ||
    c.requiresSquare === true ||
    c.requiresPortrait === true ||
    c.requiresLandscape === true ||
    c.maxImages !== undefined
  );
}
