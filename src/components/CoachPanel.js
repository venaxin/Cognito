import React, { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

async function apiFetch(
  path,
  { method = "GET", headers = {}, body, userId } = {}
) {
  const h = { "Content-Type": "application/json", ...headers };
  if (userId) h["x-user-id"] = userId;
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
  const [userId, setUserId] = useState(
    () => localStorage.getItem("cognito_userId") || ""
  );
  useEffect(() => {
    localStorage.setItem("cognito_userId", userId || "");
  }, [userId]);

  const [goals, setGoals] = useState([]);
  const [decks, setDecks] = useState([]);
  const [dueCards, setDueCards] = useState([]);
  const [selectedDeckId, setSelectedDeckId] = useState("");

  // Forms
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [goalDate, setGoalDate] = useState("");

  const [deckTitle, setDeckTitle] = useState("");
  const [deckDesc, setDeckDesc] = useState("");

  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");

  const canCall = useMemo(() => !!userId, [userId]);

  const refreshGoals = useCallback(async () => {
    if (!canCall) return;
    try {
      const data = await apiFetch(
        `/coach/goals?userId=${encodeURIComponent(userId)}`,
        { userId }
      );
      setGoals(data.goals || []);
    } catch (e) {
      console.error("goals list failed", e);
    }
  }, [canCall, userId]);

  const refreshDecks = useCallback(async () => {
    if (!canCall) return;
    try {
      const data = await apiFetch(
        `/coach/decks?userId=${encodeURIComponent(userId)}`,
        { userId }
      );
      setDecks(data.decks || []);
    } catch (e) {
      console.error("decks list failed", e);
    }
  }, [canCall, userId]);

  const refreshDue = useCallback(
    async (deckId) => {
      if (!canCall || !deckId) return;
      try {
        const data = await apiFetch(
          `/coach/study?userId=${encodeURIComponent(
            userId
          )}&deckId=${encodeURIComponent(deckId)}&limit=10`,
          { userId }
        );
        setDueCards(data.due || []);
      } catch (e) {
        console.error("study fetch failed", e);
      }
    },
    [canCall, userId]
  );

  useEffect(() => {
    refreshGoals();
    refreshDecks();
  }, [refreshGoals, refreshDecks]);
  useEffect(() => {
    if (selectedDeckId) refreshDue(selectedDeckId);
  }, [selectedDeckId, refreshDue]);

  const createGoal = async (e) => {
    e.preventDefault();
    if (!canCall || !goalTitle) return;
    try {
      await apiFetch("/coach/goal", {
        method: "POST",
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
        userId,
        body: JSON.stringify({ cardId, rating }),
      });
      refreshDue(selectedDeckId);
    } catch (e2) {
      console.error("review failed", e2);
    }
  };

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
        <label>User ID (Supabase auth.users id): </label>
        <input
          style={{ width: "100%" }}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Paste your test user's UUID"
        />
        {!userId && (
          <p style={{ color: "#c00" }}>Enter a userId to use these features.</p>
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
              placeholder="Title"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
            />
            <input
              placeholder="Description"
              value={goalDesc}
              onChange={(e) => setGoalDesc(e.target.value)}
            />
            <input
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
              placeholder="Title"
              value={deckTitle}
              onChange={(e) => setDeckTitle(e.target.value)}
            />
            <input
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
              placeholder="Front"
              value={cardFront}
              onChange={(e) => setCardFront(e.target.value)}
            />
            <textarea
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
          ) : dueCards.length === 0 ? (
            <p>No due cards. Add some cards or try again later.</p>
          ) : (
            <div>
              {dueCards.map((c) => (
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
                  <div style={{ marginTop: 8 }}>
                    <b>Back:</b>
                    <br />
                    {c.back}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {[0, 1, 2, 3, 4, 5].map((r) => (
                      <button
                        key={r}
                        style={{ marginRight: 6 }}
                        onClick={() => review(c.id, r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
