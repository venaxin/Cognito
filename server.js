const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");

dotenv.config();

// Detect Vercel serverless environment
const IS_VERCEL = !!process.env.VERCEL;

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

// Simple JSON file store for per-user chat history
// On Vercel, write to /tmp (ephemeral, non-persistent across deploys/instances)
const DATA_DIR = IS_VERCEL
  ? path.join("/tmp", "intellibot-data")
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
