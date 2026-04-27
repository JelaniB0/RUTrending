import json
from pathlib import Path

RESULTS_DIR = Path(__file__).parent.parent / "results"
dims = ["accuracy", "specificity", "actionability", "completeness", "detail"]

files = [
    RESULTS_DIR / "exp1_quality1.json",
    RESULTS_DIR / "exp1_quality2.json",
    RESULTS_DIR / "exp1_quality3.json",
]

multi_totals  = {d: 0.0 for d in dims}
single_totals = {d: 0.0 for d in dims}
multi_wins = single_wins = ties = 0
multi_times = []
single_times = []
n_trials = 0

for f in files:
    data = json.loads(f.read_text())
    n_trials     += data["n_trials"]
    multi_wins   += data["multi_wins"]
    single_wins  += data["single_wins"]
    ties         += data["ties"]
    for d in dims:
        multi_totals[d]  += data["multi_avg_scores"][d] * data["n_trials"]
        single_totals[d] += data["single_avg_scores"][d] * data["n_trials"]
    for run in data["runs"]:
        multi_times.append(run["multi_time_s"])
        single_times.append(run["single_time_s"])

print(f"Total trials: {n_trials}")
print(f"Win/Loss/Tie — Multi: {multi_wins} | Single: {single_wins} | Tie: {ties}")
print()
print(f"{'Dimension':<16} {'Multi avg':>10} {'Single avg':>12} {'Advantage':>12}")
print("-"*50)
for d in dims:
    m = multi_totals[d] / n_trials
    s = single_totals[d] / n_trials
    print(f"{d.capitalize():<16} {m:>10.2f} {s:>12.2f} {m-s:>+12.2f}")
print()
print(f"Avg multi time:  {sum(multi_times)/len(multi_times):.1f}s")
print(f"Avg single time: {sum(single_times)/len(single_times):.1f}s")

# ── Build summary dict ────────────────────────────────────────────────────────

summary = {
    "n_trials":        n_trials,
    "multi_wins":      multi_wins,
    "single_wins":     single_wins,
    "ties":            ties,
    "multi_avg":       {d: round(multi_totals[d] / n_trials, 2) for d in dims},
    "single_avg":      {d: round(single_totals[d] / n_trials, 2) for d in dims},
    "avg_multi_time":  round(sum(multi_times)  / len(multi_times),  1),
    "avg_single_time": round(sum(single_times) / len(single_times), 1),
}

# ── Charts ────────────────────────────────────────────────────────────────────

def generate_consolidated_charts(summary: dict):
    import matplotlib.pyplot as plt
    import numpy as np

    dims = ["accuracy", "specificity", "actionability", "completeness", "detail"]
    multi_scores  = [summary["multi_avg"][d]  for d in dims]
    single_scores = [summary["single_avg"][d] for d in dims]

    x     = np.arange(len(dims))
    width = 0.35

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    # ── Score by dimension ────────────────────────────────────────────────────
    ax1 = axes[0]
    bars1 = ax1.bar(x - width/2, multi_scores,  width, label="Multi-agent",  color="#4A90D9")
    bars2 = ax1.bar(x + width/2, single_scores, width, label="Single-agent", color="#E07B54")
    ax1.set_ylabel("Average Score (0–5)")
    ax1.set_title(f"Score by Dimension (n={summary['n_trials']} trials)")
    ax1.set_xticks(x)
    ax1.set_xticklabels([d.capitalize() for d in dims])
    ax1.set_ylim(0, 5.5)
    ax1.legend()
    ax1.bar_label(bars1, fmt="%.2f", padding=3, fontsize=9)
    ax1.bar_label(bars2, fmt="%.2f", padding=3, fontsize=9)
    ax1.grid(axis="y", linestyle="--", alpha=0.4)

    # ── Win/Loss/Tie ──────────────────────────────────────────────────────────
    ax2 = axes[1]
    categories = ["Multi wins", "Single wins", "Ties"]
    counts     = [summary["multi_wins"], summary["single_wins"], summary["ties"]]
    bars3 = ax2.bar(categories, counts, color=["#4A90D9", "#E07B54", "#A0A0A0"])
    ax2.set_ylabel("Number of Trials")
    ax2.set_title(f"Win / Loss / Tie (n={summary['n_trials']})")
    ax2.set_ylim(0, summary["n_trials"] + 1)
    ax2.bar_label(bars3, padding=3, fontsize=10)
    ax2.grid(axis="y", linestyle="--", alpha=0.4)

    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "exp1_consolidated_scores.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("Saved exp1_consolidated_scores.png")

    # ── Execution time ────────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(7, 5))
    bars = ax.bar(
        ["Multi-agent", "Single-agent"],
        [summary["avg_multi_time"], summary["avg_single_time"]],
        color=["#4A90D9", "#E07B54"],
        width=0.4,
    )
    ax.set_ylabel("Avg Execution Time (seconds)")
    ax.set_title(f"Avg Execution Time (n={summary['n_trials']} trials)")
    ax.bar_label(bars, fmt="%.1fs", padding=3, fontsize=10)
    ax.set_ylim(0, max(summary["avg_multi_time"], summary["avg_single_time"]) + 10)
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "exp1_consolidated_time.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("Saved exp1_consolidated_time.png")

generate_consolidated_charts(summary)