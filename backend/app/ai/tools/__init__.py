# AI Tool registry – extensible tool system for the Kai copilot agent.
#
# Tools are decorated functions registered into a global registry.  The agent
# core dynamically builds the OpenAI function-calling schema from the registry
# and routes LLM tool-call requests to the matching implementation.
#
# Categories:
#   read   – safe, read-only queries.  No confirmation needed.
#   write  – mutating operations.  Require user confirmation before execution.
#   compound – multi-step orchestrations composed of other tools.

from .registry import (  # noqa: F401
    ToolDef,
    register_tool,
    get_tool,
    get_all_tools,
    get_tools_for_user,
    build_openai_tools_array,
    execute_tool,
    ToolResult,
)
