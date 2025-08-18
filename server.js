const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

// Detect Vercel serverless environment
const IS_VERCEL = !!process.env.VERCEL;

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Supabase server client
// Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE in env (Vercel project settings or .env locally)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

// Simple JSON file store for per-user chat history
// On Vercel, write to /tmp (ephemeral, non-persistent across deploys/instances)
const DATA_DIR = IS_VERCEL
  ? path.join("/tmp", "cognito-data")
  : path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "chats.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE))
    fs.writeFileSync(DB_FILE, JSON.stringify({ clients: {} }, null, 2));
}

function loadStore() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // backfill titles for clients missing it
    if (parsed && parsed.clients) {
      for (const cid of Object.keys(parsed.clients)) {
        const bucket = parsed.clients[cid];
        if (!bucket.titles) {
          const titles = Array.from(
            new Set(
              (bucket.previousChats || []).map((m) => m.title).filter(Boolean)
            )
          );
          bucket.titles = titles;
        }
      }
    }
    return parsed;
  } catch (e) {
    console.error("Failed to load store:", e);
    return { clients: {} };
  }
}

function saveStore(store) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("Failed to save store:", e);
  }
}

let STORE = loadStore();

// Helpers for conversation-based storage
function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  ).toUpperCase();
}

function ensureClient(clientId) {
  if (!STORE.clients[clientId])
    STORE.clients[clientId] = {
      previousChats: [],
      titles: [],
      conversations: {},
      convOrder: [],
    };
  const bucket = STORE.clients[clientId];
  if (!bucket.conversations) bucket.conversations = {};
  if (!bucket.convOrder) bucket.convOrder = [];
  if (!bucket.titles) bucket.titles = [];
  if (!bucket.previousChats) bucket.previousChats = [];
  return bucket;
}

// Migrate legacy previousChats/titles into conversations once
for (const cid of Object.keys(STORE.clients || {})) {
  const bucket = ensureClient(cid);
  if (Object.keys(bucket.conversations).length === 0) {
    const titles = bucket.titles.length
      ? bucket.titles
      : Array.from(
          new Set(
            (bucket.previousChats || []).map((m) => m.title).filter(Boolean)
          )
        );
    for (const t of titles) {
      const id = genId();
      const messages = (bucket.previousChats || [])
        .filter((m) => m.title === t)
        .map((m) => ({ role: m.role, content: m.content }));
      bucket.conversations[id] = { id, title: t, messages };
      bucket.convOrder.push(id);
    }
  }
}
saveStore(STORE);

app.post("/completions", async (req, res) => {
  const { message, clientId, chatId, title } = req.body;

  if (!clientId) return res.status(400).send({ error: "clientId required" });
  if (!chatId && !title)
    return res.status(400).send({ error: "chatId or title required" });

  // Check if the message includes the "create image" command
  if (message.toLowerCase().includes("create image:")) {
    return res
      .status(501)
      .send({ error: "Image generation not supported with Gemini." });
  } else {
    try {
      const bucket = ensureClient(clientId);
      // Resolve conversation by chatId or by title
      let conversation = null;
      if (chatId && bucket.conversations[chatId]) {
        conversation = bucket.conversations[chatId];
      } else if (title) {
        const foundId = Object.keys(bucket.conversations).find(
          (id) => bucket.conversations[id].title === title
        );
        if (foundId) conversation = bucket.conversations[foundId];
      }
      if (!conversation) {
        // Create a new conversation if not found
        const newId = genId();
        const newTitle = title || `Chat ${bucket.convOrder.length}`;
        conversation = { id: newId, title: newTitle, messages: [] };
        bucket.conversations[newId] = conversation;
        bucket.convOrder.push(newId);
      }

      // Add user message
      conversation.messages.push({ role: "user", content: message });
      saveStore(STORE);
      console.log(
        "User:",
        message,
        "chatId:",
        conversation.id,
        "title:",
        conversation.title
      );

      // Get the assistant's response using only this conversation's messages
      const completion = await getChatCompletion(conversation.messages);
      if (!completion) {
        return res.status(500).send({ message: "Something went wrong" });
      }

      // Add assistant reply to history
      conversation.messages.push({
        role: "assistant",
        content: completion.content,
      });
      saveStore(STORE);

      console.log("Assistant:", completion.content);
      res.send({
        completion: completion.content,
        chatId: conversation.id,
        title: conversation.title,
      });
    } catch (error) {
      console.error("OpenAI chat completion error:", error);
      res.status(500).send({ error: "Failed to get chat completion" });
    }
  }
});

