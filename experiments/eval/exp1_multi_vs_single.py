"""
exp1_multi_vs_single.py — Experiment 1: Multi-Agent vs Single-Agent Output Quality

Hypothesis: The multi-agent pipeline produces higher quality trend analysis than
a single GPT-4.1 agent receiving the same raw data in one prompt.

Method:
- For each of N_TRIALS query scenarios, run both:
    * MULTI  — full pipeline via run_trend_analysis()
    * SINGLE — one GPT-4.1 call with all the same data stuffed into a single prompt
- Accuracy is scored PROGRAMMATICALLY (not by LLM) by checking:
    1. Cited report counts match ground truth exactly
    2. No fabricated building names
    3. No wrong campus attributions
- A separate GPT-4.1 "judge" agent scores 4 qualitative dimensions blindly (0–5):
    1. Specificity  — names buildings, campuses, locations; avoids vague generalities
    2. Actionability — recommendations are concrete and implementable
    3. Completeness — covers building, campus, alert, and escalation dimensions
    4. Detail       — goes beyond surface-level with specific locations and patterns
- Judge sees both outputs in randomized order (A/B) to avoid position bias
- Outputs, scores, and winner tallies saved to results/

Output:
- Console summary table
- results/exp1_quality.json  — full run data including outputs and scores
- results/exp1_quality.csv   — scores only, for easy analysis
- results/exp1_quality_chart.png
"""

import os
import sys
import json
import asyncio
import time
import csv
import random
import re
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).parent.parent / "agents"))

from pipeline import (
    run_trend_analysis,
    intake_agent,
    call_model,
    TrendState,
)

# ─── CONFIG ───────────────────────────────────────────────────────────────────

N_TRIALS    = 5
RESULTS_DIR = Path(__file__).parent.parent / "results"

SCENARIOS = [
    {"campus": None,              "user_query": None},
    {"campus": "Busch",           "user_query": None},
    {"campus": "College Ave",     "user_query": None},
    {"campus": "Livingston",      "user_query": None},
    {"campus": "Cook/Douglass",   "user_query": None},
    {"campus": None,              "user_query": "which buildings have the most mental health incidents"},
    {"campus": None,              "user_query": "where is RUPD being called most frequently"},
    {"campus": "Busch",           "user_query": "are there any repeat incident locations"},
]

def next_run_path(stem: str, suffix: str) -> Path:
    path = RESULTS_DIR / f"{stem}{suffix}"
    n = 2
    while path.exists():
        path = RESULTS_DIR / f"{stem}{n}{suffix}"
        n += 1
    return path

query_scenarios   = [s for s in SCENARIOS if s["user_query"]]
general_scenarios = [s for s in SCENARIOS if not s["user_query"]]

scenarios = (
    random.sample(query_scenarios,   min(2, len(query_scenarios))) +
    random.sample(general_scenarios, min(3, len(general_scenarios)))
)
random.shuffle(scenarios)

# ─── PROGRAMMATIC ACCURACY SCORING ───────────────────────────────────────────

