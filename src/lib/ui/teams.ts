// Static team display names (constants, not data).

export const TEAMS: Record<string, { city: string; name: string }> = {
  ATL: { city: 'Atlanta', name: 'Hawks' },
  BKN: { city: 'Brooklyn', name: 'Nets' },
  BOS: { city: 'Boston', name: 'Celtics' },
  CHA: { city: 'Charlotte', name: 'Hornets' },
  CHI: { city: 'Chicago', name: 'Bulls' },
  CLE: { city: 'Cleveland', name: 'Cavaliers' },
  DAL: { city: 'Dallas', name: 'Mavericks' },
  DEN: { city: 'Denver', name: 'Nuggets' },
  DET: { city: 'Detroit', name: 'Pistons' },
  GSW: { city: 'Golden State', name: 'Warriors' },
  HOU: { city: 'Houston', name: 'Rockets' },
  IND: { city: 'Indiana', name: 'Pacers' },
  LAC: { city: 'LA', name: 'Clippers' },
  LAL: { city: 'Los Angeles', name: 'Lakers' },
  MEM: { city: 'Memphis', name: 'Grizzlies' },
  MIA: { city: 'Miami', name: 'Heat' },
  MIL: { city: 'Milwaukee', name: 'Bucks' },
  MIN: { city: 'Minnesota', name: 'Timberwolves' },
  NOP: { city: 'New Orleans', name: 'Pelicans' },
  NYK: { city: 'New York', name: 'Knicks' },
  OKC: { city: 'Oklahoma City', name: 'Thunder' },
  ORL: { city: 'Orlando', name: 'Magic' },
  PHI: { city: 'Philadelphia', name: '76ers' },
  PHX: { city: 'Phoenix', name: 'Suns' },
  POR: { city: 'Portland', name: 'Trail Blazers' },
  SAC: { city: 'Sacramento', name: 'Kings' },
  SAS: { city: 'San Antonio', name: 'Spurs' },
  TOR: { city: 'Toronto', name: 'Raptors' },
  UTA: { city: 'Utah', name: 'Jazz' },
  WAS: { city: 'Washington', name: 'Wizards' },
}

export function teamName(abbr: string | null | undefined): string {
  if (!abbr) return 'TBD'
  return TEAMS[abbr.toUpperCase()]?.name ?? abbr
}

export function teamCity(abbr: string | null | undefined): string {
  if (!abbr) return ''
  return TEAMS[abbr.toUpperCase()]?.city ?? ''
}
