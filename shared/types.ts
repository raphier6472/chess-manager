export type MatchResult = "white" | "black" | "draw" | "bye" | "unplayed";

export type TournamentStatus = "setup" | "active" | "completed";

export type RoundStatus = "pending" | "paired" | "completed";

export interface Tournament {
  id: string;
  name: string;
  date: string;
  numRounds: number;
  status: TournamentStatus;
}

export interface Player {
  id: string;
  tournamentId: string;
  name: string;
  rating: number | null;
  withdrawn: boolean;
}

export interface Round {
  id: string;
  tournamentId: string;
  number: number;
  status: RoundStatus;
}

export interface Match {
  id: string;
  roundId: string;
  whiteId: string;
  blackId: string | null;
  result: MatchResult;
}

export interface StandingsRow {
  playerId: string;
  name: string;
  score: number;
  buchholz: number;
  sonnebornBerger: number;
}
