# agents.py
# Four simple LangGraph agents with dummy tools tracked by Open Edison.
#
# SETUP: Ensure agent configs exist in your Open Edison config directory:
# - When running via `make run`: Configs are in dev_config_dir/agents/
# - When running standalone server: Configs should be in ~/Library/Application Support/Open Edison/agents/
#
# Agent configs for this example:
# - hr_assistant (restrictive - blocks writes)
# - eng_copilot (permissive - uses base)
# - rd_researcher (mixed - blocks delete only)
# - finance_analyst (restrictive - blocks all writes)

import asyncio
from typing import Annotated, Any, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import AnyMessage, add_messages
from tqdm.auto import tqdm

from src.langgraph_integration.edison import Edison

# Create Edison trackers for each agent type (with identity set at instance level)
edison_hr = Edison(agent_name="hr_assistant", agent_type="hr")
edison_eng = Edison(agent_name="eng_copilot", agent_type="engineering")
edison_rd = Edison(agent_name="rd_researcher", agent_type="rd")
edison_fin = Edison(agent_name="finance_analyst", agent_type="finance")

# -------------------------
# Generic agent scaffolding
# -------------------------


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    role: str


def build_agent(
    *,
    llm: BaseChatModel,
    role_name: str,
    system_instructions: str,
    tools: list[Any],
):
    """Return a compiled LangGraph agent for a given role with provided tools."""
    # Bind the tools to the model for function/tool-calling
    model = llm.bind_tools(tools)
    tool_map: dict[str, Any] = {t.name: t for t in tools}  # name -> Tool

    def call_model(state: AgentState):
        if not state["messages"] or not isinstance(state["messages"][0], SystemMessage):
            # Ensure a role-specific system message is at the front
            sys = SystemMessage(content=system_instructions)
            msgs = [sys] + state["messages"]
        else:
            msgs = state["messages"]
        ai = model.invoke(msgs)
        return {"messages": [ai]}

    def execute_tools(state: AgentState):
        """Run any tool calls produced by the last AI message."""
        last = state["messages"][-1]
        if not hasattr(last, "tool_calls") or not last.tool_calls:
            return {}
        outs: list[ToolMessage] = []
        for tc in last.tool_calls:
            name = tc["name"]
            args = tc.get("args", {}) or {}
            tool_obj = tool_map[name]
            result = tool_obj.invoke(args)
            outs.append(
                ToolMessage(
                    tool_call_id=tc.get("id", name),
                    name=name,
                    content=str(result),
                )
            )
        return {"messages": outs}

    def should_continue(state: AgentState):
        last = state["messages"][-1]
        return "tools" if (hasattr(last, "tool_calls") and last.tool_calls) else "end"

    graph = StateGraph(AgentState)
    graph.add_node("model", call_model)
    graph.add_node("tools", execute_tools)

    graph.add_edge(START, "model")
    graph.add_conditional_edges("model", should_continue, {"tools": "tools", "end": END})
    graph.add_edge("tools", "model")

    return graph.compile()


# -------------------------
# HR Agent (role & tools)
# -------------------------


@tool
@edison_hr.track()
def hr_get_employee_profile(employee_id: str) -> str:
    """Fetch a basic employee profile by employee_id. Dummy data only."""
    return f"[HR] Profile for {employee_id}: name=Alex Example, dept=Engineering, salary=£85k, email=alex@example.com"


@tool
@edison_hr.track()
def hr_lookup_policy(topic: str) -> str:
    """Look up a human resources policy snippet by topic. Dummy data only."""
    snippets = {
        "leave": "Employees receive 25 days annual leave plus public holidays.",
        "conduct": "All employees must follow the Code of Conduct and comply with local law.",
        "benefits": "Eligible for private healthcare, pension match, and learning stipend.",
    }
    return f"[HR] Policy on {topic}: {snippets.get(topic.lower(), 'No entry found; refer to HR handbook.')}"


