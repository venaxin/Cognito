# Data directory

This folder stores per-user chat history in `chats.json`.

- File: `chats.json`
- Schema: `{ "clients": { [clientId]: { previousChats: Array<{ title, role, content }> } } }`
- Created automatically by the server at runtime if it does not exist.

Do not commit sensitive contents. Consider adding `data/chats.json` to `.gitignore`.
