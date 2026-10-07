/**
 * Element reference data.
 *
 * Replaces the old `maxBonds: number` model, which cannot be right: sulfur is
 * divalent in a thiol, tetravalent in a sulfoxide and hexavalent in a sulfone.
 * Implicit-hydrogen counting needs the full list of common valences so it can
 * pick the smallest one that accommodates the bonds actually drawn.
 *
 * The valence lists follow RDKit's default valence table, deliberately: RDKit
 * is the oracle for import/export, so disagreeing with it would surface as
 * round-trip drift. An empty list means "never add implicit hydrogens" (how
 * RDKit treats transition metals). A list of `[0]` — the noble gases — means
 * no hydrogens AND no bonds: RDKit refuses a bond to neon outright, so a drawn
 * one is reported as over-valent here rather than exported into a refusal.
 *
 * THE LISTS WERE READ OFF THE PINNED RDKit (2025.3.4), NOT OUT OF A TEXTBOOK.
 * RDKit's table moved in 2024.09, and the older one this file was first
 * calibrated against disagreed with it on eleven rows: gallium and indium had
 * no valence here and three there, so a lone Ga came back from a round trip
 * as GaH3; xenon and polonium had none here and gained hydrogens there;
 * iodine and astatine stopped at 5 there and carried 7 here, so IF6 drew one
 * hydrogen that RDKit refused to sanitise. The client's
 * `valence-table.node.test.ts` re-probes the real wasm for every element, so
 * the next RDKit bump that moves a row fails a test instead of a round trip.
 *
 * PRECISION NOTE. `weight` is the IUPAC standard atomic weight (2021); for
 * elements with no stable isotope it is the mass number of the longest-lived
 * one. `monoisotopic` is the mass of the most abundant isotope and is only
 * populated where the value is reliable — mass-spec output must not be built
 * on a half-remembered constant. `exactMass()` in formula.ts refuses to guess
 * when it is missing. An isotope-labelled atom is not weighed from this table
 * at all: its nuclide's mass comes from nuclides.ts.
 */

export type ElementSymbol = string;

export type ElementCategory =
  | "nonmetal"
  | "noble"
  | "alkali"
  | "alkaline"
  | "metalloid"
  | "halogen"
  | "transition"
  | "post-transition"
  | "lanthanide"
  | "actinide";

export interface ElementInfo {
  /** Atomic number. */
  readonly z: number;
  readonly symbol: ElementSymbol;
  readonly name: string;
  /** 1-18, or 0 for the f-block rows. */
  readonly group: number;
  readonly period: number;
  readonly category: ElementCategory;
  /** IUPAC standard atomic weight, or mass number in brackets for unstable. */
  readonly weight: number;
  /** Mass of the most abundant isotope. Undefined where not reliably known. */
  readonly monoisotopic: number | undefined;
  /**
   * Common valences, ascending. Empty means no implicit hydrogens are ever
   * added (metals, noble gases).
   */
  readonly valences: readonly number[];
  /** Jmol/CPK colour, `#rrggbb`. */
  readonly color: string;
}

const CATEGORY_CODES: Record<string, ElementCategory> = {
  n: "nonmetal",
  g: "noble",
  a: "alkali",
  e: "alkaline",
  m: "metalloid",
  h: "halogen",
  t: "transition",
  p: "post-transition",
  l: "lanthanide",
  c: "actinide",
};

