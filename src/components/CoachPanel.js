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
    <div className="coach-panel">
      <div className="coach-header">
        <h2>Learning Coach</h2>
        <button onClick={onClose} className="coach-close">
          Close
        </button>
      </div>

      <section className="coach-auth">
        {accessToken ? (
          <div className="coach-signed-in">
            <span>
              Signed in as {supaUser?.email || supaUser?.id || "user"}
            </span>
          </div>
        ) : null}
        {!accessToken && (
          <div className="coach-dev-fallback">
            <p>
              Please sign in using the “Sign in” button in the header. For local
              development, you can also use a dev userId fallback:
            </p>
            <label className="coach-label">Dev userId (fallback)</label>
            <input
              className="coach-input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Paste your test user's UUID"
            />
            {!userId && (
              <p className="coach-warning">
                Sign in above or enter a userId to use these features.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="coach-grid">
        <div className="coach-section">
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
          <ul className="coach-list">
            {goals.map((g) => (
              <li key={g.id}>
                {g.title} {g.target_date ? `– due ${g.target_date}` : ""}
              </li>
            ))}
          </ul>
        </div>

        <div className="coach-section">
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
          <div className="coach-select-deck">
            <label className="coach-label">Selected deck</label>
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

      <section className="coach-grid">
        <div className="coach-section">
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
          <p className="coach-note">
            Embeddings are computed server-side if your API_KEY is set.
          </p>
        </div>

        <div className="coach-section">
          <h3>Study</h3>
          {!selectedDeckId ? (
            <p className="coach-empty">Select a deck to see due cards.</p>
          ) : (
            <>
              {(() => {
                const sessionTotal = Math.max(
                  stats.dueCount || 0,
                  dueCards.length
                );
                const completed = Math.max(0, sessionTotal - dueCards.length);
                const pct = sessionTotal
                  ? Math.round((completed / sessionTotal) * 100)
                  : 0;
                return (
                  <div className="coach-stats">
                    <div className="coach-badges">
                      <span className="coach-badge">
                        Due now: {dueCards.length}
                      </span>
                      {stats.dueCount !== dueCards.length && (
                        <span className="coach-badge subtle">
                          Total due: {stats.dueCount}
                        </span>
                      )}
                      <span className="coach-badge subtle">
                        Today: {stats.todayReviewed}
                      </span>
                      <span className="coach-badge subtle">
                        Streak: {stats.streakDays}d
                      </span>
                    </div>
                    <div
                      className="coach-progress"
                      aria-label={`Progress ${pct}%`}
                    >
                      <div
                        className="coach-progress-bar"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {dueCards.length === 0 ? (
                <p className="coach-empty">
                  No due cards. Add some cards or try again later.
                </p>
              ) : (
                (() => {
                  const c = dueCards[currentIndex] || dueCards[0];
                  if (!c) return null;
                  return (
                    <div key={c.id} className="coach-card">
                      <div className="coach-card-front">
                        <div className="coach-card-label">Front</div>
                        <div className="coach-card-text">{c.front}</div>
                      </div>
                      {showAnswer && (
                        <div className="coach-card-back">
                          <div className="coach-card-label">Back</div>
                          <div className="coach-card-text">{c.back}</div>
                        </div>
                      )}

                      {!showAnswer ? (
                        <div className="coach-actions">
                          <button onClick={() => setShowAnswer(true)}>
                            Show answer
                          </button>
                        </div>
                      ) : (
                        <div className="coach-actions">
                          <button
                            className="rating-again"
                            onClick={() => review(c.id, 0)}
                          >
                            Again
                          </button>
                          <button
                            className="rating-hard"
                            onClick={() => review(c.id, 2)}
                          >
                            Hard
                          </button>
                          <button
                            className="rating-good"
                            onClick={() => review(c.id, 4)}
                          >
                            Good
                          </button>
                          <button
                            className="rating-easy"
                            onClick={() => review(c.id, 5)}
                          >
                            Easy
                          </button>
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