def score_accuracy(output: str, campus_stats: list, building_stats: list) -> tuple[int, dict]:
    """
    Score accuracy 0-5 programmatically. Returns (score, breakdown).

    Checks three things:
    1. Cited report counts — do numbers in the output match ground truth totals?
    2. Building names     — does the output invent buildings that don't exist?
    3. Campus attribution — does the output assign a building to the wrong campus?

    Returns a score and a breakdown dict for logging.
    """
    # ── Ground truth sets ─────────────────────────────────────────────────────
    true_totals = set()
    for row in campus_stats + building_stats:
        for v in row.values():
            if isinstance(v, int) and v > 1:
                true_totals.add(v)

    true_buildings = {row["building_name"].lower() for row in building_stats}

    # building → campus mapping (lowercase)
    building_campus = {
        row["building_name"].lower(): row["campus"].lower()
        for row in building_stats
    }

    # ── Check 1: cited numbers ────────────────────────────────────────────────
    # Extract standalone integers > 1 from the output
    cited_numbers = [int(n) for n in re.findall(r'\b(\d{2,})\b', output)]
    if cited_numbers:
        correct_numbers = sum(1 for n in cited_numbers if n in true_totals)
        number_ratio = correct_numbers / len(cited_numbers)
    else:
        number_ratio = 1.0  # no numbers cited — don't penalise

    # ── Check 2: fabricated buildings ────────────────────────────────────────
    # For each known building name, check if it appears correctly in output
    # Then check for any capitalised proper-noun-looking names that aren't real
    fabricated = 0
    mentioned_buildings = 0
    for bname in true_buildings:
        if bname in output.lower():
            mentioned_buildings += 1

    # Heuristic: look for "X Hall", "X House", "X Tower", "X Suites" patterns
    # and check if they match known buildings
    cited_building_patterns = re.findall(
        r'\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Hall|House|Tower|Suites|Apartments|Center|Complex))\b',
        output
    )
    for cited in cited_building_patterns:
        if cited.lower() not in true_buildings:
            fabricated += 1

    # ── Check 3: wrong campus attribution ─────────────────────────────────────
    wrong_campus = 0
    campus_names = ["busch", "livingston", "college ave", "cook/douglass", "cook douglass"]
    for bname, true_campus in building_campus.items():
        if bname not in output.lower():
            continue
        # find the sentence(s) containing this building name
        sentences = [s for s in re.split(r'[.!?\n]', output.lower()) if bname in s]
        for sentence in sentences:
            for campus in campus_names:
                if campus in sentence and campus not in true_campus:
                    wrong_campus += 1

    # ── Compute score ─────────────────────────────────────────────────────────
    # Start at 5, deduct for each issue type
    score = 5

    # Numbers: deduct up to 2 points
    if number_ratio < 0.90: score -= 1
    if number_ratio < 0.60: score -= 1

    # Fabricated buildings: deduct 1 per fabrication, cap at 2
    score -= min(fabricated, 2)

    # Wrong campus: deduct 1 per error, cap at 2
    score -= min(wrong_campus, 2)

    score = max(0, score)

    breakdown = {
        "number_ratio":    round(number_ratio, 2),
        "fabricated_bldg": fabricated,
        "wrong_campus":    wrong_campus,
    }
    return score, breakdown

# ─── SINGLE-AGENT BASELINE ────────────────────────────────────────────────────

async def run_single_agent(campus: Optional[str], user_query: Optional[str]) -> dict:
    base_state: TrendState = {
        "campus": campus, "building_id": None, "start_date": None,
        "end_date": None, "user_query": user_query,
        "raw_reports": [], "building_stats": [], "campus_stats": [],
        "building_analysis": None, "campus_analysis": None,
        "location_analysis": None, "person_analysis": None,
        "query_analysis": None, "alerts": [], "final_report": None,
        "should_drill_location": False, "should_drill_person": False,
        "flagged_buildings": [],
    }
    intake_result = await intake_agent(base_state)
    base_state.update(intake_result)

    slim_reports = [
        {k: r[k] for k in ("date", "nature", "policy_type", "severity_level",
                            "rupd_called", "ems_present", "specific_location",
                            "building_name", "campus")
         if k in r}
        for r in base_state["raw_reports"][:5]
    ]

    t0 = time.perf_counter()
    prompt = f"""
You are a Rutgers University Residence Life director. Analyze the following incident data
and produce a comprehensive executive summary report for Residence Life staff.

CAMPUS STATISTICS:
{json.dumps(base_state['campus_stats'], indent=2, default=str)}

BUILDING STATISTICS (top 10 by volume):
{json.dumps(base_state['building_stats'][:10], indent=2, default=str)}

SAMPLE INCIDENT RECORDS (most recent 5):
{json.dumps(slim_reports, indent=2, default=str)}

USER QUERY (if any): {user_query or 'General trend analysis'}

Write a comprehensive executive summary covering:
1. Overall community health assessment
2. Top concerns and hotspots by building and campus
3. Urgent patterns — repeat locations, RUPD/EMS involvement, escalating incidents
4. Students appearing in multiple reports (if any)
5. Recommended immediate actions
6. Longer-term recommendations

Use specific numbers, building names, and campus names from the data.
4-6 paragraphs.
"""
    output = await call_model(prompt)
    elapsed = time.perf_counter() - t0
    return {
        "output":        output,
        "elapsed":       elapsed,
        "campus_stats":  base_state["campus_stats"],
        "building_stats": base_state["building_stats"],
    }