@tool
@edison_hr.track()
def hr_create_case(employee_id: str, category: str, note: str) -> str:
    """Open an HR case/ticket for an employee. Returns a dummy case ID."""
    return f"[HR] Opened case #{hash((employee_id, category, note)) % 10000} for {employee_id} ({category})."


def make_hr_agent(llm: BaseChatModel):
    system = (
        "You are the HR Assistant. You answer HR questions, retrieve policy snippets, "
        "and open HR cases when appropriate. Use tools faithfully; keep answers concise."
    )
    return build_agent(
        llm=llm,
        role_name="hr",
        system_instructions=system,
        tools=[hr_get_employee_profile, hr_lookup_policy, hr_create_case],
    )


# -------------------------------
# Engineering Agent (role & tools)
# -------------------------------


@tool
@edison_eng.track()
def eng_search_codebase(query: str) -> str:
    """Search the codebase for a keyword and return dummy file hits."""
    hits = [
        "services/api/user_service.py:42",
        "infra/ci/pipeline.yaml:13",
        "frontend/src/components/NavBar.tsx:77",
    ]
    return f"[ENG] Found {len(hits)} hits for '{query}': {', '.join(hits)}"


@tool
@edison_eng.track()
def eng_open_pr(repo: str, title: str, body: str) -> str:
    """Open a pull request with a title/body. Returns a dummy PR URL."""
    pr_id = abs(hash((repo, title))) % 5000
    return f"[ENG] Opened PR {pr_id} in {repo}: https://example.git/{repo}/pull/{pr_id}"


@tool
@edison_eng.track()
def eng_ci_status(pipeline: str) -> str:
    """Get the last CI result for a pipeline. Dummy values."""
    return f"[ENG] Pipeline '{pipeline}' status: SUCCESS (duration: 4m32s)"


def make_engineering_agent(llm: BaseChatModel):
    system = (
        "You are the Engineering Assistant. You help search code, open pull requests, "
        "and check CI status. Prefer precise, technical responses."
    )
    return build_agent(
        llm=llm,
        role_name="engineering",
        system_instructions=system,
        tools=[eng_search_codebase, eng_open_pr, eng_ci_status],
    )


# -------------------------
# R&D Agent (role & tools)
# -------------------------


@tool
@edison_rd.track()
def rnd_lit_search(topic: str) -> str:
    """Search recent literature by topic; returns dummy citations."""
    results = [
        f"{topic} — Preprint: Methods & Benchmarks (2025)",
        f"{topic} — Journal: Practical Applications (2024)",
        f"{topic} — Workshop: Open Problems (2023)",
    ]
    return "[R&D] Top refs: " + " | ".join(results)


@tool
@edison_rd.track()
def rnd_get_dataset(name: str) -> str:
    """Return dummy dataset card metadata by name."""
    return (
        f"[R&D] Dataset '{name}': n_samples=10,000; modality=text; license=CC-BY; "
        f"intended_use=prototype; known_issues=class imbalance."
    )


@tool
@edison_rd.track()
def rnd_log_experiment(name: str, params_json: str) -> str:
    """Log an experiment run with params as JSON string. Returns a dummy run ID."""
    run_id = abs(hash((name, params_json))) % 100000
    return f"[R&D] Logged experiment '{name}' as run_id={run_id} with params={params_json}"


def make_rnd_agent(llm: BaseChatModel):
    system = (
        "You are the R&D Assistant. You help with literature scans, dataset discovery, "
        "and experiment logging. Provide succinct, reference-style answers."
    )
    return build_agent(
        llm=llm,
        role_name="r_and_d",
        system_instructions=system,
        tools=[rnd_lit_search, rnd_get_dataset, rnd_log_experiment],
    )


# ----------------------------
# Finance Agent (role & tools)
# ----------------------------