app.post("/newSession", async (req, res) => {
  const { clientId, title } = req.body || {};
  if (!clientId) return res.status(400).send({ error: "clientId required" });
  if (!title) return res.status(400).send({ error: "title required" });
  const bucket = ensureClient(clientId);
  // Create new conversation
  const id = genId();
  bucket.conversations[id] = { id, title, messages: [] };
  bucket.convOrder.push(id);
  saveStore(STORE);
  res.send({ message: "Session ready", chatId: id, title });
});

// Return full chat history for a client
app.get("/history", async (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId) return res.status(400).send({ error: "clientId required" });
  const bucket = ensureClient(clientId);
  const conversations = bucket.convOrder
    .map((id) => bucket.conversations[id])
    .filter(Boolean)
    .map((c) => ({ id: c.id, title: c.title }));
  // Optionally include messages lazily per conversation
  res.send({ conversations });
});

// Rename all chats with oldTitle to newTitle for this client
app.post("/renameChat", async (req, res) => {
  const { clientId, chatId, newTitle } = req.body || {};
  if (!clientId || !chatId || !newTitle) {
    return res
      .status(400)
      .send({ error: "clientId, chatId, newTitle required" });
  }
  const bucket = ensureClient(clientId);
  if (!bucket.conversations[chatId])
    return res.status(404).send({ error: "chat not found" });
  bucket.conversations[chatId].title = newTitle;
  saveStore(STORE);
  res.send({ ok: true });
});

// Delete a chat by title for this client
app.post("/deleteChat", async (req, res) => {
  const { clientId, chatId } = req.body || {};
  if (!clientId || !chatId) {
    return res.status(400).send({ error: "clientId and chatId required" });
  }
  const bucket = ensureClient(clientId);
  if (!bucket.conversations[chatId])
    return res.status(404).send({ error: "chat not found" });
  delete bucket.conversations[chatId];
  bucket.convOrder = bucket.convOrder.filter((id) => id !== chatId);
  saveStore(STORE);
  res.send({ ok: true });
});

// Get messages for a conversation
app.get("/conversation", async (req, res) => {
  const { clientId, chatId } = req.query;
  if (!clientId || !chatId)
    return res.status(400).send({ error: "clientId and chatId required" });
  const bucket = ensureClient(clientId);
  const convo = bucket.conversations[chatId];
  if (!convo) return res.status(404).send({ error: "chat not found" });
  res.send({ id: convo.id, title: convo.title, messages: convo.messages });
});

async function getChatCompletion(messages) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash", // Your chosen model
      generationConfig: {
        maxOutputTokens: 200, // Set your desired character limit here (approximate tokens)
      },
    });

    // Use the chat method (required for conversation)
    const chat = model.startChat({
      history: messages.map((msg) => ({
        // Map roles: 'user' remains 'user', but 'assistant' must become 'model'
        role: msg.role === "assistant" ? "model" : msg.role, // <--- IMPORTANT CHANGE HERE
        parts: [{ text: msg.content }],
      })),
    });

    const result = await chat.sendMessage(
      messages[messages.length - 1].content
    );
    const response = result.response.text();

    // When returning the completion, ensure the role is "model" for Gemini's responses
    return { role: "model", content: response }; // <--- IMPORTANT CHANGE HERE
  } catch (err) {
    console.error("Gemini error:", err);
    return null;
  }
}

// ---------- Learning Coach: Supabase-backed endpoints ----------

function requireSupabase(res) {
  if (!sbAdmin) {
    res.status(500).send({
      error:
        "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE.",
    });
    return false;
  }
  return true;
}

// Auth helpers: prefer Supabase JWT in Authorization: Bearer <token>
async function getAuthUser(req) {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth) return null;
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
    const token = parts[1];
    const { data, error } = await sbAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, token };
  } catch (e) {
    console.warn("getAuthUser error:", e?.message || e);
    return null;
  }
}

