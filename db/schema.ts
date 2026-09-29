import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dailyFuturesPositions = sqliteTable("daily_futures_positions", {
  date: text("date").primaryKey(),
  txNetOpenInterest: integer("tx_net_open_interest").notNull(),
  mtxNetOpenInterest: integer("mtx_net_open_interest").notNull(),
  tmfNetOpenInterest: integer("tmf_net_open_interest").notNull(),
  nightEquivalentNet: integer("night_equivalent_net").notNull(),
  collectedAt: text("collected_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const nightlyFuturesPositions = sqliteTable("nightly_futures_positions", {
  date: text("date").primaryKey(),
  txNightNet: integer("tx_night_net").notNull(),
  mtxNightNet: integer("mtx_night_net").notNull(),
  tmfNightNet: integer("tmf_night_net").notNull(),
  collectedAt: text("collected_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 平日下午排程的完成紀錄（證交所已取得、今日已推播），只記完成時間，不存任何數值。 */
export const dailyScheduleJobs = sqliteTable(
  "daily_schedule_jobs",
  {
    date: text("date").notNull(),
    job: text("job").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.date, table.job] })],
);
