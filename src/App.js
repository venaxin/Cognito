/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
/* eslint-disable jsx-a11y/anchor-is-valid */
/* eslint-disable jsx-a11y/anchor-has-content */
import React, { useRef, useEffect, useState } from "react";
import "./App.css";
import Modal from "react-modal";
import DefaultPage from "./components/Default";
import CoachPanel from "./components/CoachPanel";
import AuthStatus from "./components/AuthStatus";
Modal.setAppElement("#root");

// Helper for API base and safe JSON parsing
const API_BASE = process.env.REACT_APP_API_BASE || ""; // same-origin by default
async function apiFetch(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    // Try to parse error payload; fallback to text
    let errBody = null;
    try {
      if (contentType.includes("application/json")) errBody = await res.json();
      else errBody = await res.text();
    } catch (_) {}
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }
  if (contentType.includes("application/json")) return res.json();
  // Non-JSON (likely HTML) -> throw for callers to handle
  const text = await res.text();
  throw new Error(`Unexpected non-JSON response: ${text.slice(0, 200)}...`);
}

function App() {
  // Persistent client id per browser
  const [clientId] = useState(() => {
    const key = "cognito_clientId";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
    return id;
  });

  const [value, setValue] = useState("");
  const [modalValue, setModalValue] = useState("");
  const [message, setMessage] = useState(null);
  const [previousChats, setPreviousChats] = useState([]); // messages for current chat
  const [conversations, setConversations] = useState([]); // [{id, title}]
  const [currentTitle, setCurrentTitle] = useState("");
  const [currentChatId, setCurrentChatId] = useState("");
  const [renameTargetId, setRenameTargetId] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState("");
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isDeletePromptOpen, setIsDeletePromptOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking] = useState(false);
  const chatFeedRef = useRef(null);
  const [isDefaultPage, setIsDefaultPage] = useState(true);
  const [theme, setTheme] = useState("default");
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [showCoach, setShowCoach] = useState(false);
  const silenceTimeoutRef = useRef(null);

  const persistLast = (id, title) => {
    try {
      if (id) localStorage.setItem("cognito_lastChatId", id);
      if (title) localStorage.setItem("cognito_lastTitle", title);
    } catch {}
  };

  const toggleMenu = () => setIsActive(!isActive);
  const handleThemeChange = (selectedTheme) => {
    setTheme(selectedTheme);
    setIsThemeMenuOpen(false);
  };
  const handleThemeMenuToggle = () => setIsThemeMenuOpen((s) => !s);

  const createNewChat = async () => {
    setIsDefaultPage(true);
    setMessage(null);
    setValue("");

    const chatNumber = conversations.length;
    const title = `Chat ${chatNumber}`.substring(0, 10);
    try {
      const resp = await apiFetch("/newSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, title }),
      });
      const data = resp;
      if (data && data.chatId) {
        setConversations((prev) => [
          ...prev,
          { id: data.chatId, title: data.title || title },
        ]);
        setCurrentChatId(data.chatId);
        setCurrentTitle(data.title || title);
        setPreviousChats([]);
        persistLast(data.chatId, data.title || title);
      }
    } catch (e) {
      console.error("Failed to create chat", e);
    }
  };

  const handleClick = async (chatId) => {
    const convo = conversations.find((c) => c.id === chatId);
    if (!convo) return;
    setCurrentChatId(convo.id);
    setCurrentTitle(convo.title);
    setMessage(null);
    setIsDefaultPage(false);
    persistLast(convo.id, convo.title);
    try {
      const data = await apiFetch(
        `/conversation?clientId=${encodeURIComponent(
          clientId
        )}&chatId=${encodeURIComponent(convo.id)}`
      );
      if (Array.isArray(data.messages)) {
        setPreviousChats(
          data.messages.map((m) => ({
            title: data.title,
            role: m.role,
            content: m.content,
          }))
        );
      } else {
        setPreviousChats([]);
      }
    } catch (e) {
      console.error("Failed to load conversation", e);
    }
  };

  const handleRename = (chatId) => {
    const convo = conversations.find((c) => c.id === chatId);
    if (!convo) return;
    setRenameTargetId(chatId);
    setModalValue(convo.title);
    setIsPromptOpen(true);
  };

  const handlePromptClose = () => setIsPromptOpen(false);

  const handlePromptSubmit = async () => {
    if (modalValue.length > 16) {
      setIsAlertOpen(true);
      return;
    }
    try {
      await apiFetch("/renameChat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          chatId: renameTargetId,
          newTitle: modalValue,
        }),
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === renameTargetId ? { ...c, title: modalValue } : c
        )
      );
      if (currentChatId === renameTargetId) {
        setCurrentTitle(modalValue);
        persistLast(currentChatId, modalValue);
      }
    } catch (e) {
      console.error("Rename failed", e);
    }
    setIsPromptOpen(false);
  };

  const getMessages = async () => {
    if (!value) return;
    setIsLoading(true);

    // If no current chat selected, create one on the fly
    let chatId = currentChatId;
    if (!chatId) {
      const chatNumber = conversations.length;
      const title = `Chat ${chatNumber}`.substring(0, 10);
      try {
        const resp = await apiFetch("/newSession", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, title }),
        });
        const data = resp;
        if (data && data.chatId) {
          setConversations((prev) => [
            ...prev,
            { id: data.chatId, title: data.title || title },
          ]);
          setCurrentChatId(data.chatId);
          setCurrentTitle(data.title || title);
          persistLast(data.chatId, data.title || title);
          chatId = data.chatId;
        }
      } catch (e) {
        console.error("Failed to create chat for message", e);
      }
    }

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    try {
      const data = await apiFetch("/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: value,
          clientId,
          chatId,
          title: currentTitle || "Chat 0",
        }),
      });
      if (data.chatId && data.chatId !== currentChatId) {
        setCurrentChatId(data.chatId);
      }

      // Append user message
      setPreviousChats((prevChats) => [
        ...prevChats,
        { title: currentTitle, role: "user", content: value },
      ]);

      // Append assistant reply
      if (data.image) {
        setMessage({
          title: currentTitle,
          role: "assistant",
          content: "",
          image: data.image,
        });
      } else {
        setMessage({
          title: currentTitle,
          role: "assistant",
          content: data.completion,
        });
      }

      setValue("");
      if (isSpeaking) stopSpeaking();
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const speak = (content) => {
    const speechSynthesis = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.onend = () => stopSpeaking();
    speechSynthesis.speak(utterance);
    setPreviousChats((prevChats) =>
      prevChats.map((chat) =>
        chat.title === currentTitle ? { ...chat, isSpeaking: true } : chat
      )
    );
  };

  const stopSpeaking = () => {
    const speechSynthesis = window.speechSynthesis;
    speechSynthesis.cancel();
    setPreviousChats((prevChats) =>
      prevChats.map((chat) =>
        chat.title === currentTitle ? { ...chat, isSpeaking: false } : chat
      )
    );
  };

  useEffect(() => {
    if (message) {
      setPreviousChats((prevChats) => [
        ...prevChats,
        {
          title: currentTitle,
          role: message.role,
          content: message.content,
          image: message.image,
        },
      ]);
    }
  }, [message]);

  useEffect(() => {
    chatFeedRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [previousChats]);

  // Load conversations once on mount and restore last active chat
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const data = await apiFetch(
          `/history?clientId=${encodeURIComponent(clientId)}`
        );
        if (Array.isArray(data.conversations)) {
          setConversations(data.conversations);
          const savedId = localStorage.getItem("cognito_lastChatId");
          const chosen =
            data.conversations.find((c) => c.id === savedId) ||
            data.conversations.slice(-1)[0];
          if (chosen) {
            setCurrentChatId(chosen.id);
            setCurrentTitle(chosen.title);
            setIsDefaultPage(false);
            const conv = await apiFetch(
              `/conversation?clientId=${encodeURIComponent(
                clientId
              )}&chatId=${encodeURIComponent(chosen.id)}`
            );
            if (Array.isArray(conv.messages)) {
              setPreviousChats(
                conv.messages.map((m) => ({
                  title: conv.title,
                  role: m.role,
                  content: m.content,
                }))
              );
            }
          } else {
            setIsDefaultPage(true);
          }
        }
      } catch (e) {
        console.error("Failed to load history", e);
      }
    };
    fetchHistory();
  }, []);

  const [isListening, setIsListening] = useState(false);
  const recognition = useRef(null);

  useEffect(() => {
    if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
      recognition.current = new (window.SpeechRecognition ||
        window.webkitSpeechRecognition)();
      recognition.current.continuous = true;
      recognition.current.interimResults = true;

      recognition.current.onstart = () => {
        setIsListening(true);
        silenceTimeoutRef.current = setTimeout(() => {
          if (recognition.current && isListening) {
            stopListening();
          }
        }, 2000);
      };

      recognition.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0])
          .map((result) => result.transcript)
          .join("");
        setValue(transcript);
        if (transcript.trim().length > 0) {
          if (silenceTimeoutRef.current)
            clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = setTimeout(() => {
            if (recognition.current && isListening) {
              stopListening();
            }
          }, 2000);
        }
      };

      recognition.current.onend = () => {
        setIsListening(false);
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
      };

      recognition.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
      };
    }
  }, []);

  const startListening = () => {
    if (recognition.current) {
      setIsListening(true);
      recognition.current.start();
    }
  };

  const stopListening = () => {
    if (recognition.current && isListening) {
      recognition.current.stop();
      setIsListening(false);
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      if (value) {
        setIsDefaultPage(false);
        getMessages();
      }
    } else if (value) {
      setIsDefaultPage(false);
      getMessages();
    }
  };

  const handleDeleteChat = (chatId) => {
    setDeleteTargetId(chatId);
    setIsDeletePromptOpen(true);
  };

  const handleDeletePromptClose = () => setIsDeletePromptOpen(false);

  const handleDeleteConfirm = async () => {
    try {
      await apiFetch("/deleteChat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, chatId: deleteTargetId }),
      });
      setConversations((prev) => prev.filter((c) => c.id !== deleteTargetId));
      if (currentChatId === deleteTargetId) {
        const remaining = conversations.filter((c) => c.id !== deleteTargetId);
        if (remaining.length > 0) {
          const next = remaining.slice(-1)[0];
          setCurrentChatId(next.id);
          setCurrentTitle(next.title);
          persistLast(next.id, next.title);
          // load next convo
          const conv = await apiFetch(
            `/conversation?clientId=${encodeURIComponent(
              clientId
            )}&chatId=${encodeURIComponent(next.id)}`
          );
          setPreviousChats(
            Array.isArray(conv.messages)
              ? conv.messages.map((m) => ({
                  title: conv.title,
                  role: m.role,
                  content: m.content,
                }))
              : []
          );
          setIsDefaultPage(false);
        } else {
          setCurrentChatId("");
          setCurrentTitle("");
          setPreviousChats([]);
          persistLast("", "");
          setIsDefaultPage(true);
        }
      }
      setIsDeletePromptOpen(false);
    } catch (e) {
      console.error("Delete failed", e);
    }
  };

  const handleAlertClose = () => setIsAlertOpen(false);

  const handlekeyPress = (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      setValue((prevValue) => prevValue + "\n");
    } else if (e.key === "Enter") {
      setIsDefaultPage(false);
      e.preventDefault();
      getMessages();
    }
  };

  return (
    <div className={`app ${theme}`}>
      <section className="side-bar">
        <button onClick={createNewChat}>+ New Conversation</button>
        <button onClick={() => setShowCoach((s) => !s)}>
          {showCoach ? "Close Coach" : "Open Coach"}
        </button>
        <ul className="history">
          {conversations.map((c) => (
            <li key={c.id} onClick={() => handleClick(c.id)}>
              <div className="chat-title-container">
                <button
                  className="rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRename(c.id);
                  }}
                >
                  <img className="renameimg" alt="rename button" />
                </button>
                <span>{c.title}</span>
                <button
                  className="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteChat(c.id);
                  }}
                >
                  <img className="deleteimg" alt="delete button" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div
          id="circularMenu"
          className={`circular-menu ${isActive ? "active" : ""}`}
        >
          <a className="floating-btn" onClick={toggleMenu}>
            <i className="fa fa-plus"></i>
          </a>

          <menu className="items-wrapper">
            <a
              className={`dark menu-item fa fa-linkedin ${
                theme === "dark" ? "active" : ""
              }`}
              onClick={() => handleThemeChange("dark")}
            ></a>
            <a
              className={`light menu-item fa fa-linkedin ${
                theme === "light" ? "active" : ""
              }`}
              onClick={() => handleThemeChange("light")}
            ></a>
            <a
              className={`blue menu-item fa fa-linkedin ${
                theme === "blue" ? "active" : ""
              }`}
              onClick={() => handleThemeChange("blue")}
            ></a>
            <a
              className={`default menu-item fa fa-linkedin ${
                theme === "default" ? "active" : ""
              }`}
              onClick={() => handleThemeChange("default")}
            ></a>
          </menu>
        </div>
      </section>

      <section
        className={`main ${isPromptOpen || isDeletePromptOpen ? "blur" : ""}`}
      >
        <div className="title">
          <h1 style={{ margin: 0 }}>COGNITO</h1>
          <div style={{ marginLeft: "auto" }}>
            <AuthStatus />
          </div>
        </div>
        {isDefaultPage ? (
          <DefaultPage />
        ) : (
          <ul className="feed">
            {previousChats.map((chatMessage, index) => (
              <li key={index}>
                <div className="message-container">
                  {chatMessage && (
                    <div className="role-container">
                      <p className="role">{chatMessage.role}</p>
                      {chatMessage.role === "assistant" &&
                        chatMessage.content && (
                          <button
                            className="speak-button"
                            onClick={() => {
                              if (chatMessage.isSpeaking) {
                                stopSpeaking();
                              } else {
                                speak(chatMessage.content);
                              }
                            }}
                          >
                            {chatMessage.isSpeaking ? (
                              <img className="speak" alt="Stop" />
                            ) : (
                              <img className="speak" alt="Speak" />
                            )}
                          </button>
                        )}
                    </div>
                  )}
                  {chatMessage && chatMessage.image ? (
                    <img
                      className="generated-image"
                      src={chatMessage.image}
                      alt="Generated"
                    />
                  ) : (
                    chatMessage &&
                    chatMessage.content && (
                      <pre>
                        <span>{chatMessage.content}</span>
                      </pre>
                    )
                  )}
                </div>
              </li>
            ))}
            <div ref={chatFeedRef} />
          </ul>
        )}
        <div className="bottom-section">
          <div className={"input-container"}>
            <textarea
              id="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyPress={handlekeyPress}
              placeholder="Type your message..."
              disabled={isLoading}
            />
            {isListening ? (
              <button className="voice_lisenting" onClick={stopListening}>
                <img className="listen" alt="Listen" />
              </button>
            ) : (
              <button className="voice_lisenting" onClick={startListening}>
                <img className="mic" alt="Microphone" />
              </button>
            )}

            <div
              id="submit"
              className={isLoading ? "loading" : ""}
              onClick={getMessages}
            >
              {isLoading ? (
                <>
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </>
              ) : (
                <span>&#10146;</span>
              )}
            </div>
          </div>

          <p className={"info"}>Made by Hussain, Rahmath</p>
        </div>
      </section>

      {/* Coach modal overlay */}
      <Modal
        isOpen={showCoach}
        onRequestClose={() => setShowCoach(false)}
        className="custom-modal custom-modal-wide"
        overlayClassName="custom-modal-overlay"
      >
        <CoachPanel onClose={() => setShowCoach(false)} />
      </Modal>

      <Modal
        isOpen={isPromptOpen}
        onRequestClose={handlePromptClose}
        className="custom-modal"
        overlayClassName="custom-modal-overlay"
      >
        <h2>Enter New Title</h2>
        <input
          type="text"
          value={modalValue}
          onChange={(e) => setModalValue(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handlePromptSubmit()}
        />
        <div>
          <button onClick={handlePromptSubmit}>Rename</button>
          <button onClick={handlePromptClose}>Cancel</button>
        </div>
      </Modal>

      <Modal
        isOpen={isDeletePromptOpen}
        onRequestClose={handleDeletePromptClose}
        className="custom-modal"
        overlayClassName="custom-modal-overlay"
      >
        <h2>Are you sure?</h2>
        <p className="delete-prompt">Do you want to delete this chat?</p>
        <div>
          <button onClick={handleDeleteConfirm}>Yes</button>
          <button onClick={handleDeletePromptClose}>No</button>
        </div>
      </Modal>

      <Modal
        isOpen={isAlertOpen}
        onRequestClose={handleAlertClose}
        className="custom-modal"
        overlayClassName="custom-modal-overlay"
      >
        <div className="alert">
          <h2>Alert</h2>
          <p>
            The chat name is too big. Please try a shorter one. The limit is up
            to 16 characters.
          </p>
          <button onClick={handleAlertClose}>OK</button>
        </div>
      </Modal>
    </div>
  );
}

export default App;
