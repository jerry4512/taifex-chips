import { latestTwseInstitutionalFlows, listFuturesPositions } from "./futures-db";
import type { ChipReportInput } from "./telegram";

/** 現貨與期貨都讀資料庫裡最新一天；任一來源掛掉不應該擋住整份報告，缺的段落由 buildChipReport 標成「尚無資料」。 */
export async function collectReportInput(): Promise<ChipReportInput> {
  const [spot, futures] = await Promise.all([
    latestTwseInstitutionalFlows().then(
      (report) => report && { date: report.date, flows: report.data },
      () => null,
    ),
    listFuturesPositions().then((rows) => rows.at(-1) ?? null, () => null),
  ]);

  return {
    spot,
    futures: futures && {
      date: futures.date,
      pureDayChange: futures.pureDayChange,
      interpretation: futures.interpretation,
    },
  };
}