async function requireUser(req, res) {
  if (!requireSupabase(res)) return null;
  const u = await getAuthUser(req);
  if (u && u.id) return u.id;
  // Dev fallback to x-user-id if no Authorization header and not production
  const devId =
    req.header("x-user-id") || req.body?.userId || req.query?.userId;
  if (devId && process.env.NODE_ENV !== "production") return devId;
  res.status(401).send({
    error: "Unauthorized: provide Supabase JWT in Authorization header",
  });
  return null;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function computeNextReview(prev, rating) {
  // prev: { interval_days, easiness }
  const today = new Date();
  let E = prev?.easiness ?? 2.5;
  // SM-2 easiness update
  E = E - 0.8 + 0.28 * rating - 0.02 * rating * rating;
  if (E < 1.3) E = 1.3;
  let interval = 1;
  if (rating < 3) {
    interval = 1;
  } else if (!prev) {
    interval = 1;
  } else if (prev.interval_days <= 1) {
    interval = 6;
  } else {
    interval = Math.round(prev.interval_days * E);
  }
  const due = addDays(today, interval);
  return {
    interval_days: interval,
    easiness: E,
    due_date: due.toISOString().slice(0, 10),
  };
}

async function computeEmbeddingOrNull(text) {
  try {
    if (!process.env.API_KEY) return null;
    const embModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await embModel.embedContent({
      content: { parts: [{ text }], role: "user" },
    });
    const values = result?.embedding?.values || result?.data?.embedding?.values;
    if (Array.isArray(values) && values.length) return values;
    return null;
  } catch (e) {
    console.warn("Embedding compute failed:", e?.message || e);
    return null;
  }
}

// Create goal
app.post("/coach/goal", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { title, description, targetDate } = req.body || {};
  if (!title) return res.status(400).send({ error: "title required" });
  const { data, error } = await sbAdmin
    .from("goals")
    .insert([
      { user_id: userId, title, description, target_date: targetDate || null },
    ])
    .select("*")
    .single();
  if (error) return res.status(500).send({ error: error.message });
  res.send({ goal: data });
});

// List goals
app.get("/coach/goals", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { data, error } = await sbAdmin
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).send({ error: error.message });
  res.send({ goals: data });
});

// Create deck
app.post("/coach/deck", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { title, description } = req.body || {};
  if (!title) return res.status(400).send({ error: "title required" });
  const { data, error } = await sbAdmin
    .from("decks")
    .insert([{ user_id: userId, title, description }])
    .select("*")
    .single();
  if (error) return res.status(500).send({ error: error.message });
  res.send({ deck: data });
});

// List decks
app.get("/coach/decks", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { data, error } = await sbAdmin
    .from("decks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).send({ error: error.message });
  res.send({ decks: data });
});

// Create card (compute embedding server-side)
app.post("/coach/card", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { deckId, front, back } = req.body || {};
  if (!deckId || !front || !back)
    return res.status(400).send({ error: "deckId, front, back required" });
  // Ensure deck belongs to user
  const { data: deck, error: deckErr } = await sbAdmin
    .from("decks")
    .select("id,user_id")
    .eq("id", deckId)
    .single();
  if (deckErr || !deck)
    return res.status(404).send({ error: "deck not found" });
  if (deck.user_id !== userId)
    return res.status(403).send({ error: "forbidden" });

  const text = `${front}\n\n${back}`;
  const embedding = await computeEmbeddingOrNull(text);

  const insertObj = { deck_id: deckId, front, back };
  if (embedding) insertObj.embedding = embedding;

  const { data: card, error } = await sbAdmin
    .from("cards")
    .insert([insertObj])
    .select("*")
    .single();
  if (error) return res.status(500).send({ error: error.message });
  res.send({ card, embeddingStored: !!embedding });
});

