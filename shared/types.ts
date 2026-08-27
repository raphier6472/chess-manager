export type MatchResult = "white" | "black" | "draw" | "bye" | "unplayed";

export type TournamentStatus = "setup" | "active" | "completed";

export type RoundStatus = "pending" | "paired" | "completed";

export interface Tournament {
  id: string;
  name: string;
  date: string;
  numRounds: number;
  status: TournamentStatus;
  /** Fecha ISO en que se envió a la papelera; null si está activo. */
  deletedAt: string | null;
}

export interface Player {
  id: string;
  tournamentId: string;
  lastName: string;
  firstName: string;
  rating: number | null;
  withdrawn: boolean;
}

/** Natural reading order ("Nombre Apellido") for display. Pairing and
 * standings sort surname-first instead — see generateInitialPairings. */
export function formatPlayerName(person: { lastName: string; firstName: string }): string {
  return person.firstName ? `${person.firstName} ${person.lastName}` : person.lastName;
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