// z|symbol|name|group|period|category|weight|monoisotopic|valences|color
const TABLE = `
1|H|Hydrogen|1|1|n|1.008|1.0078250319|1|FFFFFF
2|He|Helium|18|1|g|4.002602|4.0026032497|0|D9FFFF
3|Li|Lithium|1|2|a|6.94|7.0160040|1|CC80FF
4|Be|Beryllium|2|2|e|9.0121831|9.0121821|2|C2FF00
5|B|Boron|13|2|m|10.81|11.0093055|3|FFB5B5
6|C|Carbon|14|2|n|12.011|12|4|909090
7|N|Nitrogen|15|2|n|14.007|14.0030740052|3|3050F8
8|O|Oxygen|16|2|n|15.999|15.9949146221|2|FF0D0D
9|F|Fluorine|17|2|h|18.998403162|18.9984032|1|90E050
10|Ne|Neon|18|2|g|20.1797|19.9924401759|0|B3E3F5
11|Na|Sodium|1|3|a|22.98976928|22.98976967|1|AB5CF2
12|Mg|Magnesium|2|3|e|24.305|23.98504190|2|8AFF00
13|Al|Aluminium|13|3|p|26.9815384|26.98153844|3|BFA6A6
14|Si|Silicon|14|3|m|28.085|27.9769265327|4|F0C8A0
15|P|Phosphorus|15|3|n|30.973761998|30.97376151|3,5|FF8000
16|S|Sulfur|16|3|n|32.06|31.97207069|2,4,6|FFFF30
17|Cl|Chlorine|17|3|h|35.45|34.96885271|1|1FF01F
18|Ar|Argon|18|3|g|39.95|39.9623831|0|80D1E3
19|K|Potassium|1|4|a|39.0983|38.9637069|1|8F40D4
20|Ca|Calcium|2|4|e|40.078|39.9625912|2|3DFF00
21|Sc|Scandium|3|4|t|44.955907|||E6E6E6
22|Ti|Titanium|4|4|t|47.867|47.9479471||BFC2C7
23|V|Vanadium|5|4|t|50.9415|50.9439637||A6A6AB
24|Cr|Chromium|6|4|t|51.9961|51.9405119||8A99C7
25|Mn|Manganese|7|4|t|54.938043|54.9380496||9C7AC7
26|Fe|Iron|8|4|t|55.845|55.9349421||E06633
27|Co|Cobalt|9|4|t|58.933194|58.9332002||F090A0
28|Ni|Nickel|10|4|t|58.6934|57.9353479||50D050
29|Cu|Copper|11|4|t|63.546|62.9296011||C88033
30|Zn|Zinc|12|4|t|65.38|63.9291466||7D80B0
31|Ga|Gallium|13|4|p|69.723||3|C28F8F
32|Ge|Germanium|14|4|m|72.630||4|668F8F
33|As|Arsenic|15|4|m|74.921595|74.9215964|3,5|BD80E3
34|Se|Selenium|16|4|n|78.971|79.9165196|2,4,6|FFA100
35|Br|Bromine|17|4|h|79.904|78.9183376|1|A62929
36|Kr|Krypton|18|4|g|83.798||0|5CB8D1
37|Rb|Rubidium|1|5|a|85.4678||1|702EB0
38|Sr|Strontium|2|5|e|87.62||2|00FF00
39|Y|Yttrium|3|5|t|88.905838|||94FFFF
40|Zr|Zirconium|4|5|t|91.222|||94E0E0
41|Nb|Niobium|5|5|t|92.90637|||73C2C9
42|Mo|Molybdenum|6|5|t|95.95|||54B5B5
43|Tc|Technetium|7|5|t|97|||3B9E9E
44|Ru|Ruthenium|8|5|t|101.07|101.9043493||248F8F
45|Rh|Rhodium|9|5|t|102.90549|||0A7D8C
46|Pd|Palladium|10|5|t|106.42|105.903483||006985
47|Ag|Silver|11|5|t|107.8682|106.905093||C0C0C0
48|Cd|Cadmium|12|5|t|112.414|||FFD98F
49|In|Indium|13|5|p|114.818||3|A67573
50|Sn|Tin|14|5|p|118.710|119.9021947|2,4|668080
51|Sb|Antimony|15|5|m|121.760|120.9038180|3,5|9E63B5
52|Te|Tellurium|16|5|m|127.60|129.9062244|2,4,6|D47A00
53|I|Iodine|17|5|h|126.90447|126.904468|1,3,5|940094
54|Xe|Xenon|18|5|g|131.293||0,2,4,6|429EB0
55|Cs|Caesium|1|6|a|132.90545196|132.905447|1|57178F
56|Ba|Barium|2|6|e|137.327|137.9052414|2|00C900
57|La|Lanthanum|0|6|l|138.90547|||70D4FF
58|Ce|Cerium|0|6|l|140.116|||FFFFC7
59|Pr|Praseodymium|0|6|l|140.90766|||D9FFC7
60|Nd|Neodymium|0|6|l|144.242|||C7FFC7
61|Pm|Promethium|0|6|l|145|||A3FFC7
62|Sm|Samarium|0|6|l|150.36|||8FFFC7
63|Eu|Europium|0|6|l|151.964|||61FFC7
64|Gd|Gadolinium|0|6|l|157.249|||45FFC7
65|Tb|Terbium|0|6|l|158.925354|||30FFC7
66|Dy|Dysprosium|0|6|l|162.500|||1FFFC7
67|Ho|Holmium|0|6|l|164.930329|||00FF9C
68|Er|Erbium|0|6|l|167.259|||00E675
69|Tm|Thulium|0|6|l|168.934219|||00D452
70|Yb|Ytterbium|0|6|l|173.045|||00BF38
71|Lu|Lutetium|0|6|l|174.9668|||00AB24
72|Hf|Hafnium|4|6|t|178.486|||4DC2FF
73|Ta|Tantalum|5|6|t|180.94788|||4DA6FF
74|W|Tungsten|6|6|t|183.84|||2194D6
75|Re|Rhenium|7|6|t|186.207|||267DAB
76|Os|Osmium|8|6|t|190.23|||266696
77|Ir|Iridium|9|6|t|192.217|||175487
78|Pt|Platinum|10|6|t|195.084|194.9647911||D0D0E0
79|Au|Gold|11|6|t|196.966570|196.966552||FFD123
80|Hg|Mercury|12|6|t|200.592|201.970626||B8B8D0
81|Tl|Thallium|13|6|p|204.38|||A6544D
82|Pb|Lead|14|6|p|207.2||2,4|575961
83|Bi|Bismuth|15|6|p|208.98040||3,5|9E4FB5
84|Po|Polonium|16|6|p|209||2,4,6|AB5C00
85|At|Astatine|17|6|h|210||1,3,5|754F45
86|Rn|Radon|18|6|g|222||0|428296
87|Fr|Francium|1|7|a|223||1|420066
88|Ra|Radium|2|7|e|226||2|007D00
89|Ac|Actinium|0|7|c|227|||70ABFA
90|Th|Thorium|0|7|c|232.0377|||00BAFF
91|Pa|Protactinium|0|7|c|231.03588|||00A1FF
92|U|Uranium|0|7|c|238.02891|||008FFF
93|Np|Neptunium|0|7|c|237|||0080FF
94|Pu|Plutonium|0|7|c|244|||006BFF
95|Am|Americium|0|7|c|243|||545CF2
96|Cm|Curium|0|7|c|247|||785CE3
97|Bk|Berkelium|0|7|c|247|||8A4FE3
98|Cf|Californium|0|7|c|251|||A136D4
99|Es|Einsteinium|0|7|c|252|||B31FD4
100|Fm|Fermium|0|7|c|257|||B31FBA
101|Md|Mendelevium|0|7|c|258|||B30DA6
102|No|Nobelium|0|7|c|259|||BD0D87
103|Lr|Lawrencium|0|7|c|266|||C70066
104|Rf|Rutherfordium|4|7|t|267|||CC0059
105|Db|Dubnium|5|7|t|268|||D1004F
106|Sg|Seaborgium|6|7|t|269|||D90045
107|Bh|Bohrium|7|7|t|270|||E00038
108|Hs|Hassium|8|7|t|269|||E6002E
109|Mt|Meitnerium|9|7|t|278|||EB0026
110|Ds|Darmstadtium|10|7|t|281|||EB0026
111|Rg|Roentgenium|11|7|t|282|||EB0026
112|Cn|Copernicium|12|7|t|285|||EB0026
113|Nh|Nihonium|13|7|p|286|||EB0026
114|Fl|Flerovium|14|7|p|289|||EB0026
115|Mc|Moscovium|15|7|p|290|||EB0026
116|Lv|Livermorium|16|7|p|293|||EB0026
117|Ts|Tennessine|17|7|h|294|||EB0026
118|Og|Oganesson|18|7|g|294|||EB0026
`;

