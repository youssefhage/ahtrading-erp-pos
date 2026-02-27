"use client";

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
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
};

export type KaiAction =
  | { type: "navigate"; href: string; label?: string }
  | { type: "info"; message: string };

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
    "Show overdue invoices",
    "Sales trend this week",
  ],
  "/inventory": [
    "Which items are running low?",
    "Show expiring batches",
    "Reorder suggestions",
  ],
  "/purchasing": [
    "What should I reorder?",
    "Show supplier invoice holds",
    "3-way match status",
  ],
  "/accounting": [
    "Period close status?",
    "Unreconciled items",
    "GL anomalies this month",
  ],
  "/catalog": [
    "Items with low margin",
    "Data quality issues",
    "Pricing recommendations",
  ],
  "/automation": [
    "How many pending recommendations?",
    "Failed AI actions today",
    "Show AI agent health",
  ],
};

const DEFAULT_SUGGESTIONS = [
  "What needs my attention?",
  "Show system health",
  "Help me navigate",
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
  | { type: "SET_THINKING"; value: boolean }
  | { type: "CLEAR" };

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
    case "SET_THINKING":
      return { ...state, isThinking: action.value };
    case "CLEAR":
      return { ...state, messages: [], conversationId: null, isThinking: false };
    default:
      return state;
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
  context?: { page?: string }
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
              dispatch({ type: "SET_ACTION", action: parsed.action });
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
