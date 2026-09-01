import type {
  ChampionshipStandingsRow,
  League,
  Match,
  Player,
  Round,
  RosterPlayer,
  StandingsRow,
  Tournament,
} from "../types";

export interface RoundWithMatches extends Round {
  matches: Match[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore, keep statusText
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listTournaments: () => request<Tournament[]>("/tournaments"),
  createTournament: (input: { name: string; date: string; numRounds: number; leagueId?: string }) =>
    request<Tournament>("/tournaments", { method: "POST", body: JSON.stringify(input) }),
  getTournament: (id: string) => request<Tournament>(`/tournaments/${id}`),
  updateTournament: (id: string, patch: { leagueId: string | null }) =>
    request<Tournament>(`/tournaments/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTournament: (id: string) => request<void>(`/tournaments/${id}`, { method: "DELETE" }),
  listPapelera: () => request<Tournament[]>("/tournaments-papelera"),
  restoreTournament: (id: string) =>
    request<Tournament>(`/tournaments/${id}/restaurar`, { method: "POST" }),
  deleteTournamentForever: (id: string) =>
    request<void>(`/tournaments/${id}/definitivo`, { method: "DELETE" }),

  listPlayers: (tournamentId: string) => request<Player[]>(`/tournaments/${tournamentId}/players`),
  addPlayer: (
    tournamentId: string,
    input:
      | { lastName: string; firstName?: string; rating?: number | null }
      | { rosterPlayerId: string; rating?: number | null },
  ) =>
    request<Player>(`/tournaments/${tournamentId}/players`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  searchRoster: (q: string) => request<RosterPlayer[]>(`/roster?q=${encodeURIComponent(q)}`),
  updatePlayer: (
    id: string,
    patch: Partial<{ lastName: string; firstName: string; rating: number | null; withdrawn: boolean }>,
  ) => request<Player>(`/players/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePlayer: (id: string) => request<void>(`/players/${id}`, { method: "DELETE" }),

  listRounds: (tournamentId: string) =>
    request<RoundWithMatches[]>(`/tournaments/${tournamentId}/rounds`),
  generateRound: (tournamentId: string, byePlayerIds: string[] = []) =>
    request<RoundWithMatches>(`/tournaments/${tournamentId}/rounds/generate`, {
      method: "POST",
      body: JSON.stringify({ byePlayerIds }),
    }),
  submitResult: (matchId: string, result: "white" | "black" | "draw", forfeit = false) =>
    request<Match>(`/matches/${matchId}/result`, {
      method: "POST",
      body: JSON.stringify({ result, forfeit }),
    }),
  completeRound: (roundId: string) => request<Round>(`/rounds/${roundId}/complete`, { method: "POST" }),
  reopenRound: (roundId: string) => request<Round>(`/rounds/${roundId}/reopen`, { method: "POST" }),

  getStandings: (tournamentId: string) => request<StandingsRow[]>(`/tournaments/${tournamentId}/standings`),

  listLeagues: () => request<League[]>("/ligas"),
  listAllLeagues: () => request<League[]>("/leagues"),
  createLeague: (name: string) =>
    request<League>("/leagues", { method: "POST", body: JSON.stringify({ name }) }),
  listLeagueParticipants: (leagueId: string) =>
    request<RosterPlayer[]>(`/leagues/${leagueId}/participantes`),
  getChampionshipStandings: (leagueId: string) =>
    request<ChampionshipStandingsRow[]>(`/campeonato?leagueId=${encodeURIComponent(leagueId)}`),

  login: (password: string) =>
    request<{ authenticated: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ authenticated: boolean; organizerName: string | null }>("/auth/me"),
};
