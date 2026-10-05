"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChipInterpretation,
  TaifexAfterHoursResponse,
  TaifexAfterHoursRow,
  TaifexFuturesResponse,
  TaifexFuturesRow,
} from "../lib/taifex";
import type {
  TwseBfi82uDay,
  TwseBfi82uListResponse,
  TwseInstitutionName,
} from "../lib/twse";
import type {
  TelegramStatusResponse,
  TelegramTestResponse,
} from "./api/trading-doctor/telegram-test/route";

const numberFormatter = new Intl.NumberFormat("zh-TW");
const hundredMillionFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const taipeiToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function formatNumber(value: number | null): string {
  return value === null ? "" : numberFormatter.format(value);
}

function formatDate(value: string): string {
  return value.replaceAll("-", "/");
}

function formatHundredMillion(value: number): string {
  return hundredMillionFormatter.format(value / 100_000_000);
}

function valueTone(value: number | null): string {
  if (value === null || value === 0) return "value-neutral";
  return value > 0 ? "value-positive" : "value-negative";
}

function interpretationTone(value: ChipInterpretation | null): string {
  if (value === "偏多") return "signal-positive";
  if (value === "偏空") return "signal-negative";
  return "signal-neutral";
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function EmptyCell({ firstRow = false }: { firstRow?: boolean }) {
  return (
    <span className="empty-value" aria-label={firstRow ? "首日無前日資料" : "無資料"}>
      {firstRow ? "—" : ""}
    </span>
  );
}

function DataRow({ row, isFirst }: { row: TaifexFuturesRow; isFirst: boolean }) {
  return (
    <tr>
      <th scope="row">{formatDate(row.date)}</th>
      <td className={valueTone(row.txNetOpenInterest)}>{formatNumber(row.txNetOpenInterest)}</td>
      <td className={valueTone(row.mtxNetOpenInterest)}>{formatNumber(row.mtxNetOpenInterest)}</td>
      <td className={valueTone(row.tmfNetOpenInterest)}>{formatNumber(row.tmfNetOpenInterest)}</td>
      <td className={valueTone(row.officialEquivalentNetOi)}>
        {formatNumber(row.officialEquivalentNetOi)}
      </td>
      <td className={valueTone(row.totalPositionChange)}>
        {row.totalPositionChange === null ? (
          <EmptyCell firstRow={isFirst} />
        ) : (
          formatNumber(row.totalPositionChange)
        )}
      </td>
      <td className={valueTone(row.pureDayChange)}>
        {row.pureDayChange === null ? (
          <EmptyCell firstRow={isFirst} />
        ) : (
          formatNumber(row.pureDayChange)
        )}
      </td>
      <td>
        {row.interpretation === null ? (
          <EmptyCell firstRow={isFirst} />
        ) : (
          <span className={`signal ${interpretationTone(row.interpretation)}`}>
            {row.interpretation}
          </span>
        )}
      </td>
    </tr>
  );
}

function AfterHoursDataRow({
  row,
  isFirst,
}: {
  row: TaifexAfterHoursRow;
  isFirst: boolean;
}) {
  return (
    <tr>
      <th scope="row">{formatDate(row.date)}</th>
      <td className={valueTone(row.txNightNet)}>{formatNumber(row.txNightNet)}</td>
      <td className={valueTone(row.mtxNightNet)}>{formatNumber(row.mtxNightNet)}</td>
      <td className={valueTone(row.tmfNightNet)}>{formatNumber(row.tmfNightNet)}</td>
      <td className={valueTone(row.nightEquivalentNet)}>
        {formatNumber(row.nightEquivalentNet)}
      </td>
      <td className={valueTone(row.previousOfficialEquivalentNetOi)}>
        {row.previousOfficialEquivalentNetOi === null ? (
          <EmptyCell firstRow={isFirst} />
        ) : (
          formatNumber(row.previousOfficialEquivalentNetOi)
        )}
      </td>
      <td className={valueTone(row.estimatedOpenEquivalentNetOi)}>
        {row.estimatedOpenEquivalentNetOi === null ? (
          <EmptyCell firstRow={isFirst} />
        ) : (
          formatNumber(row.estimatedOpenEquivalentNetOi)
        )}
      </td>
    </tr>
  );
}

const SPOT_COLUMNS: TwseInstitutionName[] = ["外資及陸資", "投信", "自營商", "三大法人合計"];

function SpotDataRow({ day }: { day: TwseBfi82uDay }) {
  return (
    <tr>
      <th scope="row">{formatDate(day.date)}</th>
      {SPOT_COLUMNS.map((name) => {
        const flow = day.flows.find((item) => item.name === name);
        return (
          <td key={name} className={valueTone(flow?.difference ?? null)}>
            {flow ? formatHundredMillion(flow.difference) : ""}
          </td>
        );
      })}
    </tr>
  );
}

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** 讀只查資料庫的 GET API；404 代表資料庫還沒有資料，回傳 null 讓畫面顯示空白提示而不是錯誤。 */
async function readDatabase<T>(url: string, fallbackError: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? fallbackError);
  return payload;
}