function parseTable(): ElementInfo[] {
  const out: ElementInfo[] = [];
  for (const raw of TABLE.trim().split("\n")) {
    const f = raw.split("|");
    const [z, symbol, name, group, period, category, weight, mono, valences, color] = f;
    if (
      z === undefined ||
      symbol === undefined ||
      name === undefined ||
      group === undefined ||
      period === undefined ||
      category === undefined ||
      weight === undefined ||
      color === undefined
    ) {
      throw new Error(`Malformed element row: ${raw}`);
    }
    const cat = CATEGORY_CODES[category];
    if (!cat) throw new Error(`Unknown category code "${category}" in row: ${raw}`);
    out.push({
      z: Number(z),
      symbol,
      name,
      group: Number(group),
      period: Number(period),
      category: cat,
      weight: Number(weight),
      monoisotopic: mono ? Number(mono) : undefined,
      valences: valences ? valences.split(",").map(Number) : [],
      color: `#${color}`,
    });
  }
  return out;
}

export const ELEMENTS: readonly ElementInfo[] = Object.freeze(parseTable());

const BY_SYMBOL = new Map<string, ElementInfo>(ELEMENTS.map((e) => [e.symbol, e]));
const BY_Z = new Map<number, ElementInfo>(ELEMENTS.map((e) => [e.z, e]));
const BY_LOWER_NAME = new Map<string, ElementInfo>(
  ELEMENTS.map((e) => [e.name.toLowerCase(), e]),
);