@tool
@edison_fin.track()
def fin_get_budget(department: str) -> str:
    """Return dummy department budget status."""
    return f"[FIN] {department} budget: allocated=£2.0M; spent=£1.35M; remaining=£0.65M; FY=2025."


@tool
@edison_fin.track()
def fin_submit_expense(employee_id: str, amount: float, description: str) -> str:
    """Submit an expense claim. Returns a dummy expense ID."""
    expense_id = abs(hash((employee_id, amount, description))) % 80000
    return f"[FIN] Submitted expense #{expense_id} for {employee_id}: £{amount:.2f} — {description}"


@tool
@edison_fin.track()
def fin_generate_invoice(customer_id: str, amount: float) -> str:
    """Generate an invoice for a customer. Returns a dummy invoice number."""
    invoice_no = 100000 + (abs(hash((customer_id, amount))) % 900000)
    return f"[FIN] Invoice {invoice_no} for customer {customer_id}: £{amount:.2f} (NET30)"


def make_finance_agent(llm: BaseChatModel):
    system = (
        "You are the Finance Assistant. You answer budget queries, submit expenses, "
        "and generate invoices. Keep responses clear and numeric where possible."
    )
    return build_agent(
        llm=llm,
        role_name="finance",
        system_instructions=system,
        tools=[fin_get_budget, fin_submit_expense, fin_generate_invoice],
    )


# -------------------------
# Main test runner
# -------------------------


async def test_agent(
    agent_name: str, agent, test_prompts: list[str], pbar: tqdm | None = None
) -> str:
    """Test an agent with multiple prompts designed to trigger tool calls.

    Returns captured output as a string instead of printing directly.
    """
    output_lines = []
    output_lines.append(f"\n{'=' * 80}")
    output_lines.append(f"Testing {agent_name.upper()} Agent")
    output_lines.append(f"{'=' * 80}")

    for i, prompt in enumerate(test_prompts, 1):
        output_lines.append(f"\n--- Test {i}/{len(test_prompts)} ---")
        output_lines.append(f"Prompt: {prompt}")
        output_lines.append("\nAgent response:")

        # Update progress bar for LLM call
        if pbar is not None:
            pbar.set_postfix_str(f"test {i}/{len(test_prompts)} - LLM call")
            pbar.update(1)

        result = await agent.ainvoke({"messages": [HumanMessage(content=prompt)]})

        # Capture all messages (including tool calls and responses)
        for msg in result["messages"]:
            if isinstance(msg, ToolMessage):
                output_lines.append(f"  🔧 Tool: {msg.name}")
                output_lines.append(f"     Result: {msg.content}")
                # Update progress bar for each tool call
                if pbar is not None:
                    pbar.set_postfix_str(f"test {i}/{len(test_prompts)} - {msg.name}")
                    pbar.update(1)
            elif hasattr(msg, "content") and msg.content:
                output_lines.append(f"  💬 {msg.content}")

        output_lines.append(f"\n  Total messages in conversation: {len(result['messages'])}")

    return "\n".join(output_lines)


