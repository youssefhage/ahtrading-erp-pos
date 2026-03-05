"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
} from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type KaiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  action?: KaiAction | null;
  /** Pending write-tool confirmation attached to this message. */
  confirmation?: KaiConfirmation | null;
};

export type KaiAction =
  | { type: "navigate"; href: string; label?: string }
  | { type: "info"; message: string };

/** Represents a pending confirmation for a write operation. */
export type KaiConfirmation = {
  id: string;
  toolName: string;
  summary: string;
  status: "pending" | "confirmed" | "rejected";
};

/* ------------------------------------------------------------------ */
/*  Context-aware suggestion mapping                                   */
/* ------------------------------------------------------------------ */

const PATH_SUGGESTIONS: Record<string, string[]> = {
  "/dashboard": [
    "What needs my attention today?",
    "Give me today's briefing",
    "How are we performing?",
  ],
  "/sales": [
    "Who are my top customers this month?",
    "Show today's sales summary",
    "Any overdue invoices?",
  ],
  "/inventory": [
    "Which items are running low?",
    "Show expiring batches",
    "Any negative stock positions?",
  ],
  "/purchasing": [
    "Create a PO for items running low",
    "Show supplier invoice holds",
    "What should I reorder?",
  ],
  "/accounting": [
    "Period close status?",
    "Show AP aging",
    "Any period locks active?",
  ],
  "/catalog": [
    "Search for an item",
    "Pricing recommendations",
    "Update a product price",
  ],
  "/automation": [
    "How many pending recommendations?",
    "Approve all pricing recommendations",
    "Show AI agent health",
  ],
  "/automation/kai-analytics": [
    "How many conversations today?",
    "Which tools are used most?",
    "Show active users this week",
  ],
};

const DEFAULT_SUGGESTIONS = [
  "What needs my attention?",
  "Show today's sales",
  "Search for a product",
];

export function getSuggestionsForPath(pathname: string): string[] {
  for (const [prefix, suggestions] of Object.entries(PATH_SUGGESTIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return suggestions;
    }
  }
  return DEFAULT_SUGGESTIONS;
}

/* ------------------------------------------------------------------ */
/*  Reducer                                                            */
/* ------------------------------------------------------------------ */

type KaiState = {
  isOpen: boolean;
  messages: KaiMessage[];
  isThinking: boolean;
  conversationId: string | null;
};

type KaiActionType =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "TOGGLE" }
  | { type: "ADD_MESSAGE"; msg: KaiMessage }
  | { type: "UPDATE_LAST_ASSISTANT"; content: string; done?: boolean }
  | { type: "SET_ACTION"; action: KaiAction }
  | { type: "SET_CONFIRMATION"; confirmation: KaiConfirmation }
  | { type: "RESOLVE_CONFIRMATION"; id: string; status: "confirmed" | "rejected" }
  | { type: "SET_THINKING"; value: boolean }
  | { type: "SET_CONVERSATION_ID"; id: string }
  | { type: "CLEAR" }
  | { type: "RESTORE"; messages: KaiMessage[]; conversationId: string | null };

export const kaiInitialState: KaiState = {
  isOpen: false,
  messages: [],
  isThinking: false,
  conversationId: null,
};

