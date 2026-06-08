import { type FormEvent, useMemo, useState } from "react";
import { login, register, saveSession, type AuthUser } from "../api/auth";
import { Icon } from "../components/Icon";
import type { ActionHandler } from "../types";

type AuthMode = "login" | "register" | "reset";
type FieldErrors = Record<string, string>;

const modeCopy = {
  login: {
    title: "欢迎回来",
    desc: "登录后进入自动化测试工作台",
    submit: "登录",
  },
  register: {
    title: "创建账号",
    desc: "注册团队成员账号，头像地址可稍后补充",
    submit: "注册",
  },
  reset: {
    title: "忘记密码",
    desc: "验证账号信息后发送重置指引",
    submit: "发送重置指引",
  },
};

export function LoginPage({
  onAction,
  onAuthenticated,
}: {
  onAction: ActionHandler;
  onAuthenticated?: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const copy = modeCopy[mode];

  const requiredFields = useMemo(() => {
    if (mode === "register") return ["username", "password", "account", "phone", "email"];
    if (mode === "reset") return ["account", "phone"];
    return ["account", "password"];
  }, [mode]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrors({});
    setFormMessage("");
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const nextErrors: FieldErrors = {};

    requiredFields.forEach((field) => {
      const value = String(form.get(field) ?? "").trim();
      if (!value) nextErrors[field] = "此项为必填";
    });

    const account = String(form.get("account") ?? "").trim();
    if (account && (account.length < 3 || account.length > 64)) nextErrors.account = "账号长度需为 3-64 位";

    const password = String(form.get("password") ?? "").trim();
    if (password && (password.length < 6 || password.length > 128)) nextErrors.password = "密码长度需为 6-128 位";

    const phone = String(form.get("phone") ?? "").trim();
    if (phone && (phone.length < 5 || phone.length > 32)) nextErrors.phone = "手机号长度需为 5-32 位";

    const email = String(form.get("email") ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "邮箱格式不正确";

    setErrors(nextErrors);
    setFormMessage("");
    if (Object.keys(nextErrors).length > 0) return;

    if (mode === "reset") {
      onAction(copy.submit);
      formElement.reset();
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "login") {
        const result = await login(account, password);
        saveSession(result);
        onAction("登录成功");
        onAuthenticated?.(result.user);
        return;
      }

      await register({
        username: String(form.get("username") ?? "").trim(),
        avatar: String(form.get("avatar") ?? "").trim() || null,
        account,
        password,
        phone,
        email,
      });
      formElement.reset();
      setMode("login");
      setFormMessage("注册成功，请使用新账号登录");
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "请求失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="brand large">
          <span className="brand-mark">AI</span>
          <span>TestAuto</span>
        </div>
        <h1>用 AI 驱动自动化测试设计、执行与诊断</h1>
        <div className="login-preview">
          <span />
          <span />
          <span />
          <strong>Pipeline Health 98.2%</strong>
          <p>Real-time execution telemetry</p>
        </div>
      </section>

      <section className="auth-card">
        <div className="tabs auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")} type="button">
            登录
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")} type="button">
            注册
          </button>
          <button className={mode === "reset" ? "active" : ""} onClick={() => switchMode("reset")} type="button">
            忘记密码
          </button>
        </div>

        <div className="auth-heading">
          <h2>{copy.title}</h2>
          <p>{copy.desc}</p>
        </div>

        <form className="auth-form" onSubmit={submitForm} noValidate>
          {mode === "register" && (
            <>
              <TextField error={errors.username} label="用户名" name="username" placeholder="例如：张三" required />
              <TextField error={errors.account} label="账号" name="account" placeholder="例如：zhangsan" required />
              <TextField error={errors.phone} label="手机号" name="phone" placeholder="请输入手机号" required />
              <TextField error={errors.password} label="密码" name="password" placeholder="至少 6 位字符" required type="password" />
              <TextField error={errors.email} label="邮箱" name="email" placeholder="name@example.com" required type="email" />
              <TextField error={errors.avatar} label="头像地址" name="avatar" placeholder="https://example.com/avatar.png" />
            </>
          )}

          {mode === "login" && (
            <>
              <TextField error={errors.account} label="账号" name="account" placeholder="请输入账号" required />
              <TextField error={errors.password} label="密码" name="password" placeholder="请输入密码" required type="password" />
              <button className="link-button" onClick={() => switchMode("reset")} type="button">
                忘记密码？
              </button>
            </>
          )}

          {mode === "reset" && (
            <>
              <TextField error={errors.account} label="账号" name="account" placeholder="请输入账号" required />
              <TextField error={errors.phone} label="手机号" name="phone" placeholder="请输入注册手机号" required />
              <TextField error={errors.email} label="邮箱" name="email" placeholder="可选，用于接收备用通知" type="email" />
            </>
          )}

          {formMessage && <p className="form-message">{formMessage}</p>}

          <button className="btn primary auth-submit" disabled={isSubmitting} type="submit">
            <Icon name={mode === "reset" ? "mail" : mode === "register" ? "person_add" : "login"} />
            {isSubmitting ? "提交中..." : copy.submit}
          </button>
        </form>

        <button className="sso" onClick={() => onAction("企业 SSO 登录")} type="button">
          <Icon name="domain" />
          企业 SSO 登录
        </button>
      </section>
    </main>
  );
}

function TextField({
  error,
  label,
  name,
  placeholder,
  required,
  type = "text",
}: {
  error?: string;
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className={error ? "field invalid" : "field"}>
      <span>
        {label}
        {required ? <em>*</em> : <small>选填</small>}
      </span>
      <input aria-invalid={Boolean(error)} name={name} placeholder={placeholder} type={type} />
      {error && <b>{error}</b>}
    </label>
  );
}