def build_prompts(quick_mode: bool = False):
    """Build prompts dynamically based on quick/slow mode."""

    # HR Agent test data
    hr_data = [
        {
            "employees": ["E123", "E456", "E789"],
            "policies": ["leave", "benefits", "conduct"],
            "action": "open cases for each employee regarding their respective policy questions",
        },
        {
            "employees": ["E999"],
            "policies": ["leave", "benefits", "conduct"],
            "action": "create a comprehensive case documenting all findings",
        },
        {
            "employees": ["E100", "E200", "E300"],
            "policies": ["leave", "benefits"],
            "action": "open individual cases for annual leave planning for each",
        },
        {
            "employees": ["E555", "E666"],
            "policies": ["conduct", "benefits"],
            "action": "create cases for both employees about policy clarification",
        },
    ]

    # Engineering Agent test data
    eng_data = [
        {
            "search_terms": ["authentication", "database", "user", "api", "security"],
            "pipelines": ["main-pipeline", "test-pipeline"],
            "repos": ["backend-api", "frontend", "infra"],
        },
        {
            "search_terms": ["error", "exception", "bug"],
            "pipelines": ["main-pipeline", "test-pipeline", "deploy-pipeline"],
            "repos": ["backend-api", "infra", "frontend"],
        },
        {
            "search_terms": ["legacy", "deprecated", "old"],
            "pipelines": ["main-pipeline", "test-pipeline", "deploy-pipeline"],
            "repos": ["backend-api", "infra"],
        },
        {
            "search_terms": ["password", "token", "secret", "key"],
            "pipelines": ["main-pipeline", "test-pipeline"],
            "repos": ["backend-api", "frontend", "infra"],
        },
    ]

    # R&D Agent test data
    rnd_data = [
        {
            "topics": [
                "transformer models",
                "diffusion models",
                "reinforcement learning",
                "few-shot learning",
            ],
            "datasets": ["GLUE", "ImageNet", "COCO", "Atari-2600"],
            "experiments": ["bert-ft", "diffusion-train", "ppo-rl", "few-shot"],
        },
        {
            "topics": ["vision transformers", "multimodal learning"],
            "datasets": ["ImageNet", "COCO"],
            "experiments": ["vit-base", "vit-large", "clip-training"],
        },
        {
            "topics": ["Adam optimizer", "SGD variants", "learning rate schedules"],
            "datasets": ["CIFAR-10", "ImageNet"],
            "experiments": ["adam-exp", "sgd-exp", "lr-sched"],
        },
        {
            "topics": ["generative adversarial networks", "stable diffusion", "DDPM"],
            "datasets": ["CelebA", "LAION"],
            "experiments": ["gan-train", "sd-train", "ddpm-train"],
        },
    ]

    # Finance Agent test data
    fin_data = [
        {
            "departments": ["Engineering", "R&D", "Finance", "Sales", "Marketing"],
            "employees": ["E123", "E456", "E789"],
            "customers": ["C001", "C002", "C003", "C004"],
        },
        {
            "departments": ["Engineering", "R&D", "Finance", "HR", "Operations"],
            "employees": ["E100", "E200", "E300", "E400"],
            "customers": ["C010", "C011", "C012", "C013", "C014", "C015"],
        },
        {
            "departments": ["Engineering", "R&D", "Finance", "HR", "Sales"],
            "employees": ["E001", "E002", "E003", "E004", "E005"],
            "customers": ["C020", "C021", "C022", "C023", "C024", "C025"],
        },
        {
            "departments": ["Engineering", "R&D", "Finance", "HR", "Operations"],
            "employees": ["E010", "E011", "E012", "E013", "E014", "E015"],
            "customers": ["C030", "C031", "C032", "C033", "C034", "C035", "C036"],
        },
    ]

    # Apply quick mode filter (use only first element of each list)
    def data_slicer(x: dict[str, Any]) -> dict[str, Any]:
        return {k: v[:1] if isinstance(v, list) else v for k, v in x.items()}

    if quick_mode:
        hr_data, eng_data, rnd_data, fin_data = (
            [data_slicer(d) for d in data] for data in (hr_data, eng_data, rnd_data, fin_data)
        )

    # Build HR prompts
    hr_prompts = [
        f"I need employee profiles for {', '.join(d['employees'])}. Look up policies: {', '.join(d['policies'])}. Then {d['action']}."
        for d in hr_data
    ]

    # Build Engineering prompts
    eng_prompts = [
        f"Search codebase for: {', '.join(d['search_terms'])}. Check CI status for {', '.join(d['pipelines'])}. Open PRs in {', '.join(d['repos'])}."
        for d in eng_data
    ]

    # Build R&D prompts
    rnd_prompts = [
        f"Search literature on: {', '.join(d['topics'])}. Get datasets: {', '.join(d['datasets'])}. Log experiments: {', '.join(d['experiments'])}."
        for d in rnd_data
    ]

    # Build Finance prompts
    fin_prompts = [
        f"Get budgets for {', '.join(d['departments'])}. Submit expenses for {', '.join(d['employees'])}. Generate invoices for {', '.join(d['customers'])}."
        for d in fin_data
    ]

    return hr_prompts, eng_prompts, rnd_prompts, fin_prompts