# ─── JUDGE AGENT (qualitative dimensions only) ────────────────────────────────

RUBRIC = """
Score each response on a scale of 0–5 for each dimension:

SPECIFICITY (0-5): Does the response name specific buildings, campuses, locations, and incident types?
  5 = highly specific throughout | 3 = mix of specific and vague | 0 = entirely generic

ACTIONABILITY (0-5): Are the recommendations concrete and implementable by Residence Life staff?
  5 = specific, feasible actions with clear owners | 3 = somewhat actionable | 0 = vague platitudes

COMPLETENESS (0-5): Does the response cover building-level, campus-level, alert/urgent patterns, and recommendations?
  5 = all dimensions covered thoroughly | 3 = most covered | 0 = major dimensions missing

DETAIL (0-5): Does the response go beyond surface-level summaries with specific locations, patterns, and drill-down insights?
  5 = rich detail throughout — specific floors, rooms, repeat patterns, escalation trends | 3 = some detail but mostly high-level | 0 = entirely surface-level

NOTE: Do NOT score or comment on numerical accuracy — that is handled separately.
"""

async def judge_outputs(
    output_a: str,
    output_b: str,
    user_query: Optional[str],
) -> dict:
    """
    Blind judge scores qualitative dimensions only. Accuracy is scored separately.
    """
    prompt = f"""
You are an expert evaluator assessing the quality of Residence Life trend analysis reports.
You will score two reports (Response A and Response B) independently on 4 qualitative dimensions.

USER QUERY (if any): {user_query or 'General trend analysis'}

{RUBRIC}

--- RESPONSE A ---
{output_a}

--- RESPONSE B ---
{output_b}

Return ONLY a JSON object in exactly this format, no explanation, no markdown:
{{
  "a": {{"specificity": 0, "actionability": 0, "completeness": 0, "detail": 0}},
  "b": {{"specificity": 0, "actionability": 0, "completeness": 0, "detail": 0}},
  "reasoning": "one sentence explaining the key qualitative difference between the two responses"
}}
"""
    raw = await call_model(prompt)
    try:
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {
            "a": {"specificity": 0, "actionability": 0, "completeness": 0, "detail": 0},
            "b": {"specificity": 0, "actionability": 0, "completeness": 0, "detail": 0},
            "reasoning": "Parse error — scores defaulted to 0",
        }

# ─── CHARTS ───────────────────────────────────────────────────────────────────

