import { describe, expect, it } from 'vitest';
import { linkTargets, plainText, readTable, section, tableRows } from './wikitext.js';

const PAGE = [
  'Intro.',
  '==Transactions==',
  '===Trades===',
  'trade body',
  '====Notes====',
  'note body',
  '===Free agents===',
  'fa body',
  '==Roster==',
  'roster body',
].join('\n');

describe('section', () => {
  it('returns the body of a heading at any level, up to the next heading of the same or higher level', () => {
    expect(section(PAGE, 'Trades')).toBe('trade body\n====Notes====\nnote body');
    expect(section(PAGE, 'Notes')).toBe('note body');
    expect(section(PAGE, 'Transactions')).toContain('fa body');
    expect(section(PAGE, 'Transactions')).not.toContain('roster body');
    expect(section(PAGE, 'Roster')).toBe('roster body');
  });

  it('matches headings with extra spaces and returns null when missing', () => {
    expect(section('== Trades ==\nx\n', 'Trades')).toBe('x');
    expect(section(PAGE, 'Draft picks')).toBeNull();
  });
});

describe('tableRows', () => {
  it('reads cells with attributes, inline || cells, continuation lines and header cells', () => {
    const t = [
      '{| class="wikitable"',
      '! No. !! Name',
      '|-',
      "| style=\"width:12%\" | '''32''' || [[Bill Walton]]",
      '|-',
      '| To [[Utah Jazz]]<hr>',
      '* [[Kevin Love]]',
      '|}',
    ].join('\n');
    expect(tableRows(t)).toEqual([
      ['No.', 'Name'],
      ["'''32'''", '[[Bill Walton]]'],
      ['To [[Utah Jazz]]<hr>\n* [[Kevin Love]]'],
    ]);
  });

  it('copies a rowspan cell into the rows below it and skips empty rows', () => {
    const t = [
      '{|',
      '|- bgcolor="eeeeee"',
      '| style="width:12%" rowspan=2 | July 6, 2017',
      '| A',
      '| B',
      '|-',
      '|- bgcolor="eeeeee"',
      '| colspan="3" | C',
      '|-',
      '| July 7, 2017',
      '| D',
      '|}',
    ].join('\n');
    expect(tableRows(t)).toEqual([
      ['July 6, 2017', 'A', 'B'],
      ['July 6, 2017', 'C'],
      ['July 7, 2017', 'D'],
    ]);
  });

  it('keeps a spanned cell in its column after a colspan cell', () => {
    const t = [
      '{|',
      '|-',
      '! rowspan=3 | July 7, 2025',
      "| colspan=2 | ''Three-team trade''",
      '| rowspan=3 | ref',
      '|-',
      '| A',
      '| B',
      '|-',
      '| colspan=2 | C',
      '|}',
    ].join('\n');
    expect(tableRows(t)).toEqual([
      ['July 7, 2025', "''Three-team trade''", 'ref'],
      ['July 7, 2025', 'A', 'B', 'ref'],
      ['July 7, 2025', 'C', 'ref'],
    ]);
  });
});

describe('readTable', () => {
  it("keeps each cell's attribute text", () => {
    const [row] = readTable(['{|', '|-', '| 17–65 || style="background:#ff9" | .127 || .119', '|}'].join('\n'));
    expect(row.map((c) => [c.attrs, c.text])).toEqual([['', '17–65'], ['style="background:#ff9"', '.127'], ['', '.119']]);
  });
});

describe('linkTargets', () => {
  it('returns each link target and label', () => {
    expect(linkTargets("To '''[[Denver Nuggets|Denver]]'''<hr>[[Danilo Gallinari]] (from Denver)")).toEqual([
      { target: 'Denver Nuggets', label: 'Denver' },
      { target: 'Danilo Gallinari', label: 'Danilo Gallinari' },
    ]);
    expect(linkTargets('[[ Philadelphia 76ers]]')).toEqual([{ target: 'Philadelphia 76ers', label: 'Philadelphia 76ers' }]);
  });
});

describe('plainText', () => {
  it('drops refs, templates and markup, keeping link labels', () => {
    expect(plainText("June 28, [[2017–18 NBA season|2017]]<ref>{{cite web|title=x}}</ref>")).toBe('June 28, 2017');
    expect(plainText("'''[[Blake Griffin]]'''&nbsp;– 2011{{efn|note}}")).toBe('Blake Griffin – 2011');
  });
});
