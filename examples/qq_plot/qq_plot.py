"""
Quantile-quantile (Q-Q) plot example.

A Q-Q plot compares two distributions by pairing their quantiles:
the k-th smallest value of one distribution is plotted against the
k-th smallest value of the other. If both distributions have the same
shape, the points fall on a straight line.

Two variants are produced here:

  1. qq_normal.png      one sample of heart-rate readings vs. the
                        theoretical normal distribution
  2. qq_two_sample.png  pace samples from two runs plotted against
                        each other (no theoretical distribution needed)

Run:  python qq_plot.py
Deps: numpy, matplotlib  (pip install numpy matplotlib)
"""

from pathlib import Path
from statistics import NormalDist

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).parent

# --- palette (light surface) -------------------------------------------------
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
SERIES_1 = "#2a78d6"

# --- data --------------------------------------------------------------------
# 20 heart-rate readings (bpm) sampled once per minute during a steady run.
HEART_RATE = [
    138, 141, 143, 145, 146, 147, 148, 149, 150, 150,
    151, 152, 153, 154, 155, 156, 158, 160, 163, 168,
]


def normal_qq_pairs(sample):
    """Return (theoretical quantile, sample quantile) pairs.

    Sample quantiles are just the sorted values. The theoretical quantile
    for the i-th sorted value (1-based) uses the plotting position
    p_i = (i - 0.5) / n, then the inverse CDF of the standard normal.
    """
    xs = sorted(sample)
    n = len(xs)
    z = NormalDist()
    theoretical = [z.inv_cdf((i - 0.5) / n) for i in range(1, n + 1)]
    return theoretical, xs


def two_sample_qq_pairs(a, b, n_quantiles=50):
    """Quantiles of a and b evaluated at the same probabilities."""
    probs = (np.arange(n_quantiles) + 0.5) / n_quantiles
    return np.quantile(a, probs), np.quantile(b, probs)


# --- drawing helpers ---------------------------------------------------------
def style_axes(ax, title, xlabel, ylabel):
    ax.set_facecolor(SURFACE)
    ax.set_title(title, loc="left", color=INK, fontsize=12, fontweight="bold", pad=12)
    ax.set_xlabel(xlabel, color=INK_2)
    ax.set_ylabel(ylabel, color=INK_2)
    ax.grid(True, color=GRID, linewidth=1)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(AXIS)
    ax.tick_params(colors=MUTED, labelsize=9)


def draw_points(ax, x, y):
    # >= 8px markers with a 2px surface-colored ring so overlaps stay legible
    ax.scatter(x, y, s=48, color=SERIES_1, edgecolor=SURFACE, linewidth=1.5, zorder=3)


def figure(figsize=(6, 6)):
    fig, ax = plt.subplots(figsize=figsize, dpi=150)
    fig.patch.set_facecolor(SURFACE)
    return fig, ax


# --- 1. one sample vs the normal distribution --------------------------------
def plot_normal_qq(out=HERE / "qq_normal.png"):
    theoretical, sample = normal_qq_pairs(HEART_RATE)
    mean, sd = np.mean(sample), np.std(sample, ddof=1)

    fig, ax = figure()
    style_axes(
        ax,
        "Heart rate vs. normal distribution",
        "Theoretical quantile (standard normal, z)",
        "Sample quantile (bpm)",
    )
    # Reference line: what a perfectly normal sample with this mean/sd would follow.
    zs = np.array([-2.2, 2.2])
    ax.plot(zs, mean + sd * zs, color=AXIS, linewidth=2, zorder=2)
    draw_points(ax, theoretical, sample)

    # Label only the extremes - the two points that tell the story.
    ax.annotate(f"{sample[-1]} bpm", (theoretical[-1], sample[-1]),
                xytext=(-8, 6), textcoords="offset points", ha="right", color=INK_2, fontsize=9)
    ax.annotate(f"{sample[0]} bpm", (theoretical[0], sample[0]),
                xytext=(8, -10), textcoords="offset points", ha="left", color=INK_2, fontsize=9)
    ax.text(0.02, 0.02, f"n = {len(sample)}   mean = {mean:.1f}   sd = {sd:.1f}",
            transform=ax.transAxes, color=MUTED, fontsize=9)

    fig.tight_layout()
    fig.savefig(out, facecolor=SURFACE)
    plt.close(fig)
    return theoretical, sample


# --- 2. two activities against each other ------------------------------------
def plot_two_sample_qq(out=HERE / "qq_two_sample.png"):
    rng = np.random.default_rng(7)
    # Per-second pace (min/km) from two runs. Run B is the same shape as
    # run A but shifted 0.3 min/km faster, so the points sit on a line
    # parallel to y = x.
    run_a = rng.normal(loc=5.20, scale=0.25, size=1800)
    run_b = rng.normal(loc=4.90, scale=0.25, size=2100)
    qa, qb = two_sample_qq_pairs(run_a, run_b)

    fig, ax = figure()
    style_axes(
        ax,
        "Pace: run A vs. run B",
        "Run A pace quantile (min/km)",
        "Run B pace quantile (min/km)",
    )
    lo, hi = 4.0, 6.0
    ax.plot([lo, hi], [lo, hi], color=AXIS, linewidth=2, zorder=2)  # y = x
    ax.text(hi - 0.03, hi - 0.03, "y = x", ha="right", va="top", color=MUTED, fontsize=9)
    draw_points(ax, qa, qb)
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_aspect("equal")

    # One direct label at the median.
    med_a, med_b = np.median(run_a), np.median(run_b)
    ax.annotate(f"median {med_a:.2f} → {med_b:.2f}", (med_a, med_b),
                xytext=(12, -14), textcoords="offset points", color=INK_2, fontsize=9)

    fig.tight_layout()
    fig.savefig(out, facecolor=SURFACE)
    plt.close(fig)
    return qa, qb


if __name__ == "__main__":
    theoretical, sample = plot_normal_qq()
    print("Normal Q-Q pairs (i, p_i, theoretical z, sample bpm):")
    n = len(sample)
    for i, (z, v) in enumerate(zip(theoretical, sample), start=1):
        print(f"{i:>3}  {(i - 0.5) / n:5.3f}  {z:6.2f}  {v}")
    plot_two_sample_qq()
    print("\nWrote qq_normal.png and qq_two_sample.png")
