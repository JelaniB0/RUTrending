import json
import asyncio
import time
from pathlib import Path
from typing import Optional
import sys
sys.path.append(str(Path(__file__).parent.parent / "agents"))

from pipeline import run_trend_analysis

RESULTS_DIR = Path(__file__).parent.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

CONDITIONS = [
    {"name": "Full Pipeline",       "disabled": []},
    {"name": "No Location Agent",   "disabled": ["location"]},
    {"name": "No Person Agent",     "disabled": ["person"]},
    {"name": "Core Only",           "disabled": ["location", "person"]},
]

TEST_QUERIES = [
    {"campus": "Busch",       "query": "What are the most concerning trends this semester?"},
    {"campus": "Livingston",  "query": "Which buildings need the most attention?"},
    {"campus": "College Ave", "query": "Are there any repeat incident locations?"},
    {"campus": None,          "query": "What patterns exist across all campuses?"},
    {"campus": "Cook/Douglass", "query": "What interventions should be prioritized?"},
]

JUDGE_PROMPT = """
You are an expert evaluator of institutional trend analysis reports.

Score the following report on these 5 dimensions (each 1-5):
- accuracy: Are statistics consistent and internally coherent?
- specificity: Does it reference specific buildings, locations, numbers?
- actionability: Does it give concrete, implementable recommendations?
- completeness: Does it cover all major trend dimensions?
- detail: Does it include granular location or person-level specifics?

REPORT:
{report}

Return ONLY a JSON object like:
{{"accuracy": 4, "specificity": 3, "actionability": 5, "completeness": 4, "detail": 3}}
No explanation, no markdown.
"""

async def judge_report(report: str) -> dict:
    import os
    from openai import AsyncOpenAI
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")

    client = AsyncOpenAI(
        api_key=os.environ["GITHUB_TOKEN"],
        base_url="https://models.inference.ai.azure.com",
    )
    response = await client.chat.completions.create(
        model="gpt-4.1",
        messages=[{"role": "user", "content": JUDGE_PROMPT.format(report=report)}],
        temperature=0,
    )
    import re
    raw = response.choices[0].message.content or "{}"
    raw = re.sub(r'```json|```', '', raw).strip()
    return json.loads(raw)

def next_run_path(stem: str, suffix: str) -> Path:
    n = 1
    while True:
        path = RESULTS_DIR / f"{stem}{n}{suffix}"
        if not path.exists():
            return path
        n += 1

async def main():
    dims = ["accuracy", "specificity", "actionability", "completeness", "detail"]
    condition_results = []

    for condition in CONDITIONS:
        print(f"\n{'='*60}")
        print(f"CONDITION: {condition['name']} (disabled: {condition['disabled'] or 'none'})")
        print('='*60)

        scores_per_dim = {d: [] for d in dims}
        times = []

        for i, trial in enumerate(TEST_QUERIES):
            print(f"\n  Trial {i+1}/5 — campus={trial['campus']}, query={trial['query'][:50]}...")

            t0 = time.perf_counter()
            result = await run_trend_analysis(
                campus=trial["campus"],
                user_query=trial["query"],
                disabled_agents=condition["disabled"],
            )
            elapsed = time.perf_counter() - t0
            times.append(elapsed)

            report = result.get("final_report", "")
            scores = await judge_report(report)
            print(f"    Scores: {scores} | Time: {elapsed:.1f}s")

            for d in dims:
                scores_per_dim[d].append(scores.get(d, 0))

        avg_scores = {d: round(sum(scores_per_dim[d]) / len(scores_per_dim[d]), 2) for d in dims}
        avg_time   = round(sum(times) / len(times), 1)

        condition_results.append({
            "condition":  condition["name"],
            "disabled":   condition["disabled"],
            "avg_scores": avg_scores,
            "avg_time":   avg_time,
            "n_trials":   len(TEST_QUERIES),
        })

        print(f"\n  Avg scores: {avg_scores}")
        print(f"  Avg time:   {avg_time}s")

    # save results
    out_path = next_run_path("exp2_ablation", ".json")
    out_path.write_text(json.dumps({
        "conditions": condition_results,
        "n_trials_per_condition": len(TEST_QUERIES),
    }, indent=2))
    print(f"\nSaved to {out_path}")

    # generate charts
    generate_charts(condition_results, dims)

def generate_charts(condition_results: list, dims: list):
    import matplotlib.pyplot as plt
    import numpy as np

    conditions = [c["condition"] for c in condition_results]
    colors     = ["#4A90D9", "#E07B54", "#F5A623", "#7ED321", "#9B59B6"]

    # ── Line graph: score per dimension across conditions ─────────────────────
    fig, ax = plt.subplots(figsize=(12, 6))

    for i, dim in enumerate(dims):
        scores = [c["avg_scores"][dim] for c in condition_results]
        ax.plot(conditions, scores, marker='o', linewidth=2.5,
                markersize=8, label=dim.capitalize(), color=colors[i])
        for j, score in enumerate(scores):
            ax.annotate(f"{score:.2f}", (conditions[j], score),
                        textcoords="offset points", xytext=(0, 10),
                        ha='center', fontsize=8)

    ax.set_ylabel("Average Score (0–5)")
    ax.set_title("Ablation Study: Score Degradation by Condition")
    ax.set_ylim(0, 6)
    ax.legend(loc="lower left")
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "exp2_ablation_scores.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("Saved exp2_ablation_scores.png")

    # ── Bar chart: execution time per condition ────────────────────────────────
    fig, ax = plt.subplots(figsize=(8, 5))
    times = [c["avg_time"] for c in condition_results]
    bars  = ax.bar(conditions, times, color=["#4A90D9", "#E07B54", "#F5A623", "#7ED321"])
    ax.bar_label(bars, fmt="%.1fs", padding=3, fontsize=10)
    ax.set_ylabel("Avg Execution Time (seconds)")
    ax.set_title("Ablation Study: Execution Time per Condition")
    ax.set_ylim(0, max(times) + 10)
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "exp2_ablation_time.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("Saved exp2_ablation_time.png")

if __name__ == "__main__":
    asyncio.run(main())