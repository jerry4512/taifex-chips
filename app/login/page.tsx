import { safeNextPath } from "../../lib/auth";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "帳號或密碼錯誤",
  config: "伺服器尚未完成登入設定（DATABASE_URL），請聯絡管理者",
  db: "無法連線帳號資料庫，請稍後再試",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const next = safeNextPath(first(params.next));
  const error = ERROR_MESSAGES[first(params.error) ?? ""];

  return (
    <main className="login-page">
      <form className="login-card" method="post" action="/api/auth/login">
        <div className="brand">
          <span className="brand-mark">TX</span>
          <span>
            <strong>台指期籌碼</strong>
            <small>TAIFEX POSITION TRACKER</small>
          </span>
        </div>
        <h1>登入</h1>
        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}
        <label>
          帳號
          <input name="username" autoComplete="username" placeholder="請輸入帳號" required autoFocus />
        </label>
        <label>
          密碼
          <input name="password" type="password" autoComplete="current-password" placeholder="請輸入密碼" required />
        </label>
        <input type="hidden" name="next" value={next} />
        <button type="submit">登入</button>
      </form>
    </main>
  );
}
