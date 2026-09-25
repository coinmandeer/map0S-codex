/** Classification is a mapOS interpretation of a dated expert score, not an electoral fact. */
export type PoliticalBloc = "left" | "centre" | "right";
export interface PartyClassification {
  partyId: string;
  lrgen: number;
  validFrom: string;
  validTo: string;
  sourceUrl: string;
  coalition?: boolean;
}
export interface PartyVotes {
  partyId: string;
  votes: number;
  coalition?: boolean;
}
export interface ElectionResult {
  type: "national-parliament" | "european-parliament";
  date: string;
  territory: string;
  electorate: number;
  ballots: number;
  validVotes: number;
  parties: PartyVotes[];
}
export function validateElection(result: ElectionResult): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result.date) ||
    new Date(result.date).toISOString().slice(0, 10) !== result.date
  )
    throw Error("An exact election date is required");
  const counts = [
    result.electorate,
    result.ballots,
    result.validVotes,
    ...result.parties.map((p) => p.votes)
  ];
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw Error("Votes and electorate must be nonnegative integer counts");
  if (result.validVotes > result.ballots || result.ballots > result.electorate)
    throw Error("Inconsistent electorate or ballot totals");
  if (new Set(result.parties.map((p) => p.partyId)).size !== result.parties.length)
    throw Error("Duplicate party");
  if (result.parties.reduce((sum, p) => sum + p.votes, 0) !== result.validVotes)
    throw Error("Party votes do not sum to valid votes");
}
export function classifyElection(
  result: ElectionResult,
  classifications: readonly PartyClassification[]
) {
  validateElection(result);
  const totals: Record<PoliticalBloc, number> = { left: 0, centre: 0, right: 0 };
  let unclassified = 0;
  const used: PartyClassification[] = [];
  for (const party of result.parties) {
    const matches = classifications.filter(
      (c) => c.partyId === party.partyId && c.validFrom <= result.date && c.validTo >= result.date
    );
    const c = matches.length === 1 ? matches[0] : undefined;
    if (
      !c ||
      !Number.isFinite(c.lrgen) ||
      c.lrgen < 0 ||
      c.lrgen > 10 ||
      !c.sourceUrl ||
      (party.coalition && !c.coalition)
    ) {
      unclassified += party.votes;
      continue;
    }
    const bloc: PoliticalBloc = c.lrgen < 4 ? "left" : c.lrgen > 6 ? "right" : "centre";
    totals[bloc] += party.votes;
    used.push(c);
  }
  const sorted = (Object.entries(totals) as [PoliticalBloc, number][]).sort((a, b) => b[1] - a[1]);
  const top = sorted[0]!,
    runner = sorted[1]!;
  const winner =
    top[1] === 0
      ? "unclassified"
      : unclassified > 0 && top[1] <= runner[1] + unclassified
        ? "uncertain"
        : top[1] === runner[1]
          ? "tie"
          : top[0];
  return {
    winner,
    totals,
    unclassified,
    turnout: result.electorate ? (result.ballots / result.electorate) * 100 : null,
    classifications: used
  };
}
/** A national year cursor means the last election at or before 31 December, by election type. */
export function electionAtYear(
  results: readonly ElectionResult[],
  type: ElectionResult["type"],
  territory: string,
  year: number
) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw Error("Invalid election year");
  return (
    results
      .filter((r) => r.type === type && r.territory === territory && r.date <= `${year}-12-31`)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}
