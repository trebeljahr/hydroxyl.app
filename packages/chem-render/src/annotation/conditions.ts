/**
 * A reaction arrow's conditions, as text: what each item prints as, which
 * side of the shaft it goes on, and where its lines break (decisions 193 and
 * 202).
 *
 * WHAT AN ITEM PRINTS AS.
 *
 *   - temperature and time are stored as numbers with a unit, and printed
 *     from them: `−78 °C` with a real minus (U+2212) and a degree sign, `298 K`,
 *     `30 min`, `2 h`. A figure then never carries a hyphen for a minus or a
 *     letter O for a degree sign, which is what typing them produces.
 *   - a reagent or a solvent is set as a FORMULA: a digit run straight after a
 *     letter or a closing bracket is subscripted (`NaBH4`, `Pd(PPh3)4`,
 *     `CH2Cl2`), and a sign at the very end of a token is a charge, raised
 *     (`H3O+`, `MeO-`). A number that starts a token is left alone (`2 M`,
 *     `18-crown-6`, `(10 mol%)`). Digits right before that sign are the
 *     charge only where nothing else can read them (decision 216): after a
 *     closing square bracket (`[Cu(NH3)4]2+`), and one digit after a single
 *     element symbol (`Fe3+`). Anywhere else the digit is its last element's
 *     COUNT — `NH4+` is NH₄⁺, never NH⁴⁺ — and of two or more digits only a
 *     last one from 2 to 9 is the charge (`SO42-` is SO₄²⁻, `C60-` is C₆₀⁻).
 *   - free text is printed EXACTLY as typed (decision 193): an author who
 *     wants none of the above writes a text item.
 *
 * WHERE IT GOES. One step: reagents ABOVE the shaft, everything else BELOW,
 * each side in stored order, items joined by ", ". Several steps: one line
 * per step, the first half (rounded up) above and the rest below, read top to
 * bottom; `numbered` prefixes each step `(i)`, `(ii)`.
 *
 * WHERE A LINE BREAKS. Only between items, never inside one — a reagent name
 * split across two lines is two different words — and the comma stays at the
 * end of the line it follows. The wrap width is the caller's: reaction.ts
 * derives it from the room between the species, which does not depend on the
 * arrow, so wrapping is not circular (decision 203).
 *
 * Nothing here knows a coordinate: it produces spans and measures them.
 */

import type { TextSpan } from "../scene/types.js";
import type { ReactionCondition, ReactionConditions } from "../scheme/annotation.js";

/** U+2212, the real minus sign: what a negative temperature and a charge print with. */
export const MINUS_SIGN = "−";

/**
 * A number as a figure prints it: no trailing zeros, at most three decimals,
 * a real minus for a negative. `-78` -> `−78`, `0.5` -> `0.5`, `12` -> `12`.
 */
export function formatQuantity(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  let text = Math.abs(rounded).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (text === "") text = "0";
  return rounded < 0 && text !== "0" ? `${MINUS_SIGN}${text}` : text;
}

const ROMAN: readonly (readonly [number, string])[] = [
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** `(i)`, `(ii)`, … for step `index` (from 0). */
export function stepLabel(index: number): string {
  let n = index + 1;
  let out = "";
  for (const [value, letters] of ROMAN) {
    while (n >= value) {
      out += letters;
      n -= value;
    }
  }
  return `(${out})`;
}

function isLetter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z]/.test(character);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Where a token ends: the text's end, whitespace, a comma, a slash or a closing bracket. */
function endsToken(character: string | undefined): boolean {
  return character === undefined || /[\s,;/)\]]/.test(character);
}

function isSign(character: string | undefined): boolean {
  return character === "+" || character === "-" || character === MINUS_SIGN;
}

