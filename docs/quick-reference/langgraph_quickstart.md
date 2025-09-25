## Open Edison + LangGraph Quick Start

See LangGraph docs for the more about LangGraph and associated libraries:

- <https://langchain-ai.github.io/langgraph/>

### 1) Install

```bash
pip install -U langgraph langchain-openai open-edison
```

Set environment variables:

- `OPENAI_API_KEY` = your OpenAI key
- `OPEN_EDISON_API_KEY` = your Open Edison API key
- `OPEN_EDISON_API_BASE` = `http://localhost:3001` (default)

### 2) Start the Open Edison server

```bash
make run
```

Access the Open Edison dashboard: `http://localhost:3001/dashboard`

### 3) Track your tools and run a langgraph agent

```python
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from open_edison import Edison

# Edison reads OPEN_EDISON_API_BASE / OPEN_EDISON_API_KEY from env
edison = Edison()

@tool
@edison.track() # auto-names: agent_web_search
def web_search(query: str, max_results: int = 3) -> str:
    """Return up to N result URLs (demo)."""
    return "https://docs.python.org/3/"

@tool
@edison.track() # auto-names: agent_fetch_url
def fetch_url(url: str, max_chars: int = 1000) -> str:
    """Fetch and return the first max_chars of the page."""
    import httpx
    return httpx.get(url, follow_redirects=True, timeout=10).text[:max_chars]

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
agent = create_react_agent(model=llm, tools=[web_search, fetch_url])

result = agent.invoke({
    "messages": [("user", "Fetch the first 1000 chars of the CPython docs homepage.")]
})
print(result["messages"][-1].content)
```

### Minimal integration diff (4 lines)

```bash
diff agent_no_firewall.py agent_firewall.py
```

```text
examples/langgraph/agent_no_firewall.py                     examples/langgraph/agent_firewall.py                       
                                                                                                                        
                                                            from open_edison import Edison                
                                                            edison = Edison()                                           
                                                                                                                        
@tool                                                       @tool                                                       
                                                            @edison.track()  # auto-names: agent_web_search            
def web_search(query: str, _max_results: int = 3) -> str:   def web_search(query: str, _max_results: int = 3) -> str:  
---                                                         ---                                                        
@tool                                                       @tool                                                       
                                                            @edison.track()  # auto-names: agent_fetch_url             
def fetch_url(url: str, _max_chars: int = 1000) -> str:     def fetch_url(url: str, _max_chars: int = 1000) -> str:    
```

### 4) Permissions (server-side)

Tracked tools are named `agent_<function_name>`. Configure under the `agent` section in `tool_permissions.json`:

```json
{
  "agent": {
    "web_search": {
      "enabled": true,
      "write_operation": false,
      "read_private_data": false,
      "read_untrusted_public_data": true,
      "acl": "SECRET"
    },
    "fetch_url": {
      "enabled": true,
      "write_operation": false,
      "read_private_data": true,
      "read_untrusted_public_data": true,
      "acl": "SECRET"
    }
  }
}
```

Open Edison enforces:

- Lethal trifecta prevention (private data + untrusted exposure + write)
- ACL write-downgrade blocking
- Manual approvals via the dashboard

### 5) What gets recorded

- Pre-call: `/agent/begin` (gating + possible approval wait)
- Post-call: `/agent/end` (status, duration, result preview)
- Arguments/results are captured as JSON previews (capped at 1,000,000 chars).

### 6) Troubleshooting

- 401 Invalid API key: check `OPEN_EDISON_API_KEY` and server is running.
- Tool blocked: verify `tool_permissions.json` and approve in dashboard if needed.
