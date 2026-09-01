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
  /** Liga a la que suma este torneo (campeonato anual), null si no suma a ninguna. */
  leagueId: string | null;
  /** Nombre de la liga, para mostrar sin pedir la lista de ligas aparte. */
  leagueName: string | null;
}

export interface Player {
  id: string;
  tournamentId: string;
  lastName: string;
  firstName: string;
  rating: number | null;
  withdrawn: boolean;
  /** Identidad compartida entre torneos, para sumar puntos de la misma persona. */
  rosterPlayerId: string;
}

/** Persona del padrón, independiente de en qué torneos haya jugado. */
export interface RosterPlayer {
  id: string;
  lastName: string;
  firstName: string;
}

/** Agrupa varios torneos bajo un nombre propio para sumar puntaje (campeonato anual). */
export interface League {
  id: string;
  name: string;
}

/** Liga para la lista de archivo (/campeonato), con cuántos torneos tiene. */
export interface LeagueSummary extends League {
  tournamentCount: number;
}

/** Un torneo de la liga, tal como aparece en el dashboard del campeonato. */
export interface ChampionshipTournamentSummary {
  id: string;
  name: string;
  date: string;
  numRounds: number;
  status: TournamentStatus;
}

export interface ChampionshipRow {
  rosterPlayerId: string;
  name: string;
  /** tournamentId -> puntaje en ese torneo; sin esa clave = no jugó ese torneo. */
  scores: Record<string, number>;
  totalScore: number;
  tournamentsPlayed: number;
  firstPlaceFinishes: number;
}

/** Todo lo que necesita el dashboard de una liga: sus torneos (columnas) y la tabla. */
export interface ChampionshipBoard {
  leagueId: string;
  leagueName: string;
  tournaments: ChampionshipTournamentSummary[];
  rows: ChampionshipRow[];
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
  /** true cuando el resultado se cargó por incomparecencia (W.O.), no por partida jugada. */
  forfeit: boolean;
}

export interface StandingsRow {
  playerId: string;
  name: string;
  score: number;
  buchholz: number;
  sonnebornBerger: number;
}
