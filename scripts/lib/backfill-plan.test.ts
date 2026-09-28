import { describe, it, expect } from 'vitest';
import { planHistorySeasons } from './backfill-plan';

describe('planHistorySeasons', () => {
  it('starts just below the earliest loaded season and walks back to the stop season', () => {
    expect(planHistorySeasons(2022, 2010)).toEqual([2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010]);
  });
  it('resumes below the last clean season', () => {
    expect(planHistorySeasons(2010, 1996)[0]).toBe(2009);
    expect(planHistorySeasons(2010, 1996).at(-1)).toBe(1996);
  });
  it('never goes past 1996-97', () => {
    expect(planHistorySeasons(1998, 1980)).toEqual([1997, 1996]);
  });
  it('is empty when done', () => {
    expect(planHistorySeasons(1996, 1996)).toEqual([]);
    expect(planHistorySeasons(2010, 2010)).toEqual([]);
  });
});
