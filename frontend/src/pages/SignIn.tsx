import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "@phosphor-icons/react";
import { Brand } from "../components/UI";
import { useAuth } from "../lib/auth";
export default function SignIn() {
  const { user, loading, configured, signInWithGoogle } = useAuth(); const location = useLocation(); const [error, setError] = useState("");
  if (loading) return <div className="auth-page"><p>Restoring your session…</p></div>;
  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from || "/overview"} replace />;
  return <main className="auth-page"><div className="auth-card"><Brand /><div className="auth-icon"><ShieldCheck size={28} /></div><div className="overline">PRIVATE WORKSPACE</div><h1>Sign in to X-Tracer</h1><p>Use your Google account to create and access your investigation workspace.</p>{!configured && <div className="inline-notice">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable authentication.</div>}<button className="btn primary auth-google" disabled={!configured} onClick={async () => { const message = await signInWithGoogle(); if (message) setError(message); }}>Continue with Google <ArrowRight size={18} /></button>{error && <p className="error-copy">{error}</p>}<small>Your evidence stays in your selected local or connected workspace.</small></div></main>;
}