/** Case-sensitive symbol lookup. "Cl" resolves; "CL" and "cl" do not. */
export function elementBySymbol(symbol: string): ElementInfo | undefined {
  return BY_SYMBOL.get(symbol);
}

export function elementByZ(z: number): ElementInfo | undefined {
  return BY_Z.get(z);
}

export function elementByName(name: string): ElementInfo | undefined {
  return BY_LOWER_NAME.get(name.toLowerCase());
}

/**
 * The `element` of every query and generic atom (decision 238): R1, X, Ar,
 * "any atom", an element list. Not an element, and deliberately NOT in
 * `ELEMENTS` or any lookup a user's typing reaches, so the periodic table
 * never offers it and "*" never normalises to an element.
 *
 * `requireElement` still answers for it, because every chemistry query walks
 * every atom through that function, and a placeholder has an honest answer
 * to each of them: no valence list (so no implicit hydrogens and never
 * over-valent), atomic number 0 (RDKit's dummy atom), and NO MASS — `weight`
 * is NaN rather than 0, so a sum that forgot to check for a placeholder
 * prints NaN instead of a plausible wrong number, and `monoisotopic` is
 * undefined so `exactMass()` refuses exactly as it does for an element with
 * no verified value.
 */
export const QUERY_ELEMENT: ElementSymbol = "*";

const QUERY_ELEMENT_INFO: ElementInfo = Object.freeze({
  z: 0,
  symbol: QUERY_ELEMENT,
  name: "Generic atom",
  group: 0,
  period: 0,
  category: "nonmetal",
  weight: Number.NaN,
  monoisotopic: undefined,
  valences: Object.freeze([]) as readonly number[],
  color: "#909090",
});