def generate_charts(summary: dict):
    import matplotlib.pyplot as plt
    import numpy as np

    dims = ["accuracy", "specificity", "actionability", "completeness", "detail"]
    multi_scores  = [summary["multi_avg_scores"][d]  for d in dims]
    single_scores = [summary["single_avg_scores"][d] for d in dims]

    x     = np.arange(len(dims))
    width = 0.35

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    ax1 = axes[0]
    bars1 = ax1.bar(x - width/2, multi_scores,  width, label="Multi-agent",  color="#4A90D9")
    bars2 = ax1.bar(x + width/2, single_scores, width, label="Single-agent", color="#E07B54")
    ax1.set_xlabel("Dimension")
    ax1.set_ylabel("Average Score (0–5)")
    ax1.set_title("Multi-Agent vs Single-Agent: Score by Dimension")
    ax1.set_xticks(x)
    ax1.set_xticklabels([d.capitalize() for d in dims])
    ax1.set_ylim(0, 5.5)
    ax1.legend(loc="lower right")
    ax1.bar_label(bars1, fmt="%.2f", padding=3, fontsize=9)
    ax1.bar_label(bars2, fmt="%.2f", padding=3, fontsize=9)
    ax1.grid(axis="y", linestyle="--", alpha=0.4)

    ax2 = axes[1]
    categories = ["Multi wins", "Single wins", "Ties"]
    counts     = [summary["multi_wins"], summary["single_wins"], summary["ties"]]
    colors     = ["#4A90D9", "#E07B54", "#A0A0A0"]
    bars3 = ax2.bar(categories, counts, color=colors)
    ax2.set_ylabel("Number of Trials")
    ax2.set_title("Win / Loss / Tie Count")
    ax2.set_ylim(0, summary["n_trials"] + 1)
    ax2.bar_label(bars3, padding=3, fontsize=10)
    ax2.grid(axis="y", linestyle="--", alpha=0.4)

    plt.tight_layout()
    chart_path = next_run_path("exp1_quality_chart", ".png")
    plt.savefig(chart_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Chart saved to {chart_path}")

def generate_time_chart(runs: list):
    import matplotlib.pyplot as plt
    import numpy as np

    labels = [
        f"T{r['trial']}: {('campus=' + r['campus']) if r['campus'] else 'ALL'}\n{r['user_query'][:30] + '...' if r['user_query'] and len(r['user_query']) > 30 else r['user_query'] or 'general'}"
        for r in runs
    ]
    multi_times  = [r["multi_time_s"]  for r in runs]
    single_times = [r["single_time_s"] for r in runs]

    x     = np.arange(len(runs))
    width = 0.35

    fig, ax = plt.subplots(figsize=(max(10, len(runs) * 2.5), 6))
    bars1 = ax.bar(x - width/2, multi_times,  width, label="Multi-agent",  color="#4A90D9")
    bars2 = ax.bar(x + width/2, single_times, width, label="Single-agent", color="#E07B54")

    ax.set_ylabel("Execution Time (seconds)")
    ax.set_title("Multi-Agent vs Single-Agent: Execution Time per Trial")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8)
    ax.legend()
    ax.bar_label(bars1, fmt="%.1fs", padding=3, fontsize=8)
    ax.bar_label(bars2, fmt="%.1fs", padding=3, fontsize=8)
    ax.grid(axis="y", linestyle="--", alpha=0.4)

    plt.tight_layout()
    chart_path = next_run_path("exp1_time_chart", ".png")
    plt.savefig(chart_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Time chart saved to {chart_path}")    

# ─── MAIN ─────────────────────────────────────────────────────────────────────

async def main():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    all_runs = []
    dims = ["accuracy", "specificity", "actionability", "completeness", "detail"]
    multi_totals  = {d: 0.0 for d in dims}
    single_totals = {d: 0.0 for d in dims}
    multi_wins = single_wins = ties = 0

    for i, scenario in enumerate(scenarios, 1):
        campus     = scenario["campus"]
        user_query = scenario["user_query"]
        label      = f"campus={campus or 'ALL'}, query={user_query or 'none'}"
        print(f"\n{'='*60}")
        print(f"Trial {i}/{len(scenarios)}: {label}")
        print("="*60)

        # ── Multi-agent ───────────────────────────────────────────────────────
        print("  Running multi-agent pipeline...")
        t0 = time.perf_counter()
        multi_result   = await run_trend_analysis(campus=campus, user_query=user_query)
        multi_time     = time.perf_counter() - t0
        multi_output   = multi_result["final_report"]
        campus_stats   = multi_result["campus_stats"]
        building_stats = multi_result["building_stats"]
        print(f"  Multi-agent done ({multi_time:.1f}s)")

        # ── Single-agent ──────────────────────────────────────────────────────
        print("  Running single-agent baseline...")
        single_result = await run_single_agent(campus=campus, user_query=user_query)
        single_output = single_result["output"]
        single_time   = single_result["elapsed"]
        print(f"  Single-agent done ({single_time:.1f}s)")

        # ── Programmatic accuracy ─────────────────────────────────────────────
        multi_acc_score,  multi_acc_breakdown  = score_accuracy(multi_output,  campus_stats, building_stats)
        single_acc_score, single_acc_breakdown = score_accuracy(single_output, campus_stats, building_stats)
        print(f"  Accuracy (programmatic) — Multi: {multi_acc_score}/5 {multi_acc_breakdown}")
        print(f"                          — Single: {single_acc_score}/5 {single_acc_breakdown}")

        # ── LLM judge (qualitative only) ──────────────────────────────────────
        flip = random.random() > 0.5
        if flip:
            output_a, output_b, a_is = single_output, multi_output, "single"
        else:
            output_a, output_b, a_is = multi_output, single_output, "multi"

        print("  Running judge evaluation...")
        scores = await judge_outputs(output_a, output_b, user_query)

        if a_is == "multi":
            multi_qual  = scores["a"]
            single_qual = scores["b"]
        else:
            multi_qual  = scores["b"]
            single_qual = scores["a"]

        # ── Combine accuracy + qualitative ────────────────────────────────────
        multi_scores  = {"accuracy": multi_acc_score,  **multi_qual}
        single_scores = {"accuracy": single_acc_score, **single_qual}

        multi_total  = sum(multi_scores.values())
        single_total = sum(single_scores.values())

        if multi_total > single_total:
            winner = "multi";  multi_wins  += 1
        elif single_total > multi_total:
            winner = "single"; single_wins += 1
        else:
            winner = "tie";    ties        += 1

        for d in dims:
            multi_totals[d]  += multi_scores.get(d, 0)
            single_totals[d] += single_scores.get(d, 0)

        print(f"  Multi  scores: {multi_scores}  → total {multi_total}/25")
        print(f"  Single scores: {single_scores} → total {single_total}/25")
        print(f"  Winner: {winner.upper()}")
        print(f"  Judge: {scores.get('reasoning', '')}")

        all_runs.append({
            "trial":                  i,
            "campus":                 campus,
            "user_query":             user_query,
            "multi_time_s":           round(multi_time, 2),
            "single_time_s":          round(single_time, 2),
            "multi_scores":           multi_scores,
            "single_scores":          single_scores,
            "multi_acc_breakdown":    multi_acc_breakdown,
            "single_acc_breakdown":   single_acc_breakdown,
            "multi_total":            multi_total,
            "single_total":           single_total,
            "winner":                 winner,
            "reasoning":              scores.get("reasoning", ""),
            "multi_output":           multi_output,
            "single_output":          single_output,
        })

    # ── Summary ───────────────────────────────────────────────────────────────
    n = len(scenarios)
    print(f"\n{'='*60}")
    print("EXPERIMENT 1 RESULTS: Multi-Agent vs Single-Agent Quality")
    print("="*60)
    print(f"{'Dimension':<16} {'Multi avg':>10} {'Single avg':>12} {'Advantage':>12}")
    print("-"*60)
    for d in dims:
        m_avg = multi_totals[d] / n
        s_avg = single_totals[d] / n
        print(f"{d.capitalize():<16} {m_avg:>10.2f} {s_avg:>12.2f} {m_avg - s_avg:>+12.2f}")
    print("-"*60)
    m_total_avg = sum(multi_totals.values()) / n
    s_total_avg = sum(single_totals.values()) / n
    print(f"{'Total (/25)':<16} {m_total_avg:>10.2f} {s_total_avg:>12.2f} {m_total_avg - s_total_avg:>+12.2f}")
    print(f"\nWin/Loss/Tie  →  Multi: {multi_wins}  |  Single: {single_wins}  |  Tie: {ties}")

    summary = {
        "n_trials":          n,
        "multi_wins":        multi_wins,
        "single_wins":       single_wins,
        "ties":              ties,
        "multi_avg_scores":  {d: round(multi_totals[d] / n, 2) for d in dims},
        "single_avg_scores": {d: round(single_totals[d] / n, 2) for d in dims},
        "multi_total_avg":   round(m_total_avg, 2),
        "single_total_avg":  round(s_total_avg, 2),
        "runs":              all_runs,
    }

    json_path = next_run_path("exp1_quality", ".json")
    with open(json_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nFull results saved to {json_path}")

    csv_path = next_run_path("exp1_quality", ".csv")
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "trial", "campus", "query",
            "multi_accuracy", "multi_specificity", "multi_actionability",
            "multi_completeness", "multi_detail", "multi_total",
            "single_accuracy", "single_specificity", "single_actionability",
            "single_completeness", "single_detail", "single_total",
            "winner",
        ])
        for r in all_runs:
            ms = r["multi_scores"]
            ss = r["single_scores"]
            writer.writerow([
                r["trial"], r["campus"], r["user_query"],
                ms.get("accuracy"), ms.get("specificity"), ms.get("actionability"),
                ms.get("completeness"), ms.get("detail"), r["multi_total"],
                ss.get("accuracy"), ss.get("specificity"), ss.get("actionability"),
                ss.get("completeness"), ss.get("detail"), r["single_total"],
                r["winner"],
            ])
    print(f"CSV saved to {csv_path}")

    generate_charts(summary)
    generate_time_chart(all_runs)

if __name__ == "__main__":
    asyncio.run(main())