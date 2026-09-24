import type { TaifexFuturesRow } from "./taifex";
import {
  equivalentTxContracts,
  interpretChipChange,
} from "./taifex";

interface StoredFuturesPosition {
  date: string;
  tx_net_open_interest: number;
  mtx_net_open_interest: number;
  tmf_net_open_interest: number;
  night_equivalent_net: number;
}

const initialRows: Array<StoredFuturesPosition & { collected_at: string }> = [
  {
    date: "2026-09-21",
    tx_net_open_interest: -74081,
    mtx_net_open_interest: 5667,
    tmf_net_open_interest: 13703,
    night_equivalent_net: -2192,
    collected_at: "2026-09-21T08:00:00.000Z",
  },
  {
    date: "2026-09-22",
    tx_net_open_interest: -75568,
    mtx_net_open_interest: 3156,
    tmf_net_open_interest: 2682,
    night_equivalent_net: 229,
    collected_at: "2026-09-22T08:00:00.000Z",
  },
  {
    date: "2026-09-23",
    tx_net_open_interest: -76084,
    mtx_net_open_interest: 2752,
    tmf_net_open_interest: 2821,
    night_equivalent_net: -53,
    collected_at: "2026-09-23T08:00:00.000Z",
  },
  {
    date: "2026-09-24",
    tx_net_open_interest: -77031,
    mtx_net_open_interest: -876,
    tmf_net_open_interest: -3273,
    night_equivalent_net: -2244,
    collected_at: "2026-09-24T08:00:00.000Z",
  },
];

async function initializeDatabase(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS daily_futures_positions (
        date text PRIMARY KEY NOT NULL,
        tx_net_open_interest integer NOT NULL,
        mtx_net_open_interest integer NOT NULL,
        tmf_net_open_interest integer NOT NULL,
        night_equivalent_net integer NOT NULL,
        collected_at text NOT NULL,
        updated_at text NOT NULL
      )`,
    )
    .run();

  await database.batch(
    initialRows.map((row) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO daily_futures_positions (
            date,
            tx_net_open_interest,
            mtx_net_open_interest,
            tmf_net_open_interest,
            night_equivalent_net,
            collected_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.date,
          row.tx_net_open_interest,
          row.mtx_net_open_interest,
          row.tmf_net_open_interest,
          row.night_equivalent_net,
          row.collected_at,
          row.collected_at,
        ),
    ),
  );

  return database;
}

export async function saveFuturesPosition(row: TaifexFuturesRow): Promise<void> {
  const database = await initializeDatabase();
  const now = new Date().toISOString();

  await database
    .prepare(
      `INSERT INTO daily_futures_positions (
        date,
        tx_net_open_interest,
        mtx_net_open_interest,
        tmf_net_open_interest,
        night_equivalent_net,
        collected_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        tx_net_open_interest = excluded.tx_net_open_interest,
        mtx_net_open_interest = excluded.mtx_net_open_interest,
        tmf_net_open_interest = excluded.tmf_net_open_interest,
        night_equivalent_net = excluded.night_equivalent_net,
        updated_at = excluded.updated_at`,
    )
    .bind(
      row.date,
      row.txNetOpenInterest,
      row.mtxNetOpenInterest,
      row.tmfNetOpenInterest,
      row.nightEquivalentNet ?? 0,
      now,
      now,
    )
    .run();
}

export async function listFuturesPositions(): Promise<TaifexFuturesRow[]> {
  const database = await initializeDatabase();
  const result = await database
    .prepare(
      `SELECT
        date,
        tx_net_open_interest,
        mtx_net_open_interest,
        tmf_net_open_interest,
        night_equivalent_net
      FROM daily_futures_positions
      ORDER BY date ASC`,
    )
    .all<StoredFuturesPosition>();

  let previousOfficialOi: number | null = null;
  return result.results.map((stored) => {
    const officialEquivalentNetOi = equivalentTxContracts({
      臺股期貨: stored.tx_net_open_interest,
      小型臺指期貨: stored.mtx_net_open_interest,
      微型臺指期貨: stored.tmf_net_open_interest,
    });
    const totalPositionChange =
      previousOfficialOi === null ? null : officialEquivalentNetOi - previousOfficialOi;
    const pureDayChange =
      totalPositionChange === null
        ? null
        : totalPositionChange - stored.night_equivalent_net;

    previousOfficialOi = officialEquivalentNetOi;
    return {
      date: stored.date,
      txNetOpenInterest: stored.tx_net_open_interest,
      mtxNetOpenInterest: stored.mtx_net_open_interest,
      tmfNetOpenInterest: stored.tmf_net_open_interest,
      officialEquivalentNetOi,
      totalPositionChange,
      nightEquivalentNet: stored.night_equivalent_net,
      pureDayChange,
      interpretation: pureDayChange === null ? null : interpretChipChange(pureDayChange),
    };
  });
}