export default function Home() {
  const [spotReport, setSpotReport] = useState<TwseBfi82uListResponse | null>(null);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [spotLoading, setSpotLoading] = useState(true);
  const [spotSaving, setSpotSaving] = useState(false);
  const [spotDate, setSpotDate] = useState(taipeiToday);
  const [spotNotice, setSpotNotice] = useState<string | null>(null);
  const [report, setReport] = useState<TaifexFuturesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(taipeiToday);
  const [notice, setNotice] = useState<string | null>(null);
  const [nightReport, setNightReport] = useState<TaifexAfterHoursResponse | null>(null);
  const [nightError, setNightError] = useState<string | null>(null);
  const [nightLoading, setNightLoading] = useState(true);
  const [nightSaving, setNightSaving] = useState(false);
  const [nightDate, setNightDate] = useState(taipeiToday);
  const [nightNotice, setNightNotice] = useState<string | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatusResponse | null>(null);
  const [telegramResult, setTelegramResult] = useState<TelegramTestResponse | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramSending, setTelegramSending] = useState(false);

  // 讀取函式只在 Promise 回呼裡更新狀態，才能直接在開啟頁面的 effect 裡呼叫。
  const loadSpotReport = useCallback(
    () =>
      readDatabase<TwseBfi82uListResponse>("/api/trading-doctor/bfi82u", "無法讀取證交所資料")
        .then(
          (payload) => {
            setSpotReport(payload);
            setSpotError(null);
          },
          (reason: unknown) => setSpotError(errorText(reason, "無法讀取證交所資料")),
        )
        .finally(() => setSpotLoading(false)),
    [],
  );

  const acquireSpotDate = useCallback(async () => {
    setSpotSaving(true);
    setSpotNotice(null);
    try {
      const response = await fetch("/api/trading-doctor/bfi82u", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: spotDate }),
      });
      const payload = (await response.json()) as TwseBfi82uListResponse & {
        error?: string;
        savedDate?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "無法取得證交所資料");
      setSpotReport(payload);
      setSpotError(null);
      setSpotNotice(`${formatDate(payload.savedDate ?? spotDate)} 證交所資料已儲存`);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "無法取得證交所資料");
    } finally {
      setSpotSaving(false);
    }
  }, [spotDate]);

  const loadReport = useCallback(
    () =>
      readDatabase<TaifexFuturesResponse>("/api/trading-doctor/taifex-futures", "無法取得期交所資料")
        .then(
          (payload) => {
            setReport(payload);
            setError(null);
          },
          (reason: unknown) => setError(errorText(reason, "無法取得期交所資料")),
        )
        .finally(() => setLoading(false)),
    [],
  );

  const loadTelegramStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-doctor/telegram-test", {
        cache: "no-store",
      });
      setTelegramStatus((await response.json()) as TelegramStatusResponse);
    } catch {
      setTelegramStatus(null);
    }
  }, []);

  const sendTelegramTest = useCallback(async () => {
    setTelegramSending(true);
    setTelegramError(null);
    setTelegramResult(null);
    try {
      const response = await fetch("/api/trading-doctor/telegram-test", {
        method: "POST",
      });
      const payload = (await response.json()) as TelegramTestResponse & {
        error?: string;
      };
      if (payload.error) throw new Error(payload.error);
      setTelegramResult(payload);
    } catch (reason) {
      setTelegramError(reason instanceof Error ? reason.message : "測試訊息傳送失敗");
    } finally {
      setTelegramSending(false);
      void loadTelegramStatus();
    }
  }, [loadTelegramStatus]);

  const loadNightReport = useCallback(
    () =>
      readDatabase<TaifexAfterHoursResponse>(
        "/api/trading-doctor/taifex-futures-after-hours",
        "無法取得期交所夜盤資料",
      )
        .then(
          (payload) => {
            setNightReport(payload);
            setNightError(null);
          },
          (reason: unknown) => setNightError(errorText(reason, "無法取得期交所夜盤資料")),
        )
        .finally(() => setNightLoading(false)),
    [],
  );

  const acquireNightDate = useCallback(async () => {
    setNightSaving(true);
    setNightNotice(null);
    try {
      const response = await fetch("/api/trading-doctor/taifex-futures-after-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: nightDate }),
      });
      const payload = (await response.json()) as TaifexAfterHoursResponse & {
        error?: string;
        savedDate?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "無法取得期交所夜盤資料");
      setNightReport(payload);
      setNightError(null);
      setNightNotice(`${formatDate(payload.savedDate ?? nightDate)} 夜盤資料已儲存`);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "無法取得期交所夜盤資料");
    } finally {
      setNightSaving(false);
    }
  }, [nightDate]);

  const acquireSelectedDate = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/trading-doctor/taifex-futures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate }),
      });
      const payload = (await response.json()) as TaifexFuturesResponse & {
        error?: string;
        savedDate?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "無法取得期交所資料");
      setReport(payload);
      setError(null);
      setNotice(`${formatDate(payload.savedDate ?? selectedDate)} 資料已儲存`);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "無法取得期交所資料");
    } finally {
      setSaving(false);
    }
  }, [selectedDate]);

  const retrySpotReport = () => {
    setSpotLoading(true);
    setSpotError(null);
    void loadSpotReport();
  };
  const retryNightReport = () => {
    setNightLoading(true);
    setNightError(null);
    void loadNightReport();
  };
  const retryReport = () => {
    setLoading(true);
    setError(null);
    void loadReport();
  };

  // 開啟頁面只讀 Postgres（GET），不連期交所／證交所；要抓新資料仍需按各區塊的按鈕。
  useEffect(() => {
    void loadSpotReport();
    void loadNightReport();
    void loadReport();
  }, [loadNightReport, loadReport, loadSpotReport]);

  const latest = report?.data.at(-1) ?? null;
  const latestNight = nightReport?.data.at(-1) ?? null;
  const nightRangeLabel = nightReport
    ? `${formatDate(nightReport.startDate)} – ${formatDate(nightReport.endDate)}`
    : "2026/09/21 – 今日";
  const rangeLabel = report
    ? `${formatDate(report.startDate)} – ${formatDate(report.endDate)}`
    : "2026/09/21 – 今日";
  const updatedLabel = useMemo(() => {
    if (!report) return "等待資料";
    return `更新於 ${dateTimeFormatter.format(new Date(report.generatedAt))}`;
  }, [report]);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="台指期籌碼首頁">
          <span className="brand-mark">TX</span>
          <span>
            <strong>台指期籌碼</strong>
            <small>TAIFEX POSITION TRACKER</small>
          </span>
        </a>
        <div className="header-meta">
          <span className="live-dot" aria-hidden="true" />
          <span>官方市場資料</span>
          <form className="logout-form" method="post" action="/api/auth/logout">
            <button type="submit">登出</button>
          </form>
        </div>
      </header>

      <section className="telegram-bar" aria-labelledby="telegram-title">
        <div className="telegram-intro">
          <p className="section-kicker">通知測試</p>
          <h2 id="telegram-title">Telegram 籌碼推播</h2>
          <p className="telegram-hint">
            {telegramStatus === null
              ? "按「傳送籌碼報告」時才讀取 .env 設定"
              : telegramStatus.configured
                ? `已設定 ${telegramStatus.chats.length} 位收件人`
                : (telegramStatus.error ?? "尚未設定，請填寫 .env")}
          </p>
        </div>

        <div className="telegram-actions">
          {telegramStatus?.configured ? (
            <ul className="telegram-chips" aria-label="收件人">
              {telegramStatus.chats.map((chat) => (
                <li key={chat.chatId} className="telegram-chip">
                  <strong>{chat.label}</strong>
                  {chat.label === chat.chatId ? null : <span>{chat.chatId}</span>}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="telegram-send"
            onClick={() => void sendTelegramTest()}
            disabled={telegramSending || telegramStatus?.configured === false}
          >
            {telegramSending ? "傳送中…" : "傳送籌碼報告"}
          </button>
        </div>

        {telegramError ? (
          <p className="telegram-feedback telegram-failed" role="alert">
            {telegramError}
          </p>
        ) : telegramResult ? (
          <ul className="telegram-feedback" role="status">
            {telegramResult.results.map((result) => (
              <li
                key={result.chatId}
                className={result.ok ? "telegram-sent" : "telegram-failed"}
              >
                <strong>{result.label}</strong>
                <span>{result.ok ? "已送出" : (result.error ?? "傳送失敗")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="report-card spot-section" aria-labelledby="spot-title">
        <div className="report-heading">
          <div>
            <p className="section-kicker">證交所現貨</p>
            <h2 id="spot-title">最新三大法人買賣金額</h2>
          </div>
          <div className="acquire-controls">
            <label htmlFor="spot-date">指定日期</label>
            <input
              id="spot-date"
              type="date"
              min="2026-09-21"
              max={taipeiToday}
              value={spotDate}
              onChange={(event) => setSpotDate(event.target.value)}
              disabled={spotSaving}
            />
            <button type="button" onClick={() => void acquireSpotDate()} disabled={spotSaving}>
              {spotSaving ? "取得中…" : "取得證交所資料"}
            </button>
          </div>
        </div>

        {spotNotice ? <p className="save-notice" role="status">{spotNotice}</p> : null}

        {spotError ? (
          <div className="state-message error-message" role="alert">
            <strong>證交所資料暫時無法載入</strong>
            <span>{spotError}</span>
            <button type="button" onClick={retrySpotReport}>
              再試一次
            </button>
          </div>
        ) : spotLoading && !spotReport ? (
          <div className="state-message" role="status">
            <span className="loading-line" />
            <span>正在讀取資料庫的證交所資料…</span>
          </div>
        ) : spotReport && spotReport.data.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">外資及陸資買賣超</th>
                  <th scope="col">投信買賣超</th>
                  <th scope="col">自營商買賣超</th>
                  <th scope="col">三大法人合計買賣超</th>
                </tr>
              </thead>
              <tbody>
                {spotReport.data.map((day) => (
                  <SpotDataRow key={day.date} day={day} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="state-message" role="status">
            <strong>資料庫目前沒有證交所資料</strong>
            <span>請選擇日期後按「取得證交所資料」。</span>
          </div>
        )}

        <div className="method-notes">
          <p>
            <strong>單位：</strong>億元，四捨五入至小數第一位；買賣超 = 買進金額 − 賣出金額。
          </p>
          <p>
            <strong>合併：</strong>自營商 = 自行買賣 + 避險；外資及陸資不含外資自營商。
          </p>
          <p>資料來源：證交所 BFI82U 三大法人買賣金額統計表。</p>
        </div>
      </section>

      <section className="hero" id="morning">
        <div>
          <p className="eyebrow">早上盤前推估</p>
          <h1>夜盤推估開盤 OI</h1>
          <p className="hero-copy">
            期交所盤後交易時段（夜盤）歸屬於隔一交易日，因此開盤前即可取得。
            將外資大台、小台與微台夜盤買賣超換算為約當大台，加回前一交易日官方約當淨 OI，推估今日開盤的外資部位。
          </p>
        </div>
        <div className="range-panel" aria-label="夜盤資料區間">
          <span>夜盤資料區間</span>
          <strong>{nightRangeLabel}</strong>
          <small>資料來源：期交所 futContractsDateAh</small>
        </div>
      </section>

      <section className="metrics" aria-label="夜盤推估摘要">
        <MetricCard
          label="開盤預估約當淨 OI"
          value={latestNight ? formatNumber(latestNight.estimatedOpenEquivalentNetOi) || "—" : "—"}
          detail={latestNight ? `${formatDate(latestNight.date)} 盤前推估` : "尚未載入"}
          tone={
            latestNight?.estimatedOpenEquivalentNetOi == null
              ? "neutral"
              : latestNight.estimatedOpenEquivalentNetOi > 0
                ? "positive"
                : "negative"
          }
        />
        <MetricCard
          label="夜盤約當買賣超"
          value={latestNight ? formatNumber(latestNight.nightEquivalentNet) : "—"}
          detail="大台 + 小台 ÷ 4 + 微台 ÷ 20"
          tone={
            latestNight == null || latestNight.nightEquivalentNet === 0
              ? "neutral"
              : latestNight.nightEquivalentNet > 0
                ? "positive"
                : "negative"
          }
        />
        <MetricCard
          label="前日官方約當淨 OI"
          value={
            latestNight ? formatNumber(latestNight.previousOfficialEquivalentNetOi) || "—" : "—"
          }
          detail="推估基準（上一交易日收盤）"
          tone="neutral"
        />
      </section>

      <section className="report-card" aria-labelledby="night-report-title">
        <div className="report-heading">
          <div>
            <p className="section-kicker">每日明細</p>
            <h2 id="night-report-title">早上：夜盤推估 SOP</h2>
          </div>
          <div className="acquire-controls">
            <label htmlFor="night-date">指定日期</label>
            <input
              id="night-date"
              type="date"
              min="2026-09-21"
              max={taipeiToday}
              value={nightDate}
              onChange={(event) => setNightDate(event.target.value)}
              disabled={nightSaving}
            />
            <button type="button" onClick={() => void acquireNightDate()} disabled={nightSaving}>
              {nightSaving ? "取得中…" : "取得夜盤資料"}
            </button>
          </div>
        </div>

        {nightNotice ? <p className="save-notice" role="status">{nightNotice}</p> : null}

        {nightError ? (
          <div className="state-message error-message" role="alert">
            <strong>夜盤資料暫時無法載入</strong>
            <span>{nightError}</span>
            <button type="button" onClick={retryNightReport}>
              再試一次
            </button>
          </div>
        ) : nightLoading && !nightReport ? (
          <div className="state-message" role="status">
            <span className="loading-line" />
            <span>正在讀取資料庫的夜盤資料…</span>
          </div>
        ) : nightReport && nightReport.data.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">大台夜盤買賣超</th>
                  <th scope="col">小台夜盤買賣超</th>
                  <th scope="col">微台夜盤買賣超</th>
                  <th scope="col">夜盤約當買賣超</th>
                  <th scope="col">前日官方約當淨 OI</th>
                  <th scope="col">開盤預估約當淨 OI</th>
                </tr>
              </thead>
              <tbody>
                {nightReport.data.map((row, index) => (
                  <AfterHoursDataRow key={row.date} row={row} isFirst={index === 0} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="state-message" role="status">
            <strong>資料庫目前沒有夜盤資料</strong>
            <span>請選擇日期後按「取得夜盤資料」。</span>
          </div>
        )}

        <div className="method-notes">
          <p>
            <strong>換算：</strong>夜盤約當買賣超 = 大台 + 小台 ÷ 4 + 微台 ÷ 20，各商品先四捨五入至整口。
          </p>
          <p>
            <strong>推估：</strong>開盤預估約當淨 OI = 前一交易日官方約當淨 OI + 今日夜盤約當買賣超。
          </p>
          <p>
            缺少前一交易日官方約當淨 OI 時，開盤預估保留空白。
          </p>
        </div>
      </section>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">下午盤後追蹤</p>
          <h2 className="hero-title">日盤未平倉買賣超</h2>
          <p className="hero-copy">
            將外資大台、小台與微台未平倉淨額換算為約當大台，拆出日盤籌碼的真實方向。
          </p>
        </div>
        <div className="range-panel" aria-label="資料區間">
          <span>資料區間</span>
          <strong>{rangeLabel}</strong>
          <small>{updatedLabel}</small>
        </div>
      </section>

      <section className="metrics" aria-label="最新籌碼摘要">
        <MetricCard
          label="官方約當淨 OI"
          value={latest ? formatNumber(latest.officialEquivalentNetOi) : "—"}
          detail={latest ? `${formatDate(latest.date)} 收盤資料` : "尚未載入"}
          tone={latest && latest.officialEquivalentNetOi > 0 ? "positive" : "negative"}
        />
        <MetricCard
          label="純日盤變化量"
          value={latest ? formatNumber(latest.pureDayChange) || "—" : "—"}
          detail="扣除夜盤約當買賣超"
          tone={
            latest?.pureDayChange == null
              ? "neutral"
              : latest.pureDayChange > 0
                ? "positive"
                : latest.pureDayChange < 0
                  ? "negative"
                  : "neutral"
          }
        />
        <MetricCard
          label="籌碼型態"
          value={latest?.interpretation ?? "—"}
          detail="依純日盤變化方向判讀"
          tone={
            latest?.interpretation === "偏多"
              ? "positive"
              : latest?.interpretation === "偏空"
                ? "negative"
                : "neutral"
          }
        />
      </section>

      <section className="report-card" aria-labelledby="report-title">
        <div className="report-heading">
          <div>
            <p className="section-kicker">每日明細</p>
            <h2 id="report-title">下午：日盤未平倉買賣超</h2>
          </div>
          <div className="acquire-controls">
            <label htmlFor="acquire-date">指定日期</label>
            <input
              id="acquire-date"
              type="date"
              min="2026-09-21"
              max={taipeiToday}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              disabled={saving}
            />
            <button type="button" onClick={() => void acquireSelectedDate()} disabled={saving}>
              {saving ? "取得中…" : "取得資料"}
            </button>
          </div>
        </div>

        {notice ? <p className="save-notice" role="status">{notice}</p> : null}

        {error ? (
          <div className="state-message error-message" role="alert">
            <strong>資料暫時無法載入</strong>
            <span>{error}</span>
            <button type="button" onClick={retryReport}>
              再試一次
            </button>
          </div>
        ) : loading && !report ? (
          <div className="state-message" role="status">
            <span className="loading-line" />
            <span>正在讀取資料庫的日盤資料…</span>
          </div>
        ) : report && report.data.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">大台全日買賣超</th>
                  <th scope="col">小台全日買賣超</th>
                  <th scope="col">微台全日買賣超</th>
                  <th scope="col">今日官方約當淨 OI</th>
                  <th scope="col">日盤籌碼總變化量</th>
                  <th scope="col">純日盤變化量</th>
                  <th scope="col">籌碼型態解讀</th>
                </tr>
              </thead>
              <tbody>
                {report?.data.map((row, index) => (
                  <DataRow key={row.date} row={row} isFirst={index === 0} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="state-message" role="status">
            <strong>資料庫目前沒有資料</strong>
            <span>請選擇日期後按「取得資料」。</span>
          </div>
        )}

        <div className="method-notes">
          <p>
            <strong>換算：</strong>大台 + 小台 ÷ 4 + 微台 ÷ 20，各商品先四捨五入至整口。
          </p>
          <p>
            <strong>判讀：</strong>官方約當淨 OI 日變化扣除夜盤約當買賣超；正值偏多、負值偏空。
          </p>
          <p>
            2026/09/21 因缺少前一交易日基準，變化量與籌碼解讀保留空白。
          </p>
        </div>
      </section>
    </main>
  );
}
