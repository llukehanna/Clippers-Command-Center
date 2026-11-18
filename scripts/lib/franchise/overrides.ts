// scripts/lib/franchise/overrides.ts
// Facts we've written ourselves, applied after parsing on every import and job run (spec §3.2 "Overrides";
// applyOverrides in apply-overrides.ts says what each kind does).
//
// Every entry needs `source`: a one-line note of where the fact comes from, e.g.
//   source: 'Wikipedia 1986 draft notes; checked RealGM manually'
// Keep it small. An entry that stops matching anything is reported as stale: delete it then.
//
// Examples of each kind (apply-overrides.ts says which phase applies each, and what it does):
//   { kind: 'pick', match: { draftYear: 1978, overall: 60 }, set: { originalFranchiseId: 1610612738 }, source: '…' }
//   { kind: 'pick', match: { moveKey: 'bbref:1984-…', partIndex: 1 }, set: { year: 1986, round: 1, originalFranchiseId: 1610612748 }, source: '…' }
//   { kind: 'pick', match: { pickKey: '2028-1-LAC' }, set: { protections: [{ year: 0, range: '1-3', then: null }], protectionsText: 'Top-3 protected' }, source: '…' }
//   { kind: 'pick', match: { pickKey: '2030-1-LAC' }, set: { status: 'forfeited' }, source: '…' }
//   { kind: 'move', match: { moveKey: 'bbref:1981-…' }, replaceParts: [{ from: …, to: …, kind: 'other', text: 'compensation not recorded' }], complete: false, source: '…' }
//   { kind: 'move', match: { source: 'LAC-1982_transactions', text: '<the unparsed line>' }, create: { kind: 'trade' }, replaceParts: [ … ], source: '…' }
//   { kind: 'move', match: { moveKey: 'wiki:1978–79 San Diego Clippers season#4' }, mergeInto: 'bbref:1978-10-12:…', source: '…' }
//   { kind: 'move', match: { moveKey: 'wiki:…' }, drop: true, reason: 'the same trade as bbref:…, listed twice', source: '…' }
//   { kind: 'person', match: { ref: 'World Free', scope: { seasonId: 1978 } }, personKey: 'freewo01', source: '…' }
//   { kind: 'ignore', match: { source: 'LAC-1999_transactions', text: '<the unparsed line>' }, reason: 'not a roster move', source: '…' }
//   { kind: 'teamName', match: { text: 'Kansas City Kings', seasonId: 1974 }, franchise: 1610612758, source: '…' }
import type { Override } from './types.js';

// NBA franchise ids used below.
const LAC = 1610612746, BOS = 1610612738, NYK = 1610612752, MIL = 1610612749, DET = 1610612765, IND = 1610612754;
const LAL = 1610612747;

