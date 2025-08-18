import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const API_BASE = process.env.REACT_APP_API_BASE || "";

async function apiFetch(
  path,
  { method = "GET", headers = {}, body, userId, accessToken } = {}
) {
  const h = { "Content-Type": "application/json", ...headers };
  if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
  else if (userId) h["x-user-id"] = userId; // dev fallback
  const res = await fetch(`${API_BASE}${path}`, { method, headers: h, body });
  if (!res.ok) {
    let errBody = null;
    try {
      errBody = await res.json();
    } catch (_) {}
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }
  return res.json();
}

export default function CoachPanel({ onClose }) {
  // Supabase auth session
  const [session, setSession] = useState(null);
  const accessToken = session?.access_token || null;
  const supaUser = session?.user || null;

  // Dev fallback user id when no auth session
  const [userId, setUserId] = useState(
    () => localStorage.getItem("cognito_userId") || ""
  );
  useEffect(() => {
    localStorage.setItem("cognito_userId", userId || "");
  }, [userId]);

  // Auth UI is handled by header AuthStatus; keep only minimal state here

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data.session || null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
    });
    return () => {
      sub?.subscription?.unsubscribe?.();
      mounted = false;
    };
  }, []);

  const [goals, setGoals] = useState([]);
  const [decks, setDecks] = useState([]);
  const [dueCards, setDueCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [stats, setStats] = useState({
    dueCount: 0,
    todayReviewed: 0,
    streakDays: 0,
  });
  const [selectedDeckId, setSelectedDeckId] = useState("");

  // Forms
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [goalDate, setGoalDate] = useState("");

  const [deckTitle, setDeckTitle] = useState("");
  const [deckDesc, setDeckDesc] = useState("");

  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");

  const canCall = useMemo(
    () => !!accessToken || !!userId,
    [accessToken, userId]
  );

  const refreshGoals = useCallback(async () => {
    if (!canCall) return;
    try {
      const data = await apiFetch(`/coach/goals`, { accessToken, userId });
      setGoals(data.goals || []);
    } catch (e) {
      console.error("goals list failed", e);
    }
  }, [canCall, userId, accessToken]);

  const refreshDecks = useCallback(async () => {
    if (!canCall) return;
    try {
      const data = await apiFetch(`/coach/decks`, { accessToken, userId });
      setDecks(data.decks || []);
    } catch (e) {
      console.error("decks list failed", e);
    }
  }, [canCall, userId, accessToken]);

  const refreshDue = useCallback(
    async (deckId) => {
      if (!canCall || !deckId) return;
      try {
        const data = await apiFetch(
          `/coach/study?deckId=${encodeURIComponent(deckId)}&limit=10`,
          { accessToken, userId }
        );
        setDueCards(data.due || []);
        setCurrentIndex(0);
        setShowAnswer(false);
      } catch (e) {
        console.error("study fetch failed", e);
      }
    },
    [canCall, userId, accessToken]
  );

  const refreshStats = useCallback(
    async (deckId) => {
      if (!canCall || !deckId) return;
      try {
        const data = await apiFetch(
          `/coach/stats?deckId=${encodeURIComponent(deckId)}`,
          { accessToken, userId }
        );
        setStats({
          dueCount: data.dueCount || 0,
          todayReviewed: data.todayReviewed || 0,
          streakDays: data.streakDays || 0,
        });
      } catch (e) {
        console.error("stats fetch failed", e);
      }
    },
    [canCall, userId, accessToken]
  );

  useEffect(() => {
    refreshGoals();
    refreshDecks();
  }, [refreshGoals, refreshDecks]);
  useEffect(() => {
    if (selectedDeckId) {
      refreshDue(selectedDeckId);
      refreshStats(selectedDeckId);
    }
  }, [selectedDeckId, refreshDue, refreshStats]);

  const createGoal = async (e) => {
    e.preventDefault();
    if (!canCall || !goalTitle) return;
    try {
      await apiFetch("/coach/goal", {
        method: "POST",
        accessToken,
        userId,
        body: JSON.stringify({
          title: goalTitle,
          description: goalDesc,
          targetDate: goalDate,
        }),
      });
      setGoalTitle("");
      setGoalDesc("");
      setGoalDate("");
      refreshGoals();
    } catch (e2) {
      console.error("create goal failed", e2);
    }
  };

  const createDeck = async (e) => {
    e.preventDefault();
    if (!canCall || !deckTitle) return;
    try {
      const resp = await apiFetch("/coach/deck", {
        method: "POST",
        accessToken,
        userId,
        body: JSON.stringify({ title: deckTitle, description: deckDesc }),
      });
      setDeckTitle("");
      setDeckDesc("");
      refreshDecks();
      if (resp?.deck?.id) setSelectedDeckId(resp.deck.id);
    } catch (e2) {
      console.error("create deck failed", e2);
    }
  };

  const createCard = async (e) => {
    e.preventDefault();
    if (!canCall || !selectedDeckId || !cardFront || !cardBack) return;
    try {
      await apiFetch("/coach/card", {
        method: "POST",
        accessToken,
        userId,
        body: JSON.stringify({
          deckId: selectedDeckId,
          front: cardFront,
          back: cardBack,
        }),
      });
      setCardFront("");
      setCardBack("");
      refreshDue(selectedDeckId);
    } catch (e2) {
      console.error("create card failed", e2);
    }
  };

  const review = async (cardId, rating) => {
    if (!canCall || !selectedDeckId) return;
    try {
      await apiFetch("/coach/review", {
        method: "POST",
        accessToken,
        userId,
        body: JSON.stringify({ cardId, rating }),
      });
      // Optimistically remove this card from local queue and advance
      setDueCards((prev) => prev.filter((c) => c.id !== cardId));
      setCurrentIndex(0);
      setShowAnswer(false);
      // Refresh stats in background
      refreshStats(selectedDeckId);
    } catch (e2) {
      console.error("review failed", e2);
    }
  };

  // No auth actions here; use AuthStatus in header

  return (
    <div className="coach-panel" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2>Learning Coach</h2>
        <button onClick={onClose}>Close</button>
      </div>

      <section style={{ marginTop: 12, marginBottom: 16 }}>
        {accessToken ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>
              Signed in as {supaUser?.email || supaUser?.id || "user"}
            </span>
          </div>
        ) : null}
        {!accessToken && (
          <div style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>
              Please sign in using the “Sign in” button in the header. For local
              development, you can also use a dev userId fallback:
            </p>
            <label style={{ display: "block" }}>Dev userId (fallback):</label>
            <input
              style={{ width: "100%" }}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Paste your test user's UUID"
            />
            {!userId && (
              <p style={{ color: "#c00" }}>
                Sign in above or enter a userId to use these features.
              </p>
            )}
          </div>
        )}
      </section>

      <section
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1fr 1fr",
          alignItems: "start",
        }}
      >
        <div>
          <h3>Create Goal</h3>
          <form onSubmit={createGoal}>
            <input
              className="coach-input"
              placeholder="Title"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
            />
            <input
              className="coach-input"
              placeholder="Description"
              value={goalDesc}
              onChange={(e) => setGoalDesc(e.target.value)}
            />
            <input
              className="coach-input"
              type="date"
              value={goalDate}
              onChange={(e) => setGoalDate(e.target.value)}
            />
            <button type="submit" disabled={!canCall || !goalTitle}>
              Add Goal
            </button>
          </form>
          <ul>
            {goals.map((g) => (
              <li key={g.id}>
                {g.title} {g.target_date ? `– due ${g.target_date}` : ""}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Create Deck</h3>
          <form onSubmit={createDeck}>
            <input
              className="coach-input"
              placeholder="Title"
              value={deckTitle}
              onChange={(e) => setDeckTitle(e.target.value)}
            />
            <input
              className="coach-input"
              placeholder="Description"
              value={deckDesc}
              onChange={(e) => setDeckDesc(e.target.value)}
            />
            <button type="submit" disabled={!canCall || !deckTitle}>
              Add Deck
            </button>
          </form>
          <div style={{ marginTop: 8 }}>
            <label>Selected deck: </label>
            <select
              className="coach-select"
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
            >
              <option value="">-- choose --</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1fr 1fr",
          alignItems: "start",
          marginTop: 16,
        }}
      >
        <div>
          <h3>Create Card</h3>
          <form onSubmit={createCard}>
            <textarea
              className="coach-textarea"
              placeholder="Front"
              value={cardFront}
              onChange={(e) => setCardFront(e.target.value)}
            />
            <textarea
              className="coach-textarea"
              placeholder="Back"
              value={cardBack}
              onChange={(e) => setCardBack(e.target.value)}
            />
            <button
              type="submit"
              disabled={!canCall || !selectedDeckId || !cardFront || !cardBack}
            >
              Add Card
            </button>
          </form>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Embeddings are computed server-side if your API_KEY is set.
          </p>
        </div>

        <div>
          <h3>Study</h3>
          {!selectedDeckId ? (
            <p>Select a deck to see due cards.</p>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div style={{ fontSize: 14, opacity: 0.9 }}>
                  Due now: <b>{dueCards.length}</b>{" "}
                  {stats.dueCount !== dueCards.length
                    ? `(total due: ${stats.dueCount})`
                    : ""}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  Today: {stats.todayReviewed} • Streak: {stats.streakDays}d
                </div>
              </div>

              {dueCards.length === 0 ? (
                <p>No due cards. Add some cards or try again later.</p>
              ) : (
                (() => {
                  const c = dueCards[currentIndex] || dueCards[0];
                  if (!c) return null;
                  return (
                    <div
                      key={c.id}
                      style={{
                        border: "1px solid #ccc",
                        borderRadius: 6,
                        padding: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div>
                        <b>Front:</b>
                        <br />
                        {c.front}
                      </div>
                      {showAnswer ? (
                        <div style={{ marginTop: 8 }}>
                          <b>Back:</b>
                          <br />
                          {c.back}
                        </div>
                      ) : null}

                      {!showAnswer ? (
                        <div style={{ marginTop: 12 }}>
                          <button onClick={() => setShowAnswer(true)}>
                            Show answer
                          </button>
                        </div>
                      ) : (
                        <div
                          style={{
                            marginTop: 12,
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <button onClick={() => review(c.id, 0)}>Again</button>
                          <button onClick={() => review(c.id, 2)}>Hard</button>
                          <button onClick={() => review(c.id, 4)}>Good</button>
                          <button onClick={() => review(c.id, 5)}>Easy</button>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
