import { createClient, type Session, type User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
type AuthValue = { user: User | null; session: Session | null; loading: boolean; configured: boolean; signInWithGoogle: () => Promise<string | null>; signInWithPassword: (email: string, password: string) => Promise<string | null>; signUpWithPassword: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setLoading(false); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const value = useMemo<AuthValue>(() => ({ user: session?.user ?? null, session, loading, configured: Boolean(supabase),
    signInWithGoogle: async () => { if (!supabase) return "Supabase authentication is not configured."; const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) return signOutError.message; const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account", access_type: "offline" } } }); return error?.message ?? null; },
    signInWithPassword: async (email, password) => { if (!supabase) return "Supabase authentication is not configured."; const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); return error?.message ?? null; },
    signUpWithPassword: async (email, password) => { if (!supabase) return { error: "Supabase authentication is not configured.", needsConfirmation: false }; const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } }); return { error: error?.message ?? null, needsConfirmation: Boolean(data.user && !data.session) }; },
    signOut: async () => { if (supabase) await supabase.auth.signOut(); },
  }), [session, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth must be used inside AuthProvider"); return value; }