export const OVERRIDES: Override[] = [
  // ---- unparsed lines (report.unparsed) ----
  { kind: 'ignore', match: { source: "1976–77 Buffalo Braves season", text: "August 5, 1976 | To Buffalo Braves * The 7th pick of 1976 ABA dispersal draft. (Bird Averitt of the Kentucky Colonels was chosen) | To Milwaukee Bucks * 1977 2nd round draft pick" }, reason: "the same trade as bbref:1976-08-05 (Bird Averitt for a 1977 second-round pick)", source: "BBRef BUF-1977 transactions" },
  {
    kind: 'move', match: { source: "BUF-1978_transactions", text: "Mike Glenn signed as a veteran free agent with the New York Knicks; received FROM_TRADE as compensation." }, create: { kind: 'signing' },
    replaceParts: [
      { from: LAC, to: NYK, kind: 'player', person: { bbrefId: "glennmi01", name: "Mike Glenn" } },
      { from: NYK, to: LAC, kind: 'other', text: 'an unrecorded asset' },
    ],
    complete: false, source: "BBRef: a veteran free agent signing that owed the Clippers compensation; the page does not say what it was (R10)",
  },
  {
    kind: 'move', match: { source: "SDC-1983_transactions", text: "Charlie Criss signed as a veteran free agent with the Milwaukee Bucks; received FROM_TRADE as compensation." }, create: { kind: 'signing' },
    replaceParts: [
      { from: LAC, to: MIL, kind: 'player', person: { bbrefId: "crissch01", name: "Charlie Criss" } },
      { from: MIL, to: LAC, kind: 'other', text: 'an unrecorded asset' },
    ],
    complete: false, source: "BBRef: a veteran free agent signing that owed the Clippers compensation; the page does not say what it was (R10)",
  },
  {
    kind: 'move', match: { source: "SDC-1983_transactions", text: "Armond Hill signed as a veteran free agent with the Milwaukee Bucks; received FROM_TRADE as compensation." }, create: { kind: 'signing' },
    replaceParts: [
      { from: LAC, to: MIL, kind: 'player', person: { bbrefId: "hillar01", name: "Armond Hill" } },
      { from: MIL, to: LAC, kind: 'other', text: 'an unrecorded asset' },
    ],
    complete: false, source: "BBRef: a veteran free agent signing that owed the Clippers compensation; the page does not say what it was (R10)",
  },
  {
    kind: 'move', match: { source: "SDC-1984_transactions", text: "Lionel Hollins signed as a veteran free agent with the Detroit Pistons; received FROM_TRADE as compensation." }, create: { kind: 'signing' },
    replaceParts: [
      { from: LAC, to: DET, kind: 'player', person: { bbrefId: "hollili01", name: "Lionel Hollins" } },
      { from: DET, to: LAC, kind: 'other', text: 'an unrecorded asset' },
    ],
    complete: false, source: "BBRef: a veteran free agent signing that owed the Clippers compensation; the page does not say what it was (R10)",
  },
  {
    kind: 'move', match: { source: "LAC-1985_transactions", text: "Greg Kelser signed as a veteran free agent with the Indiana Pacers; received FROM_TRADE as compensation." }, create: { kind: 'signing' },
    replaceParts: [
      { from: LAC, to: IND, kind: 'player', person: { bbrefId: "kelsegr01", name: "Greg Kelser" } },
      { from: IND, to: LAC, kind: 'other', text: 'an unrecorded asset' },
    ],
    complete: false, source: "BBRef: a veteran free agent signing that owed the Clippers compensation; the page does not say what it was (R10)",
  },
  {
    kind: 'move', match: { source: "LAC-1990_transactions", text: "Larry Drew signed as a veteran free agent with the Los Angeles Lakers; received FROM_TRADE as compensation." }, create: { kind: 'signing' },
    replaceParts: [
      { from: LAC, to: LAL, kind: 'player', person: { bbrefId: "drewla01", name: "Larry Drew" } },
      { from: LAL, to: LAC, kind: 'other', text: 'an unrecorded asset' },
    ],
    complete: false, source: "BBRef: a veteran free agent signing that owed the Clippers compensation; the page does not say what it was (R10)",
  },
  { kind: 'ignore', match: { source: "SDC-1981_transactions", text: "Signed Rock Lee as a free agent." }, reason: "BBRef gives no date (listed under \"Unknown Date\"), and a move needs one", source: "BBRef SDC-1981 transactions; Wikipedia 1981–82 season lists his later moves" },
  { kind: 'ignore', match: { source: "LAC-1994_transactions", text: "Signed Bob Martin as a free agent." }, reason: "BBRef gives no date, and a move needs one", source: "BBRef LAC-1994 transactions" },
  { kind: 'ignore', match: { source: "2001–02 Los Angeles Clippers season", text: "November 16, 2001 | To Los Angeles Clippers * Vinny Del Negro and cash considerations from the Phoenix Suns as part of a three-team trade with the Orlando Magic | To Orlando Magic * 2005 second-round draft pick" }, reason: "the same trade as bbref:2001-11-16 (three-team trade with Phoenix and Orlando)", source: "BBRef LAC-2002 transactions" },
  { kind: 'ignore', match: { source: "2004–05 Los Angeles Clippers season", text: "June 22, 2004 | To Los Angeles Clippers * 2004 first-round draft pick (4th pick) and 2004 second-round draft pick | To Charlotte Bobcats * 2004 first-round draft pick (2nd pick) and agreement to select Predrag Drobnjak in expansion draft." }, reason: "the same trade as bbref:2004-06-22 (picks with Charlotte; Drobnjak is the expansion-draft move)", source: "BBRef LAC-2004 and LAC-2005 transactions" },
  { kind: 'ignore', match: { source: "LAC-2013_transactions", text: "Traded a 2015 1st round draft pick (R.J. Hunter was later selected) to the Boston Celtics for Doc Rivers." }, reason: "the same trade as wiki:2013–14 Los Angeles Clippers season#1, which the move override below corrects", source: "BBRef LAC-2013 transactions" },
  { kind: 'ignore', match: { source: "LAC-2014_transactions", text: "Did not re-sign Sasha Vujačić; 10-day contract expires." }, reason: "a 10-day contract running out, not a roster move; the 10-day signing is recorded", source: "BBRef LAC-2014 transactions" },
  { kind: 'ignore', match: { source: "LAC-2027_transactions", text: "As part of a 5-team trade, the Los Angeles Clippers traded Ismael Kamagate to the Cleveland Cavaliers; the traded and to the ; the Charlotte Hornets traded Tre Mann to the Washington Wizards; the Cleveland Cavaliers traded cash and Dennis Schroder to the Charlotte Hornets; the Cleveland Cavaliers traded Max Strus to the Los Angeles Clippers; the Cleveland Cavaliers traded cash to the Washington Wizards; the Denver Nuggets traded Peyton Watson to the Cleveland Cavaliers; the Washington Wizards traded Cam Whitmore to the Cleveland Cavaliers; and the Washington Wizards traded Julian Reese to the Denver Nuggets. Denver received a trade exception Cleveland received a trade exception" }, reason: "the same trade as nba:Trade 2026012 (five-team trade, Max Strus)", source: "NBA.com player movement" },
  { kind: 'ignore', match: { source: "1974 NBA draft", text: "– | Aulcie Perry | C | Boston Celtics | Bethune–Cookman" }, reason: "a Boston pick listed without a round or number; not a Clippers pick", source: "Wikipedia 1974 NBA draft" },
  { kind: 'ignore', match: { source: "1974 NBA draft", text: "– | Tony Jenkins | F | Boston Celtics | Harvard" }, reason: "a Boston pick listed without a round or number; not a Clippers pick", source: "Wikipedia 1974 NBA draft" },
  { kind: 'ignore', match: { source: "1974 NBA draft", text: "– | Jerry Baskerville | F | Boston Celtics | Temple" }, reason: "a Boston pick listed without a round or number; not a Clippers pick", source: "Wikipedia 1974 NBA draft" },
  { kind: 'ignore', match: { source: "1974 NBA draft", text: "– | Fred Petty | C | Boston Celtics | New Hampshire College" }, reason: "a Boston pick listed without a round or number; not a Clippers pick", source: "Wikipedia 1974 NBA draft" },
  { kind: 'ignore', match: { source: "1983 NBA draft", text: "5 | 97 | Manute Bol | C | San Diego Clippers" }, reason: "the league voided this pick (Bol was ineligible), so no rights changed hands", source: "Wikipedia 1983 NBA draft" },
  { kind: 'ignore', match: { source: "1985 NBA draft", text: "4 | 77 | Arvydas Sabonis | C | Atlanta Hawks | Žalgiris Kaunas" }, reason: "an Atlanta pick the league voided; not a Clippers pick", source: "Wikipedia 1985 NBA draft" },
  { kind: 'ignore', match: { source: "1990 NBA draft", text: "1 | 15 | Dave Jamerson | SG | Miami Heat (from Denver; traded with Carl Herrera to Houston for the rights to Alec Kessler) | Ohio (Sr.)" }, reason: "a draft-day trade between Miami and Houston; not a Clippers pick", source: "Wikipedia 1990 NBA draft" },
  { kind: 'ignore', match: { source: "2000 NBA draft", text: "1 | 15 | Jason Collier | C | Milwaukee Bucks (traded with future first-round pick to Houston for Joel Przybilla) | Georgia Tech (Sr.)" }, reason: "a draft-day trade between Milwaukee and Houston; not a Clippers pick", source: "Wikipedia 2000 NBA draft" },
  { kind: 'ignore', match: { source: "2000 NBA draft", text: "1 | 22 | Donnell Harvey | SF | New York Knicks (traded with John Wallace to Dallas for Erick Strickland and Pete Mickeal) | Florida (Fr.)" }, reason: "a draft-day trade between New York and Dallas; not a Clippers pick", source: "Wikipedia 2000 NBA draft" },
  { kind: 'ignore', match: { source: "2000 NBA draft", text: "2 | 58 | Pete Mickeal | F | Dallas Mavericks (from L.A. Lakers, traded with Erick Strickland to New York for John Wallace and Donnell Harvey) | Cincinnati (Sr.)" }, reason: "a draft-day trade between Dallas and New York; not a Clippers pick", source: "Wikipedia 2000 NBA draft" },

  // ---- moves ----
  {
    kind: 'move', match: { moveKey: 'wiki:2013–14 Los Angeles Clippers season#1' },
    replaceParts: [
      { from: BOS, to: LAC, kind: 'other', person: { name: 'Doc Rivers' }, text: 'Head Coach', personKey: 'riverdo01' },
      { from: LAC, to: BOS, kind: 'pick', pick: { year: 2015, round: 1, originalFranchiseId: LAC, selected: { bbrefId: 'hunterj01', name: 'R.J. Hunter' } } },
    ],
    source: 'BBRef LAC-2013 transactions: the pick was the Clippers 2015 first (R.J. Hunter), not a 2013 pick',
  },

  // ---- future picks (report.futureWithoutProtections), checked 2026-11-17 ----
  { kind: 'pick', match: { pickKey: "2027-1-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2027-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2027-2-MEM" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2027-2-MIL" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2028-1-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "Unprotected when the Clippers sent it to Philadelphia (2023 Harden trade); later PHI/BOS swaps are between other teams. SalarySwish trade terms; RealGM" },
  { kind: 'pick', match: { pickKey: "2028-2-DAL" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2028-2-HOU" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2028-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2029-1-IND" }, set: { status: 'forfeited' }, source: "NBA penalty of 2026-09-02 (one Clippers first in each draft 2029-33; NBA.com release); RealGM future drafts names the picks" },
  { kind: 'pick', match: { pickKey: "2029-1-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2029-2-DET" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2029-2-HOU" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2029-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2029-2-LAL" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2030-1-GSW" }, set: { protectionsText: 'Top-20 protected', protections: [{ year: 0, range: '1-20', then: "Golden State's 2030 second-round pick" }] }, source: "RealGM future drafts (GSW 2030: 1-20 own, 21-30 conveys) and SalarySwish trade terms" },
  { kind: 'pick', match: { pickKey: "2030-1-LAC" }, set: { status: 'forfeited' }, source: "NBA penalty of 2026-09-02 (one Clippers first in each draft 2029-33; NBA.com release); RealGM future drafts names the picks" },
  { kind: 'pick', match: { pickKey: "2030-2-HOU" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2030-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2030-2-TOR" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2031-1-CLE" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2031-1-LAC" }, set: { status: 'forfeited' }, source: "NBA penalty of 2026-09-02 (one Clippers first in each draft 2029-33; NBA.com release); RealGM future drafts names the picks" },
  { kind: 'pick', match: { pickKey: "2031-1-TOR" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2031-2-DAL" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2031-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts: no conditions (one source)" },
  { kind: 'pick', match: { pickKey: "2032-1-LAC" }, set: { status: 'forfeited' }, source: "NBA penalty of 2026-09-02 (one Clippers first in each draft 2029-33; NBA.com release); RealGM future drafts names the picks" },
  { kind: 'pick', match: { pickKey: "2032-2-DET" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2032-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts: no conditions (one source)" },
  { kind: 'pick', match: { pickKey: "2032-2-SAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2032-2-TOR" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2033-1-LAC" }, set: { status: 'forfeited' }, source: "NBA penalty of 2026-09-02 (one Clippers first in each draft 2029-33; NBA.com release); RealGM future drafts names the picks" },
  { kind: 'pick', match: { pickKey: "2033-1-TOR" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2033-2-DAL" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2033-2-LAC" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts: no conditions (one source)" },
  { kind: 'pick', match: { pickKey: "2033-2-TOR" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM future drafts and SalarySwish trade terms: no conditions" },
  { kind: 'pick', match: { pickKey: "2033-2-WAS" }, set: { protectionsText: 'Unprotected', protections: [] }, source: "RealGM and SalarySwish disagree on who holds it now, not on conditions: unprotected in both" },

  // ---- draft rows the sources leave unkeyed (report.unkeyed): original owner, checked 2026-11-18 ----
  { kind: 'pick', match: { draftYear: 1971, overall: 19 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Fred Hilton)" },
  { kind: 'pick', match: { draftYear: 1976, overall: 82 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Connie White)" },
  { kind: 'pick', match: { draftYear: 1977, overall: 153 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Emery Sammons)" },
  { kind: 'pick', match: { draftYear: 1978, overall: 48 }, set: { originalFranchiseId: 1610612754 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Mike Santos)" },
  { kind: 'pick', match: { draftYear: 1978, overall: 51 }, set: { originalFranchiseId: 1610612765 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Ricky Gallon)" },
  { kind: 'pick', match: { draftYear: 1978, overall: 65 }, set: { originalFranchiseId: 1610612755 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Marvin Delph)" },
  { kind: 'pick', match: { draftYear: 1978, overall: 68 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Jim Boylan)" },
  { kind: 'pick', match: { draftYear: 1978, overall: 73 }, set: { originalFranchiseId: 1610612765 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Larry Harris)" },
  { kind: 'pick', match: { draftYear: 1980, overall: 53 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Stuart House)" },
  { kind: 'pick', match: { draftYear: 1981, overall: 62 }, set: { originalFranchiseId: 1610612741 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Sam Clancy)" },
  { kind: 'pick', match: { draftYear: 1982, overall: 25 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Bryan Warrick)" },
  { kind: 'pick', match: { draftYear: 1982, overall: 42 }, set: { originalFranchiseId: 1610612760 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Jeff Taylor)" },
  { kind: 'pick', match: { draftYear: 1982, overall: 48 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Craig Hodges)" },
  { kind: 'pick', match: { draftYear: 1983, overall: 28 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Rod Foster)" },
  { kind: 'pick', match: { draftYear: 1983, overall: 51 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Dereck Whittenburg)" },
  { kind: 'pick', match: { draftYear: 1983, overall: 74 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Kalpatrick Wells)" },
  { kind: 'pick', match: { draftYear: 1983, overall: 120 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Russell Todd)" },
  { kind: 'pick', match: { draftYear: 1984, overall: 52 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Terry Williams)" },
  { kind: 'pick', match: { draftYear: 1985, overall: 30 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Calvin Duncan)" },
  { kind: 'pick', match: { draftYear: 1986, overall: 46 }, set: { originalFranchiseId: 1610612747 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Jeff Hornacek)" },
  { kind: 'pick', match: { draftYear: 1987, overall: 46 }, set: { originalFranchiseId: 1610612747 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Bruce Dalrymple)" },
  { kind: 'pick', match: { draftYear: 1987, overall: 70 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Tom Sheehey)" },
  { kind: 'pick', match: { draftYear: 1988, overall: 26 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Rolando Ferreira)" },
  { kind: 'pick', match: { draftYear: 1988, overall: 45 }, set: { originalFranchiseId: 1610612757 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Tom Garrick)" },
  { kind: 'pick', match: { draftYear: 1989, overall: 33 }, set: { originalFranchiseId: 1610612758 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Jay Edwards)" },
  { kind: 'pick', match: { draftYear: 1989, overall: 43 }, set: { originalFranchiseId: 1610612745 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Chucky Brown)" },
  { kind: 'pick', match: { draftYear: 1993, overall: 40 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Rich Manning)" },
  { kind: 'pick', match: { draftYear: 1993, overall: 53 }, set: { originalFranchiseId: 1610612752 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Leonard White)" },
  { kind: 'pick', match: { draftYear: 1995, overall: 30 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Lou Roe)" },
  { kind: 'pick', match: { draftYear: 1995, overall: 53 }, set: { originalFranchiseId: 1610612752 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Constantin Popa)" },
  { kind: 'pick', match: { draftYear: 2015, overall: 46 }, set: { originalFranchiseId: 1610612749 }, source: "BBRef transactions name the traded pick and its selection; matches the draft-order slot (Norman Powell)" },
  { kind: 'pick', match: { draftYear: 2015, overall: 57 }, set: { originalFranchiseId: 1610612746 }, source: "BBRef Clippers transactions (own pick traded or used; no incoming trade) and the draft order (Nikola Radicevic)" },

  // ---- people NBA.com and BBRef both list but no players row ties together (import.unmergedSignings) ----
  { kind: 'person', match: { ref: "nba:1629806" }, personKey: "taylobj01", source: "NBA.com and BBRef list the same Clippers move for BJ Taylor on 2019-10-18" },
  { kind: 'person', match: { ref: "nba:1631258" }, personKey: "willibr04", source: "NBA.com and BBRef list the same Clippers move for Bryson Williams on 2022-10-15" },
  { kind: 'person', match: { ref: "nba:1643327" }, personKey: "willide08", source: "NBA.com and BBRef list the same Clippers move for DeAndre Williams on 2026-10-14" },
  { kind: 'person', match: { ref: "nba:1629184" }, personKey: "rodride01", source: "NBA.com and BBRef list the same Clippers move for Desi Rodriguez on 2018-10-10" },
  { kind: 'person', match: { ref: "nba:1643630" }, personKey: "loyerfl01", source: "NBA.com and BBRef list the same Clippers move for Fletcher Loyer on 2026-10-06, 2026-10-15" },
  { kind: 'person', match: { ref: "nba:1628994" }, personKey: "kingge03", source: "NBA.com and BBRef list the same Clippers move for George King on 2021-10-14" },
  { kind: 'person', match: { ref: "nba:1628528" }, personKey: "iroegik01", source: "NBA.com and BBRef list the same Clippers move for Ike Iroegbu on 2017-10-14" },
  { kind: 'person', match: { ref: "nba:1642481" }, personKey: "sharpja01", source: "NBA.com and BBRef list the same Clippers move for Jamarion Sharp on 2026-08-06, 2026-09-25" },
  { kind: 'person', match: { ref: "nba:1629615" }, personKey: "palmeja01", source: "NBA.com and BBRef list the same Clippers move for James Palmer Jr. on 2019-10-11" },
  { kind: 'person', match: { ref: "nba:1641792" }, personKey: "hausejo01", source: "NBA.com and BBRef list the same Clippers move for Joey Hauser on 2023-10-21" },
  { kind: 'person', match: { ref: "nba:1629167" }, personKey: "bibbsju01", source: "NBA.com and BBRef list the same Clippers move for Justin Bibbs on 2019-03-13, 2019-03-23" },
  { kind: 'person', match: { ref: "nba:1630811" }, personKey: "wallake01", source: "NBA.com and BBRef list the same Clippers move for Keaton Wallace on 2022-09-23, 2023-02-21, 2023-03-01" },
  { kind: 'person', match: { ref: "nba:1629645" }, personKey: "porteke02", source: "NBA.com and BBRef list the same Clippers move for Kevin Porter Jr. on 2024-07-10" },
  { kind: 'person', match: { ref: "nba:1628176" }, personKey: "hentola01", source: "NBA.com and BBRef list the same Clippers move for LaDontae Henton on 2017-10-09" },
  { kind: 'person', match: { ref: "nba:1631238" }, personKey: "devoemi01", source: "NBA.com and BBRef list the same Clippers move for Michael Devoe on 2022-10-04" },
  { kind: 'person', match: { ref: "nba:1641917" }, personKey: "funkta01", source: "NBA.com and BBRef list the same Clippers move for Taylor Funk on 2025-09-26" },
  { kind: 'person', match: { ref: "nba:1629097" }, personKey: "larrite01", source: "NBA.com and BBRef list the same Clippers move for Terry Larrier on 2019-10-11" },
  { kind: 'person', match: { ref: "nba:1643021" }, personKey: "freemza01", source: "NBA.com and BBRef list the same Clippers move for Zach Freemantle on 2025-09-25" },
];