async def main(quick_mode: bool = False):
    """Run all four agents with comprehensive test scenarios in parallel."""
    from dotenv import load_dotenv
    from langchain_openai import ChatOpenAI  # type: ignore[reportMissingTypeStubs]

    # Load environment variables
    load_dotenv()

    # Initialize LLM
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)  # type: ignore[reportUnknownVariableType]

    # Create all agents
    hr_agent = make_hr_agent(llm)
    eng_agent = make_engineering_agent(llm)
    rnd_agent = make_rnd_agent(llm)
    fin_agent = make_finance_agent(llm)

    # Build prompts based on mode
    hr_prompts, eng_prompts, rnd_prompts, fin_prompts = build_prompts(quick_mode)

    # Create separate progress bars for each agent (stacked)
    print("🚀 Running all agents in parallel...\n")

    # Create 4 progress bars with positions
    hr_pbar = tqdm(
        desc="👥 HR",
        position=0,
        unit="op",
        colour="blue",
        bar_format="{desc}: {n} ops | {rate_fmt} | {postfix}",
        leave=True,
    )
    eng_pbar = tqdm(
        desc="⚙️  Engineering",
        position=1,
        unit="op",
        colour="green",
        bar_format="{desc}: {n} ops | {rate_fmt} | {postfix}",
        leave=True,
    )
    rnd_pbar = tqdm(
        desc="🔬 R&D",
        position=2,
        unit="op",
        colour="magenta",
        bar_format="{desc}: {n} ops | {rate_fmt} | {postfix}",
        leave=True,
    )
    fin_pbar = tqdm(
        desc="💰 Finance",
        position=3,
        unit="op",
        colour="yellow",
        bar_format="{desc}: {n} ops | {rate_fmt} | {postfix}",
        leave=True,
    )

    try:
        # Run all tests concurrently using asyncio.gather
        results = await asyncio.gather(
            test_agent("HR", hr_agent, hr_prompts, hr_pbar),
            test_agent("Engineering", eng_agent, eng_prompts, eng_pbar),
            test_agent("R&D", rnd_agent, rnd_prompts, rnd_pbar),
            test_agent("Finance", fin_agent, fin_prompts, fin_pbar),
        )

        # Mark all as complete
        hr_pbar.set_description("👥 HR ✅")
        eng_pbar.set_description("⚙️  Engineering ✅")
        rnd_pbar.set_description("🔬 R&D ✅")
        fin_pbar.set_description("💰 Finance ✅")
    finally:
        # Close all progress bars
        hr_pbar.close()
        eng_pbar.close()
        rnd_pbar.close()
        fin_pbar.close()

    # Print all captured outputs
    print()  # Add spacing after progress bar
    for result in results:
        print(result)

    print(f"\n{'=' * 80}")
    print("✅ All agent tests completed!")
    print(f"{'=' * 80}\n")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run 4 role-based LangGraph agents in parallel")
    parser.add_argument(
        "--slow",
        action="store_true",
        help="Run in slow/full mode with all objects (default: quick mode with only first object)",
    )
    args = parser.parse_args()

    # Run in quick mode by default, slow mode if --slow is passed
    quick_mode = not args.slow

    mode_str = "🐌 SLOW MODE (all objects)" if args.slow else "⚡ QUICK MODE (first object only)"
    print(f"\n{mode_str}\n")

    asyncio.run(main(quick_mode=quick_mode))
