"""
Tool registry for the Kai AI agent.

Each tool is a plain Python function decorated with ``@register_tool``.
The decorator captures metadata (category, required permission, whether
confirmation is needed) and auto-generates the OpenAI function-calling
schema from the function's type-hints and docstring.

Usage::

    @register_tool(
        category="write",
        requires_confirmation=True,
        permission="purchases:write",
    )
    def create_purchase_order(
        supplier_name: str,
        items: list[dict],
        warehouse: str = "Main",
    ) -> ToolResult:
        \"""Create a purchase order for the specified supplier.\"""
        ...
        return ToolResult(data={...}, message="PO-2026-0042 created.")
"""
from __future__ import annotations

import inspect
import logging
import typing
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------

@dataclass
class ToolResult:
    """Standard return type for every tool implementation."""
    data: dict[str, Any] = field(default_factory=dict)
    message: str = ""
    error: str = ""
    # For write tools: the confirmation proposal sent *before* execution.
    confirmation_prompt: str = ""
    # Populated by the registry wrapper for navigate-style side-effects.
    actions: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ToolDef:
    """Internal descriptor for a registered tool."""
    name: str
    description: str
    category: str                       # "read" | "write" | "compound"
    requires_confirmation: bool
    permission: Optional[str]           # e.g. "purchases:write"
    parameters_schema: dict[str, Any]   # OpenAI-style JSON Schema
    fn: Callable[..., ToolResult]
    # Human-readable labels for the confirmation flow
    confirm_verb: str = "Execute"       # e.g. "Create", "Update", "Approve"
    confirm_entity: str = ""            # e.g. "Purchase Order"


# ---------------------------------------------------------------------------
# Global registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, ToolDef] = {}


def register_tool(
    *,
    category: str = "read",
    requires_confirmation: bool = False,
    permission: Optional[str] = None,
    confirm_verb: str = "Execute",
    confirm_entity: str = "",
    parameter_overrides: dict[str, dict[str, Any]] | None = None,
) -> Callable:
    """
    Decorator that registers a function as an agent tool.

    The function *must* return a ``ToolResult``.  Its first two positional
    arguments are always injected by the executor and should **not** appear
    in the OpenAI schema:

    - ``company_id: str``
    - ``user: dict``

    All subsequent parameters become LLM-visible tool parameters.
    """
    def decorator(fn: Callable) -> Callable:
        name = fn.__name__
        doc = (inspect.getdoc(fn) or name.replace("_", " ").title()).strip()
        # Take the first paragraph as description.
        description = doc.split("\n\n")[0].replace("\n", " ").strip()

        params_schema = _build_params_schema(fn, parameter_overrides or {})

        tool = ToolDef(
            name=name,
            description=description,
            category=category,
            requires_confirmation=requires_confirmation,
            permission=permission,
            parameters_schema=params_schema,
            fn=fn,
            confirm_verb=confirm_verb,
            confirm_entity=confirm_entity,
        )
        _REGISTRY[name] = tool
        return fn

    return decorator


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def get_tool(name: str) -> Optional[ToolDef]:
    return _REGISTRY.get(name)


def get_all_tools() -> list[ToolDef]:
    return list(_REGISTRY.values())


def get_tools_for_user(user_permissions: set[str] | None = None) -> list[ToolDef]:
    """Return tools the given user is allowed to invoke."""
    if user_permissions is None:
        # No permission info → return read + compound tools (both are safe/read-only).
        return [t for t in _REGISTRY.values() if t.category in ("read", "compound")]
    out = []
    for t in _REGISTRY.values():
        if t.permission is None or t.permission in user_permissions:
            out.append(t)
    return out


def build_openai_tools_array(
    tools: list[ToolDef] | None = None,
) -> list[dict[str, Any]]:
    """Build the ``tools`` array for the OpenAI Chat Completions API."""
    tools = tools if tools is not None else get_all_tools()
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": _tool_description(t),
                "parameters": t.parameters_schema,
            },
        }
        for t in tools
    ]


def _tool_description(t: ToolDef) -> str:
    parts = [t.description]
    if t.requires_confirmation:
        parts.append(
            "(This action modifies data. You MUST present a clear confirmation "
            "summary to the user and wait for their explicit approval before "
            "calling this tool.  Include key details like names, quantities, "
            "and amounts in the summary.)"
        )
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def execute_tool(
    name: str,
    arguments: dict[str, Any],
    company_id: str,
    user: dict[str, Any],
    user_permissions: set[str] | None = None,
) -> ToolResult:
    """
    Execute a registered tool with the given arguments.

    ``company_id`` and ``user`` are injected as the first two positional
    arguments automatically.
    """
    tool = _REGISTRY.get(name)
    if tool is None:
        return ToolResult(error=f"Unknown tool: {name}")

    # Re-check permission at execution time (defense in depth)
    if tool.permission and user_permissions is not None:
        if tool.permission not in user_permissions:
            return ToolResult(error="Permission denied")

    try:
        result = tool.fn(company_id, user, **arguments)
        if not isinstance(result, ToolResult):
            # Graceful handling of tools that return plain dicts.
            if isinstance(result, dict):
                return ToolResult(data=result)
            return ToolResult(data={"result": result})
        return result
    except Exception as exc:
        logger.exception("Tool %s execution failed: %s", name, exc)
        return ToolResult(error="Tool execution failed. Please try again or contact support.")


# ---------------------------------------------------------------------------
# Schema builder – auto-generates JSON Schema from type hints
# ---------------------------------------------------------------------------

_PY_TO_JSON: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
}


def _build_params_schema(
    fn: Callable,
    overrides: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """
    Inspect function signature and produce an OpenAI-compatible JSON Schema
    for the parameters.  Skips ``company_id`` and ``user`` (always injected).
    """
    sig = inspect.signature(fn)
    hints = typing.get_type_hints(fn)

    properties: dict[str, Any] = {}
    required: list[str] = []

    skip = {"company_id", "user", "return"}
    for pname, param in sig.parameters.items():
        if pname in skip:
            continue
        hint = hints.get(pname, str)
        has_default = param.default is not inspect.Parameter.empty
        prop = _hint_to_json_schema(hint)
        # Apply docstring-derived description or override.
        if pname in overrides:
            prop.update(overrides[pname])
        properties[pname] = prop
        if not has_default:
            required.append(pname)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        schema["required"] = required
    return schema


def _hint_to_json_schema(hint: Any) -> dict[str, Any]:
    """Convert a Python type hint to a JSON Schema fragment."""
    origin = typing.get_origin(hint)

    # Optional[X] → nullable X
    if origin is typing.Union:
        args = [a for a in typing.get_args(hint) if a is not type(None)]
        if len(args) == 1:
            base = _hint_to_json_schema(args[0])
            return base
        return {"type": "string"}

    # list[X]
    if origin is list:
        inner_args = typing.get_args(hint)
        items_schema = _hint_to_json_schema(inner_args[0]) if inner_args else {"type": "string"}
        return {"type": "array", "items": items_schema}

    # dict[str, X]
    if origin is dict:
        return {"type": "object"}

    # Literal["a", "b"]
    if origin is typing.Literal:
        values = list(typing.get_args(hint))
        return {"type": "string", "enum": values}

    # Plain types
    if isinstance(hint, type) and hint in _PY_TO_JSON:
        return {"type": _PY_TO_JSON[hint]}

    # Fallback
    return {"type": "string"}