// Study queue: due cards for user+deck
app.get("/coach/study", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const deckId = req.query.deckId;
  const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
  if (!deckId) return res.status(400).send({ error: "deckId required" });

  // Fetch cards in deck
  const { data: cards, error: cardsErr } = await sbAdmin
    .from("cards")
    .select("id, deck_id, front, back, created_at")
    .eq("deck_id", deckId);
  if (cardsErr) return res.status(500).send({ error: cardsErr.message });
  if (!cards?.length) return res.send({ due: [] });
  const cardIds = cards.map((c) => c.id);

  // Fetch latest reviews per card for user
  const { data: reviews, error: revErr } = await sbAdmin
    .from("reviews")
    .select(
      "id, card_id, user_id, rating, interval_days, easiness, due_date, reviewed_at"
    )
    .eq("user_id", userId)
    .in("card_id", cardIds);
  if (revErr) return res.status(500).send({ error: revErr.message });

  const latestByCard = new Map();
  (reviews || []).forEach((r) => {
    const prev = latestByCard.get(r.card_id);
    if (!prev || new Date(r.reviewed_at) > new Date(prev.reviewed_at)) {
      latestByCard.set(r.card_id, r);
    }
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const due = cards
    .filter((c) => {
      const lr = latestByCard.get(c.id);
      if (!lr) return true; // never reviewed
      return lr.due_date <= todayStr;
    })
    .slice(0, limit);

  res.send({ due });
});

// Submit a review
app.post("/coach/review", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { cardId, rating } = req.body || {};
  if (!cardId || typeof rating !== "number")
    return res.status(400).send({ error: "cardId, numeric rating required" });

  // Get last review
  const { data: prevs, error: prevErr } = await sbAdmin
    .from("reviews")
    .select("id, interval_days, easiness, reviewed_at")
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .order("reviewed_at", { ascending: false })
    .limit(1);
  if (prevErr) return res.status(500).send({ error: prevErr.message });
  const prev =
    prevs && prevs[0]
      ? { interval_days: prevs[0].interval_days, easiness: prevs[0].easiness }
      : null;

  const next = computeNextReview(prev, rating);
  const { data, error } = await sbAdmin
    .from("reviews")
    .insert([
      {
        card_id: cardId,
        user_id: userId,
        rating,
        interval_days: next.interval_days,
        easiness: next.easiness,
        due_date: next.due_date,
      },
    ])
    .select("*")
    .single();
  if (error) return res.status(500).send({ error: error.message });
  res.send({ review: data });
});

// Deck stats: due count, today's reviews, simple daily streak (deck-specific)
app.get("/coach/stats", async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = await requireUser(req, res);
  if (!userId) return;
  const deckId = req.query.deckId;
  if (!deckId) return res.status(400).send({ error: "deckId required" });

  // Fetch card ids in the deck
  const { data: cards, error: cardsErr } = await sbAdmin
    .from("cards")
    .select("id")
    .eq("deck_id", deckId);
  if (cardsErr) return res.status(500).send({ error: cardsErr.message });
  const cardIds = (cards || []).map((c) => c.id);
  if (!cardIds.length)
    return res.send({ dueCount: 0, todayReviewed: 0, streakDays: 0 });

  // Latest reviews per card for due calc
  const { data: reviews, error: revErr } = await sbAdmin
    .from("reviews")
    .select("card_id, rating, interval_days, easiness, due_date, reviewed_at")
    .eq("user_id", userId)
    .in("card_id", cardIds);
  if (revErr) return res.status(500).send({ error: revErr.message });

  const latestByCard = new Map();
  (reviews || []).forEach((r) => {
    const prev = latestByCard.get(r.card_id);
    if (!prev || new Date(r.reviewed_at) > new Date(prev.reviewed_at)) {
      latestByCard.set(r.card_id, r);
    }
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const dueCount = cardIds.filter((id) => {
    const lr = latestByCard.get(id);
    if (!lr) return true; // never reviewed
    return lr.due_date <= todayStr;
  }).length;

  // Today reviewed count (deck-specific)
  const today = new Date();
  const start = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      0,
      0,
      0
    )
  );
  const end = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + 1,
      0,
      0,
      0
    )
  );
  const { count: todayReviewed, error: todayErr } = await sbAdmin
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("card_id", cardIds)
    .gte("reviewed_at", start.toISOString())
    .lt("reviewed_at", end.toISOString());
  if (todayErr) return res.status(500).send({ error: todayErr.message });

  // Streak days (consecutive days ending today with >= 1 review)
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 60); // look back up to 60 days
  const { data: recent, error: recentErr } = await sbAdmin
    .from("reviews")
    .select("reviewed_at")
    .eq("user_id", userId)
    .in("card_id", cardIds)
    .gte("reviewed_at", since.toISOString());
  if (recentErr) return res.status(500).send({ error: recentErr.message });
  const datesSet = new Set(
    (recent || []).map((r) =>
      new Date(r.reviewed_at).toISOString().slice(0, 10)
    )
  );
  let streakDays = 0;
  let cursor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  // Require today to have at least one review to start a streak
  while (datesSet.has(cursor.toISOString().slice(0, 10))) {
    streakDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  res.send({ dueCount, todayReviewed: todayReviewed || 0, streakDays });
});

// In local/standalone mode, also serve the static React build and start listening
if (!IS_VERCEL) {
  const buildPath = path.join(__dirname, "build");
  app.use(express.static(buildPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(buildPath, "index.html"));
  });
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, () => console.log(`Server running on PORT ${PORT}`));
}

// Export the Express handler for Vercel serverless functions
module.exports = app;