export function kaiReducer(state: KaiState, action: KaiActionType): KaiState {
  switch (action.type) {
    case "OPEN":
      return { ...state, isOpen: true };
    case "CLOSE":
      return { ...state, isOpen: false };
    case "TOGGLE":
      return { ...state, isOpen: !state.isOpen };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.msg] };
    case "UPDATE_LAST_ASSISTANT": {
      const msgs = [...state.messages];
      const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
      if (lastIdx >= 0) {
        msgs[lastIdx] = {
          ...msgs[lastIdx],
          content: action.content,
          isStreaming: action.done ? false : true,
        };
      }
      return {
        ...state,
        messages: msgs,
        isThinking: action.done ? false : state.isThinking,
      };
    }
    case "SET_ACTION": {
      const msgs = [...state.messages];
      const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
      if (lastIdx >= 0) {
        msgs[lastIdx] = { ...msgs[lastIdx], action: action.action };
      }
      return { ...state, messages: msgs };
    }
    case "SET_CONFIRMATION": {
      const msgs = [...state.messages];
      const lastIdx = msgs.findLastIndex((m) => m.role === "assistant");
      if (lastIdx >= 0) {
        msgs[lastIdx] = { ...msgs[lastIdx], confirmation: action.confirmation };
      }
      return { ...state, messages: msgs };
    }
    case "RESOLVE_CONFIRMATION": {
      const msgs = state.messages.map((m) => {
        if (m.confirmation && m.confirmation.id === action.id) {
          return { ...m, confirmation: { ...m.confirmation, status: action.status } };
        }
        return m;
      });
      return { ...state, messages: msgs };
    }
    case "SET_THINKING":
      return { ...state, isThinking: action.value };
    case "SET_CONVERSATION_ID":
      return { ...state, conversationId: action.id };
    case "CLEAR":
      _clearPersistedSession();
      return { ...state, messages: [], conversationId: null, isThinking: false };
    case "RESTORE":
      return {
        ...state,
        messages: action.messages,
        conversationId: action.conversationId,
        isThinking: false,
      };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/*  Persistence (easy continue)                                       */
/* ------------------------------------------------------------------ */

const _KAI_STORAGE_KEY = "kai_conversation";
const _KAI_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

type PersistedSession = {
  messages: KaiMessage[];
  conversationId: string | null;
  savedAt: number;
};

