'use client';

import { useEffect, useMemo, useState } from 'react';
import JournalApp from '@/components/journal-app';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | undefined>();

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setEmail(data.user?.email);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
      setEmail(session?.user?.email);
    });

    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}`
      }
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (!userId) {
    return (
      <main className="app">
        <section className="card stack">
          <div className="sub">JY Trading Journal</div>
          <h1>Sign in to your cloud journal</h1>
          <p className="muted small">
            Next.js + Supabase connected architecture. Google sign-in is enabled.
          </p>
          <button className="primary" onClick={signInWithGoogle}>Continue with Google</button>
        </section>
      </main>
    );
  }

  return (
    <>
      <div style={{ maxWidth: 940, margin: '12px auto 0', padding: '0 14px' }}>
        <button className="inline" style={{ width: 'auto' }} onClick={signOut}>Sign out</button>
      </div>
      <JournalApp userId={userId} email={email} />
    </>
  );
}