/** Throwing variant, for call sites where an unknown symbol is a bug. */
export function requireElement(symbol: string): ElementInfo {
  if (symbol === QUERY_ELEMENT) return QUERY_ELEMENT_INFO;
  const el = BY_SYMBOL.get(symbol);
  if (!el) throw new Error(`Unknown element symbol: "${symbol}"`);
  return el;
}

export function isKnownElement(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

/**
 * Normalise loose user input to a canonical symbol: "cl", "CL", "chlorine"
 * all become "Cl". Returns undefined if nothing matches.
 */
export function normalizeElementInput(input: string): ElementSymbol | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  if (BY_SYMBOL.has(trimmed)) return trimmed;
  const titled = trimmed[0]!.toUpperCase() + trimmed.slice(1).toLowerCase();
  if (BY_SYMBOL.has(titled)) return titled;
  return BY_LOWER_NAME.get(trimmed.toLowerCase())?.symbol;
}

/**
 * Elements a structure editor should offer up front. Ordered by how often an
 * organic chemist reaches for them, not by atomic number.
 */
export const COMMON_ORGANIC_ELEMENTS: readonly ElementSymbol[] = Object.freeze([
  "C",
  "H",
  "O",
  "N",
  "S",
  "P",
  "F",
  "Cl",
  "Br",
  "I",
  "B",
  "Si",
  "Se",
]);

/**
 * The isotope labels a figure actually uses, as mass numbers, per element of
 * the organic set.
 *
 * CURATED, NOT EXHAUSTIVE. Carbon has fifteen known isotopes and a structure
 * editor that offered them all would bury ¹³C among ⁸C and ²²C. What is here
 * is what turns up in schemes: the NMR and mechanistic labels (²H, ¹³C, ¹⁵N,
 * ¹⁷O, ¹⁸O, ²⁹Si, ⁷⁷Se), the PET and radiotracer ones (¹¹C, ¹³N, ¹⁵O, ¹⁸F,
 * ⁷⁶Br, ¹²³I, ¹²⁴I, ¹²⁵I, ¹³¹I, ³H, ¹⁴C, ³²P, ³³P, ³⁵S), and both halves of the
 * near-even natural pairs a mass spectrum is annotated with (³⁵Cl/³⁷Cl,
 * ⁷⁹Br/⁸¹Br, ¹⁰B/¹¹B). The most abundant isotope of an element with no such
 * pair is left out: writing ¹²C on a carbon says nothing the bare symbol
 * does not. Any other mass number is still one field away in the properties
 * panel; this list only decides what is offered without typing.
 *
 * Ascending, so a menu reads lightest first. An element outside the table
 * gets the empty list rather than an error — "no curated labels" is an
 * ordinary answer for platinum.
 */
const LABELLING_ISOTOPES: Readonly<Record<ElementSymbol, readonly number[]>> =
  Object.freeze({
    H: Object.freeze([2, 3]),
    B: Object.freeze([10, 11]),
    C: Object.freeze([11, 13, 14]),
    N: Object.freeze([13, 15]),
    O: Object.freeze([15, 17, 18]),
    F: Object.freeze([18]),
    Si: Object.freeze([29, 30]),
    P: Object.freeze([32, 33]),
    S: Object.freeze([33, 34, 35]),
    Cl: Object.freeze([35, 36, 37]),
    Se: Object.freeze([75, 77]),
    Br: Object.freeze([76, 79, 81]),
    I: Object.freeze([123, 124, 125, 131]),
  });

export function labellingIsotopes(symbol: ElementSymbol): readonly number[] {
  return Object.hasOwn(LABELLING_ISOTOPES, symbol) ? LABELLING_ISOTOPES[symbol]! : [];
}

/**
 * Carbon is drawn as a bare vertex in skeletal mode; everything else gets a
 * label. Hydrogen is handled separately since it is usually implicit.
 */
export function isCarbon(symbol: ElementSymbol): boolean {
  return symbol === "C";
}

export function isHydrogen(symbol: ElementSymbol): boolean {
  return symbol === "H";
}
