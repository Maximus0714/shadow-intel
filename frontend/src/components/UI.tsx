"use client";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowClockwise,
  WarningCircle,
  MagnifyingGlass,
  Sun,
  Moon,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
export function ButtonLink({
  to,
  children,
  primary = false,
  className = "",
}: {
  to: string;
  children: ReactNode;
  primary?: boolean;
  className?: string;
}) {
  return (
    <Link className={`btn ${primary ? "primary" : ""} ${className}`} to={to}>
      {children}
      <ArrowRight size={17} />
    </Link>
  );
}
export function PageHeader({
  title,
  description,
  children,
  eyebrow,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="overline">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Loading({
  label = "Loading your workspace",
}: {
  label?: string;
}) {
  return (
    <div className="loading-grid" role="status" aria-label={label}>
      <div className="skeleton tall" />
      <div className="skeleton" />
      <div className="skeleton" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <WarningCircle size={30} />
      <div>
        <h3>We couldn’t load this data</h3>
        <p>{message}</p>
        <div className="inline-actions">
          {retry && (
            <button className="btn" onClick={retry}>
              <ArrowClockwise />
              Try again
            </button>
          )}
          <Link className="text-link" to="/settings">
            Connection settings <ArrowRight />
          </Link>
        </div>
      </div>
    </div>
  );
}
export function Empty({
  title = "Nothing here yet",
  body,
  action,
}: {
  title?: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <MagnifyingGlass size={32} weight="thin" />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function ThemeButton() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("shadowintel-theme") || "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("shadowintel-theme", theme);
    } catch {}
  }, [theme]);
  return (
    <button
      className="icon-button"
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="S Shadow Intel home">
      <span className="brand-mark" aria-hidden="true">
        S
      </span>
      <span>
        Shadow <span className="brand-light">Intel</span>
      </span>
    </Link>
  );
}
