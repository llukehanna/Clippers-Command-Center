// scripts/lib/history/team-eras.ts
// Franchise name/city/abbreviation by season, from 1970 on (or the franchise's
// NBA debut if later). Eras follow NBA.com franchise history, so a franchise id
// carries its relocations and renames (e.g. 1988-2001 Hornets belong to the
// Charlotte franchise; New Orleans starts in 2002).
//
// seasonId = season start year (1977 = 1977-78). firstSeason and lastSeason are
// both inclusive; lastSeason null = the current era.

export interface TeamEra {
  franchiseTricode: string; // current tricode, the key into NBA_TEAM_IDS
  firstSeason: number;
  lastSeason: number | null;
  abbreviation: string; // tricode used in that era
  city: string;
  name: string;
}

const e = (
  franchiseTricode: string,
  firstSeason: number,
  lastSeason: number | null,
  abbreviation: string,
  city: string,
  name: string,
): TeamEra => ({ franchiseTricode, firstSeason, lastSeason, abbreviation, city, name });

export const TEAM_ERAS: TeamEra[] = [
  e('ATL', 1970, null, 'ATL', 'Atlanta', 'Hawks'),
  e('BOS', 1970, null, 'BOS', 'Boston', 'Celtics'),
  e('BKN', 1976, 1976, 'NYN', 'New York', 'Nets'),
  e('BKN', 1977, 2011, 'NJN', 'New Jersey', 'Nets'),
  e('BKN', 2012, null, 'BKN', 'Brooklyn', 'Nets'),
  e('CHA', 1988, 2001, 'CHH', 'Charlotte', 'Hornets'),
  // 2002-2003: no Charlotte team (Hornets moved to New Orleans, Bobcats not yet playing).
  e('CHA', 2004, 2013, 'CHA', 'Charlotte', 'Bobcats'),
  e('CHA', 2014, null, 'CHA', 'Charlotte', 'Hornets'),
  e('CHI', 1970, null, 'CHI', 'Chicago', 'Bulls'),
  e('CLE', 1970, null, 'CLE', 'Cleveland', 'Cavaliers'),
  e('DAL', 1980, null, 'DAL', 'Dallas', 'Mavericks'),
  e('DEN', 1976, null, 'DEN', 'Denver', 'Nuggets'),
  e('DET', 1970, null, 'DET', 'Detroit', 'Pistons'),
  e('GSW', 1970, 1970, 'SFW', 'San Francisco', 'Warriors'),
  e('GSW', 1971, null, 'GSW', 'Golden State', 'Warriors'),
  e('HOU', 1970, 1970, 'SDR', 'San Diego', 'Rockets'),
  e('HOU', 1971, null, 'HOU', 'Houston', 'Rockets'),
  e('IND', 1976, null, 'IND', 'Indiana', 'Pacers'),
  e('LAC', 1970, 1977, 'BUF', 'Buffalo', 'Braves'),
  e('LAC', 1978, 1983, 'SDC', 'San Diego', 'Clippers'),
  e('LAC', 1984, null, 'LAC', 'Los Angeles', 'Clippers'),
  e('LAL', 1970, null, 'LAL', 'Los Angeles', 'Lakers'),
  e('MEM', 1995, 2000, 'VAN', 'Vancouver', 'Grizzlies'),
  e('MEM', 2001, null, 'MEM', 'Memphis', 'Grizzlies'),
  e('MIA', 1988, null, 'MIA', 'Miami', 'Heat'),
  e('MIL', 1970, null, 'MIL', 'Milwaukee', 'Bucks'),
  e('MIN', 1989, null, 'MIN', 'Minnesota', 'Timberwolves'),
  e('NOP', 2002, 2004, 'NOH', 'New Orleans', 'Hornets'),
  e('NOP', 2005, 2006, 'NOK', 'New Orleans/Oklahoma City', 'Hornets'),
  e('NOP', 2007, 2012, 'NOH', 'New Orleans', 'Hornets'),
  e('NOP', 2013, null, 'NOP', 'New Orleans', 'Pelicans'),
  e('NYK', 1970, null, 'NYK', 'New York', 'Knicks'),
  e('OKC', 1970, 2007, 'SEA', 'Seattle', 'SuperSonics'),
  e('OKC', 2008, null, 'OKC', 'Oklahoma City', 'Thunder'),
  e('ORL', 1989, null, 'ORL', 'Orlando', 'Magic'),
  e('PHI', 1970, null, 'PHI', 'Philadelphia', '76ers'),
  e('PHX', 1970, null, 'PHX', 'Phoenix', 'Suns'),
  e('POR', 1970, null, 'POR', 'Portland', 'Trail Blazers'),
  e('SAC', 1970, 1971, 'CIN', 'Cincinnati', 'Royals'),
  e('SAC', 1972, 1974, 'KCO', 'Kansas City-Omaha', 'Kings'),
  e('SAC', 1975, 1984, 'KCK', 'Kansas City', 'Kings'),
  e('SAC', 1985, null, 'SAC', 'Sacramento', 'Kings'),
  e('SAS', 1976, null, 'SAS', 'San Antonio', 'Spurs'),
  e('TOR', 1995, null, 'TOR', 'Toronto', 'Raptors'),
  e('UTA', 1974, 1978, 'NOJ', 'New Orleans', 'Jazz'),
  e('UTA', 1979, null, 'UTA', 'Utah', 'Jazz'),
  e('WAS', 1970, 1972, 'BAL', 'Baltimore', 'Bullets'),
  e('WAS', 1973, 1973, 'CAP', 'Capital', 'Bullets'),
  e('WAS', 1974, 1996, 'WSB', 'Washington', 'Bullets'),
  e('WAS', 1997, null, 'WAS', 'Washington', 'Wizards'),
];

/** The era a franchise was in during a season, or null (unknown franchise, not yet founded, or dormant). */
export function resolveEra(franchiseTricode: string, seasonId: number): TeamEra | null {
  return (
    TEAM_ERAS.find(
      (era) =>
        era.franchiseTricode === franchiseTricode &&
        era.firstSeason <= seasonId &&
        (era.lastSeason === null || seasonId <= era.lastSeason),
    ) ?? null
  );
}

/** First season of the franchise's earliest era (Infinity for an unknown franchise). */
export function franchiseStartSeason(franchiseTricode: string): number {
  return Math.min(
    ...TEAM_ERAS.filter((era) => era.franchiseTricode === franchiseTricode).map((era) => era.firstSeason),
  );
}
