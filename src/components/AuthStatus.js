import React, { useEffect, useState } from "react";
import Modal from "react-modal";
import { supabase } from "../lib/supabaseClient";

export default function AuthStatus() {
  const [session, setSession] = useState(null);
  const user = session?.user || null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data.session || null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  const sendLink = async (e) => {
    e.preventDefault();
    setMsg("");
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMsg(
      error ? `Error: ${error.message}` : "Check your email for the magic link."
    );
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {user ? (
        <>
          <span style={{ fontSize: 14, opacity: 0.9 }}>
            Signed in as {user.email || user.id}
          </span>
          <button
            onClick={signOut}
            style={{
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => setOpen(true)}
            style={{
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
          <Modal
            isOpen={open}
            onRequestClose={() => setOpen(false)}
            className="custom-modal"
            overlayClassName="custom-modal-overlay"
            style={{ content: { height: "auto", maxHeight: "90vh" } }}
          >
            <h3>Sign in</h3>
            <form onSubmit={sendLink} style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                placeholder="Email for magic link"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  background: "var(--panel)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  width: "100%",
                }}
              />
              <button type="submit" style={{ cursor: "pointer" }}>
                Send link
              </button>
            </form>
            {msg && <p style={{ fontSize: 12, opacity: 0.8 }}>{msg}</p>}
          </Modal>
        </>
      )}
    </div>
  );
}
