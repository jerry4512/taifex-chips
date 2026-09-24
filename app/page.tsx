"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChipInterpretation,
  TaifexFuturesResponse,
  TaifexFuturesRow,
} from "../lib/taifex";
import type { TwseBfi82uResponse, TwseInstitutionFlow } from "../lib/twse";

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

function SpotFlowCard({ flow }: { flow: TwseInstitutionFlow }) {
  return (
    <article className={`spot-flow-card ${flow.name === "三大法人合計" ? "spot-total" : ""}`}>
      <div className="spot-flow-heading">
        <h3>{flow.name}</h3>
        <span>買賣差額</span>
      </div>
      <strong className={valueTone(flow.difference)}>{formatHundredMillion(flow.difference)}</strong>
      <dl>
        <div>
          <dt>買進</dt>
          <dd>{formatHundredMillion(flow.buy)}</dd>
        </div>
        <div>
          <dt>賣出</dt>
          <dd>{formatHundredMillion(flow.sell)}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function Home() {
  const [spotReport, setSpotReport] = useState<TwseBfi82uResponse | null>(null);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [spotLoading, setSpotLoading] = useState(true);
  const [report, setReport] = useState<TaifexFuturesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(taipeiToday);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSpotReport = useCallback(async () => {
    setSpotLoading(true);
    setSpotError(null);
    try {
      const response = await fetch("/api/trading-doctor/bfi82u", { cache: "no-store" });
      const payload = (await response.json()) as TwseBfi82uResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法取得證交所資料");
      setSpotReport(payload);
    } catch (reason) {
      setSpotError(reason instanceof Error ? reason.message : "無法取得證交所資料");
    } finally {
      setSpotLoading(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/trading-doctor/taifex-futures", {
        cache: "no-store",
      });
      const payload = (await response.json()) as TaifexFuturesResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法取得期交所資料");
      setReport(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法取得期交所資料");
    } finally {
      setLoading(false);
    }
  }, []);

  const acquireSelectedDate = useCallback(async () => {
    setSaving(true);
    setError(null);
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
      setNotice(`${formatDate(payload.savedDate ?? selectedDate)} 資料已儲存`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "無法取得期交所資料");
    } finally {
      setSaving(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void loadSpotReport();
    void loadReport();
  }, [loadReport, loadSpotReport]);

  const latest = report?.data.at(-1) ?? null;
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
        </div>
      </header>

      <section className="spot-section" aria-labelledby="spot-title">
        <div className="spot-section-heading">
          <div>
            <p className="section-kicker">證交所現貨</p>
            <h2 id="spot-title">最新三大法人買賣金額</h2>
          </div>
          <div className="spot-date">
            <span>資料日期</span>
            <strong>{spotReport ? formatDate(spotReport.date) : "—"}</strong>
            <small>單位：億元</small>
          </div>
        </div>

        {spotError ? (
          <div className="spot-state error-message" role="alert">
            <span>{spotError}</span>
            <button type="button" onClick={() => void loadSpotReport()}>再試一次</button>
          </div>
        ) : spotLoading && !spotReport ? (
          <div className="spot-state" role="status">
            <span className="loading-line" />
            <span>正在取得證交所最新資料…</span>
          </div>
        ) : (
          <div className="spot-grid">
            {spotReport?.data.map((flow) => <SpotFlowCard key={flow.name} flow={flow} />)}
          </div>
        )}
      </section>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">下午盤後追蹤</p>
          <h1>日盤未平倉買賣超</h1>
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
            <button type="button" onClick={() => void loadReport()}>
              再試一次
            </button>
          </div>
        ) : loading && !report ? (
          <div className="state-message" role="status">
            <span className="loading-line" />
            <span>正在整理期交所資料…</span>
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

      <footer>
        <span>資料來源</span>
        <a href="https://www.twse.com.tw/zh/trading/foreign/bfi82u.html" target="_blank" rel="noreferrer">
          臺灣證券交易所・三大法人
        </a>
        <a href="https://www.taifex.com.tw/cht/3/futContractsDate" target="_blank" rel="noreferrer">
          臺灣期貨交易所・區分各期貨契約
        </a>
        <span>僅供市場觀察，不構成投資建議</span>
      </footer>
    </main>
  );
}