/** Where a token starts: after whitespace, a comma, a semicolon, a slash or an opening bracket. */
function startsToken(character: string | undefined): boolean {
  return character === undefined || /[\s,;/([]/.test(character);
}

/** A single element symbol, `Fe`, `O`, `Cu`: what a monatomic ion's charge follows. */
const ELEMENT_SYMBOL = /^[A-Z][a-z]?$/;

/**
 * How many of `digits` — a digit run right before a sign that ends its token —
 * are the CHARGE (decision 216); the rest are the count of the element before
 * them. `stem` is the token up to the digits, `previous` the character just
 * before them.
 *
 *   - after `]`, all of them: `[Cu(NH3)4]2+` is a complex written in brackets;
 *   - one digit after a single element symbol, that digit: `Fe3+`, `Al3+`;
 *   - one digit anywhere else, none: `NH4+`, `NO3-`, `BF4-` count it;
 *   - two or more, the last when it is 2 to 9 (`SO42-`, `Cr2O72-`, `Hg22+`),
 *     else none: nobody writes a charge of 1 or 0, so `C60-` is all count.
 */
function chargeDigits(digits: string, stem: string, previous: string | undefined): number {
  if (previous === "]") return digits.length;
  if (digits.length === 1) return ELEMENT_SYMBOL.test(stem) ? 1 : 0;
  const last = digits[digits.length - 1]!;
  return last >= "2" && last <= "9" ? 1 : 0;
}

/**
 * `text` set as a formula: subscripted counts and raised charges (see the
 * module header). Adjacent spans of one script are merged, so a plain word is
 * one span.
 */
export function formulaSpans(text: string): TextSpan[] {
  const characters = [...text];
  const pieces: TextSpan[] = [];
  const push = (piece: string, script?: "sub" | "super"): void => {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.script === script) {
      pieces[pieces.length - 1] = script === undefined ? { text: last.text + piece } : { text: last.text + piece, script };
      return;
    }
    pieces.push(script === undefined ? { text: piece } : { text: piece, script });
  };
  let i = 0;
  while (i < characters.length) {
    const character = characters[i]!;
    const previous = characters[i - 1];
    const follows = isLetter(previous) || previous === ")" || previous === "]";
    if (isDigit(character) && follows) {
      let j = i;
      while (isDigit(characters[j])) j++;
      const digits = characters.slice(i, j).join("");
      // Digits then a sign that ends the token: the sign is a charge, and
      // some of the digits may be its size (decision 216).
      if (isSign(characters[j]) && endsToken(characters[j + 1])) {
        let start = i;
        while (!startsToken(characters[start - 1])) start--;
        const charged = chargeDigits(digits, characters.slice(start, i).join(""), previous);
        const count = digits.slice(0, digits.length - charged);
        if (count !== "") push(count, "sub");
        push(`${digits.slice(digits.length - charged)}${characters[j] === "+" ? "+" : MINUS_SIGN}`, "super");
        i = j + 1;
        continue;
      }
      push(digits, "sub");
      i = j;
      continue;
    }
    if (isSign(character) && endsToken(characters[i + 1]) && (follows || isDigit(previous))) {
      push(character === "+" ? "+" : MINUS_SIGN, "super");
      i += 1;
      continue;
    }
    push(character);
    i += 1;
  }
  return pieces;
}

const TEMPERATURE_SUFFIX = { C: "°C", K: "K" } as const;

/** What one condition prints as. */
export function conditionSpans(item: ReactionCondition): TextSpan[] {
  switch (item.kind) {
    case "temperature":
      return [{ text: `${formatQuantity(item.value)} ${TEMPERATURE_SUFFIX[item.unit]}` }];
    case "time":
      return [{ text: `${formatQuantity(item.value)} ${item.unit}` }];
    case "reagent":
    case "solvent":
      return formulaSpans(item.text);
    case "text":
      return [{ text: item.text }];
    default: {
      const unreachable: never = item;
      return unreachable;
    }
  }
}

/** The plain text a condition prints, scripts flattened: for reports and search. */
export function conditionText(item: ReactionCondition): string {
  return conditionSpans(item)
    .map((span) => span.text)
    .join("");
}

/** A line of conditions text, before it is placed. */
export type ConditionsLineSpans = readonly TextSpan[];

export interface ConditionsText {
  /** Top to bottom. */
  readonly above: readonly ConditionsLineSpans[];
  /** Top to bottom. */
  readonly below: readonly ConditionsLineSpans[];
}

export const EMPTY_CONDITIONS_TEXT: ConditionsText = Object.freeze({
  above: Object.freeze([]),
  below: Object.freeze([]),
});

/** A run of items printed as one sequence, `", "`-joined, maybe prefixed. */
interface Sequence {
  readonly prefix?: string;
  readonly items: readonly (readonly TextSpan[])[];
}

function joinSpans(parts: readonly (readonly TextSpan[])[]): TextSpan[] {
  const out: TextSpan[] = [];
  for (const part of parts) {
    for (const span of part) {
      const last = out[out.length - 1];
      if (last !== undefined && last.script === span.script) {
        out[out.length - 1] =
          span.script === undefined ? { text: last.text + span.text } : { text: last.text + span.text, script: span.script };
      } else {
        out.push(span.script === undefined ? { text: span.text } : { text: span.text, script: span.script });
      }
    }
  }
  return out;
}

const SEPARATOR: readonly TextSpan[] = [{ text: ", " }];
const TRAILING_COMMA: readonly TextSpan[] = [{ text: "," }];

/**
 * One sequence broken into lines no wider than `wrapWidthPx` where it can be:
 * greedily, at item boundaries only. An item wider than the width on its own
 * gets a line of its own and is NOT broken — the caller stretches the shaft
 * to it (decision 203) and reports the crowding if that is too long.
 */
function wrapSequence(
  sequence: Sequence,
  wrapWidthPx: number,
  measure: (spans: readonly TextSpan[]) => number,
): TextSpan[][] {
  const lines: TextSpan[][] = [];
  let current: (readonly TextSpan[])[] = sequence.prefix === undefined ? [] : [[{ text: `${sequence.prefix} ` }]];
  let hasItem = false;
  sequence.items.forEach((item, index) => {
    const last = index === sequence.items.length - 1;
    const tail = last ? [] : [TRAILING_COMMA];
    const candidate = hasItem ? [...current, SEPARATOR, item, ...tail] : [...current, item, ...tail];
    if (!hasItem || measure(joinSpans(candidate)) <= wrapWidthPx) {
      current = hasItem ? [...current, SEPARATOR, item] : [...current, item];
      hasItem = true;
      return;
    }
    lines.push(joinSpans([...current, TRAILING_COMMA]));
    current = [item];
  });
  if (hasItem) lines.push(joinSpans(current));
  return lines;
}

/**
 * The conditions as lines above and below the shaft, each no wider than
 * `wrapWidthPx` unless one item alone is.
 */
export function conditionsText(
  conditions: ReactionConditions,
  wrapWidthPx: number,
  measure: (spans: readonly TextSpan[]) => number,
): ConditionsText {
  const steps = conditions.steps.filter((step) => step.length > 0);
  if (steps.length === 0) return EMPTY_CONDITIONS_TEXT;
  const wrap = (sequence: Sequence): TextSpan[][] => wrapSequence(sequence, wrapWidthPx, measure);
  if (steps.length === 1) {
    const step = steps[0]!;
    const prefix = conditions.numbered ? stepLabel(0) : undefined;
    const reagents = step.filter((item) => item.kind === "reagent").map(conditionSpans);
    const rest = step.filter((item) => item.kind !== "reagent").map(conditionSpans);
    // The number belongs to the step, so it goes on whichever side the step's
    // first line is printed: above when there is a reagent, else below.
    return {
      above: reagents.length === 0 ? [] : wrap({ ...(prefix === undefined ? {} : { prefix }), items: reagents }),
      below:
        rest.length === 0
          ? []
          : wrap({ ...(prefix === undefined || reagents.length > 0 ? {} : { prefix }), items: rest }),
    };
  }
  const lines = steps.map((step, index) =>
    wrap({
      ...(conditions.numbered ? { prefix: stepLabel(index) } : {}),
      items: step.map(conditionSpans),
    }),
  );
  const split = Math.ceil(lines.length / 2);
  return { above: lines.slice(0, split).flat(), below: lines.slice(split).flat() };
}