function _persistSession(messages: KaiMessage[], conversationId: string | null) {
  try {
    if (typeof window === "undefined") return;
    // Only persist completed messages (not streaming)
    const completed = messages.filter((m) => !m.isStreaming);
    if (completed.length === 0) {
      localStorage.removeItem(_KAI_STORAGE_KEY);
      return;
    }
    // Keep only last 30 messages to avoid bloating localStorage
    const toSave = completed.slice(-30);
    const session: PersistedSession = {
      messages: toSave,
      conversationId,
      savedAt: Date.now(),
    };
    localStorage.setItem(_KAI_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage might be full or unavailable
  }
}

function _loadPersistedSession(): PersistedSession | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(_KAI_STORAGE_KEY);
    if (!raw) return null;
    const session: PersistedSession = JSON.parse(raw);
    // Expire after 2 hours
    if (Date.now() - session.savedAt > _KAI_MAX_AGE_MS) {
      localStorage.removeItem(_KAI_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function _clearPersistedSession() {
  try {
    if (typeof window === "undefined") return;
    localStorage.removeItem(_KAI_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

export const KaiContext = createContext<{
  state: KaiState;
  dispatch: Dispatch<KaiActionType>;
} | null>(null);

export function useKaiStore() {
  const ctx = useContext(KaiContext);
  const restoredRef = useRef(false);

  if (!ctx) {
    // Fallback for components rendered outside provider (e.g., during SSR)
    return {
      ...kaiInitialState,
      open: () => {},
      close: () => {},
      toggle: () => {},
      clear: () => {},
      dispatch: (() => {}) as Dispatch<KaiActionType>,
    };
  }
  const { state, dispatch } = ctx;

  // Auto-restore from localStorage on first render
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const session = _loadPersistedSession();
    if (session && session.messages.length > 0) {
      dispatch({
        type: "RESTORE",
        messages: session.messages,
        conversationId: session.conversationId,
      });
    }
  }, [dispatch]);

  // Auto-persist when messages or conversationId change
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // Don't persist while streaming
    const hasStreaming = state.messages.some((m) => m.isStreaming);
    if (!hasStreaming && state.messages.length > 0) {
      _persistSession(state.messages, state.conversationId);
    }
  }, [state.messages, state.conversationId]);

  return {
    ...state,
    open: () => dispatch({ type: "OPEN" }),
    close: () => dispatch({ type: "CLOSE" }),
    toggle: () => dispatch({ type: "TOGGLE" }),
    clear: () => dispatch({ type: "CLEAR" }),
    dispatch,
  };
}

/* ------------------------------------------------------------------ */
/*  ask() — sends a query and streams the response                     */
/* ------------------------------------------------------------------ */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function kaiAsk(
  dispatch: Dispatch<KaiActionType>,
  query: string,
  context?: { page?: string },
  conversationId?: string | null
) {
  // Add user message
  const userMsg: KaiMessage = {
    id: uid(),
    role: "user",
    content: query,
    createdAt: new Date().toISOString(),
  };
  dispatch({ type: "ADD_MESSAGE", msg: userMsg });
  dispatch({ type: "SET_THINKING", value: true });

  // Create placeholder assistant message
  const assistantMsg: KaiMessage = {
    id: uid(),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    isStreaming: true,
  };
  dispatch({ type: "ADD_MESSAGE", msg: assistantMsg });

  try {
    const body = {
      query,
      context: context || {},
      stream: true,
      conversation_id: conversationId || undefined,
    };

    const res = await fetch("/api/ai/copilot/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Request failed");
      dispatch({
        type: "UPDATE_LAST_ASSISTANT",
        content: `Sorry, I couldn't process that. ${errText}`,
        done: true,
      });
      return;
    }

    const contentType = res.headers.get("content-type") || "";

    // SSE stream
    if (contentType.includes("text/event-stream") && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "chunk" && parsed.content) {
              accumulated += parsed.content;
              dispatch({
                type: "UPDATE_LAST_ASSISTANT",
                content: accumulated,
                done: false,
              });
            } else if (parsed.type === "done") {
              accumulated = parsed.full_answer || accumulated;
              // Save conversation_id for multi-turn
              if (parsed.conversation_id) {
                dispatch({ type: "SET_CONVERSATION_ID", id: parsed.conversation_id });
              }
              dispatch({
                type: "UPDATE_LAST_ASSISTANT",
                content: accumulated,
                done: true,
              });
            } else if (parsed.type === "error" && parsed.message) {
              accumulated += `\n\n⚠️ ${parsed.message}`;
              dispatch({
                type: "UPDATE_LAST_ASSISTANT",
                content: accumulated,
                done: true,
              });
            } else if (parsed.type === "action" && parsed.action) {
              // Reject external/javascript URLs for navigate actions
              if (parsed.action.type === "navigate" && parsed.action.href) {
                if (!parsed.action.href.startsWith("/")) {
                  break;
                }
              }
              dispatch({ type: "SET_ACTION", action: parsed.action });
            } else if (parsed.type === "confirmation" && parsed.confirmation) {
              dispatch({
                type: "SET_CONFIRMATION",
                confirmation: {
                  id: parsed.confirmation.id,
                  toolName: parsed.confirmation.tool_name,
                  summary: parsed.confirmation.summary,
                  status: "pending",
                },
              });
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // Ensure done state
      dispatch({
        type: "UPDATE_LAST_ASSISTANT",
        content: accumulated || "Done.",
        done: true,
      });
    } else {
      // Non-streaming JSON fallback
      const json = await res.json();
      const answer = json.answer || json.full_answer || JSON.stringify(json);
      if (json.conversation_id) {
        dispatch({ type: "SET_CONVERSATION_ID", id: json.conversation_id });
      }
      // Handle confirmation in non-streaming response
      if (json.pending_confirmation) {
        dispatch({
          type: "SET_CONFIRMATION",
          confirmation: {
            id: json.pending_confirmation.id,
            toolName: json.pending_confirmation.tool_name,
            summary: json.pending_confirmation.summary,
            status: "pending",
          },
        });
      }
      dispatch({ type: "UPDATE_LAST_ASSISTANT", content: answer, done: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    dispatch({
      type: "UPDATE_LAST_ASSISTANT",
      content: `Connection error: ${msg}`,
      done: true,
    });
  }
}
