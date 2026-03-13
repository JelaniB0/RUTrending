"""
RUTrending — Python Analytics Module
Connects to Supabase PostgreSQL and performs:
  - Trend forecasting (linear regression per incident type)
  - Anomaly detection (z-score based)
  - Statistical breakdowns
  - Visualizations (saved as PNG files)
"""

import os
import json
import warnings
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # non-interactive backend for saving files
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import seaborn as sns
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from scipy import stats
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import LabelEncoder

# ─── SETUP ───────────────────────────────────────────────────────────────────

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise ValueError("DATABASE_URL not found in .env file")

# SQLAlchemy needs postgresql:// not postgres://
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

engine = create_engine(DATABASE_URL)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Seaborn style
sns.set_theme(style='darkgrid', palette='muted')
COLORS = {
    'Title IX':                       '#e74c3c',
    'Mental Health Concern':          '#9b59b6',
    'Policy Violation':               '#e67e22',
    'Roommate Conflict':              '#3498db',
    'General Residence Life Concern': '#2ecc71',
    'Facilities Issues':              '#95a5a6',
}

print("Connected to Supabase\n")

# ─── LOAD DATA ────────────────────────────────────────────────────────────────

def load_data():
    with engine.connect() as conn:
        reports = pd.read_sql(text("""
            SELECT
                r.id,
                r.report_id,
                r.date,
                r.time,
                r.nature,
                r.policy_type,
                r.severity_level,
                r.concern_type,
                r.issue_type,
                r.rupd_called,
                r.ems_present,
                r.transported,
                r.specific_location,
                b.name   AS building,
                b.campus AS campus
            FROM reports r
            JOIN buildings b ON r.building_id = b.id
            ORDER BY r.date ASC
        """), conn)

        staff_reports = pd.read_sql(text("""
            SELECT
                rs.report_id,
                rs.role_in_report,
                s.full_name,
                s.role AS staff_role
            FROM report_staff rs
            JOIN staff s ON rs.staff_id = s.id
        """), conn)

    reports['date'] = pd.to_datetime(reports['date'])
    reports['month'] = reports['date'].dt.to_period('M')
    reports['week']  = reports['date'].dt.to_period('W')
    reports['dow']   = reports['date'].dt.day_name()

    print(f"Loaded {len(reports)} reports spanning "
          f"{reports['date'].min().date()} → {reports['date'].max().date()}\n")
    return reports, staff_reports


# ─── 1. MONTHLY TREND CHART ───────────────────────────────────────────────────

def plot_monthly_trends(reports: pd.DataFrame):
    print("Generating monthly trend chart...")

    monthly = (
        reports.groupby(['month', 'nature'])
               .size()
               .reset_index(name='count')
    )
    monthly['month_dt'] = monthly['month'].dt.to_timestamp()

    fig, ax = plt.subplots(figsize=(14, 6))
    for nature, grp in monthly.groupby('nature'):
        ax.plot(
            grp['month_dt'], grp['count'],
            marker='o', linewidth=2, markersize=5,
            label=nature, color=COLORS.get(nature)
        )

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    plt.xticks(rotation=45, ha='right')
    ax.set_title('Monthly Incident Trends by Type', fontsize=15, fontweight='bold')
    ax.set_xlabel('Month')
    ax.set_ylabel('Number of Reports')
    ax.legend(loc='upper left', fontsize=8)
    plt.tight_layout()

    path = os.path.join(OUTPUT_DIR, '01_monthly_trends.png')
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"    Saved: {path}")


# ─── 2. CAMPUS HEATMAP ───────────────────────────────────────────────────────

def plot_campus_heatmap(reports: pd.DataFrame):
    print("🗺️  Generating campus heatmap...")
 
    pivot = (
        reports.groupby(['campus', 'nature'])
               .size()
               .unstack(fill_value=0)
    )
 
    fig, ax = plt.subplots(figsize=(14, 5))
    sns.heatmap(
        pivot,
        annot=True, fmt='d',
        cmap='YlOrRd',
        linewidths=0.5,
        ax=ax
    )
    ax.set_title('Incident Type Distribution by Campus', fontsize=14, fontweight='bold', pad=20)
    ax.set_xlabel('Incident Type', labelpad=15)
    ax.set_ylabel('Campus', labelpad=15)
 
    # Fix x-axis label overlap
    ax.set_xticklabels(ax.get_xticklabels(), rotation=25, ha='right', fontsize=10)
    ax.set_yticklabels(ax.get_yticklabels(), rotation=0, fontsize=10)
 
    plt.tight_layout(pad=2.0)
 
    path = os.path.join(OUTPUT_DIR, '02_campus_heatmap.png')
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved: {path}")



# ─── 3. TREND FORECASTING ────────────────────────────────────────────────────

def forecast_trends(reports: pd.DataFrame):
    print("Running trend forecasting...")

    monthly_total = (
        reports.groupby('month')
               .size()
               .reset_index(name='count')
    )
    monthly_total['month_num'] = range(len(monthly_total))

    X = monthly_total[['month_num']].values
    y = monthly_total['count'].values

    model = LinearRegression()
    model.fit(X, y)

    # Forecast next 3 months
    last_month_num = monthly_total['month_num'].max()
    future_nums    = np.array([[last_month_num + i] for i in range(1, 4)])
    forecast       = model.predict(future_nums)

    last_month = monthly_total['month'].max().to_timestamp()
    future_months = [last_month + pd.DateOffset(months=i) for i in range(1, 4)]

    # R² score
    r2 = model.score(X, y)
    slope = model.coef_[0]
    trend_dir = 'increasing' if slope > 0 else 'decreasing'

    print(f"   Overall trend: {trend_dir} ({slope:+.2f} reports/month, R²={r2:.2f})")
    print(f"   Forecast:")
    for month, val in zip(future_months, forecast):
        print(f"     {month.strftime('%B %Y')}: {val:.1f} reports")

    # Plot
    fig, ax = plt.subplots(figsize=(12, 5))
    month_dts = monthly_total['month'].dt.to_timestamp()
    ax.plot(month_dts, y, marker='o', color='#3498db', linewidth=2, label='Actual')

    trend_line = model.predict(X)
    ax.plot(month_dts, trend_line, '--', color='#e67e22', linewidth=1.5, label=f'Trend (R²={r2:.2f})')

    ax.plot(future_months, forecast, marker='s', color='#e74c3c',
            linewidth=2, linestyle='--', label='Forecast')
    for m, v in zip(future_months, forecast):
        ax.annotate(f'{v:.0f}', (m, v), textcoords='offset points',
                    xytext=(0, 8), ha='center', fontsize=9, color='#e74c3c')

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    plt.xticks(rotation=45, ha='right')
    ax.set_title('Total Incident Trend & 3-Month Forecast', fontsize=14, fontweight='bold')
    ax.set_xlabel('Month')
    ax.set_ylabel('Total Reports')
    ax.legend()
    plt.tight_layout()

    path = os.path.join(OUTPUT_DIR, '03_forecast.png')
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"    Saved: {path}")

    return {'slope': slope, 'r2': r2, 'forecast': dict(zip(
        [m.strftime('%B %Y') for m in future_months],
        [round(float(v), 1) for v in forecast]
    ))}


# ─── 4. ANOMALY DETECTION ────────────────────────────────────────────────────

def detect_anomalies(reports: pd.DataFrame):
    print("Running anomaly detection...")

    weekly = (
        reports.groupby('week')
               .size()
               .reset_index(name='count')
    )

    mean   = weekly['count'].mean()
    std    = weekly['count'].std()
    weekly['z_score'] = (weekly['count'] - mean) / std
    weekly['anomaly'] = weekly['z_score'].abs() > 1.8  # ~95% threshold

    anomalies = weekly[weekly['anomaly']].copy()
    anomalies['week_dt'] = anomalies['week'].dt.to_timestamp()

    print(f"   Mean weekly reports: {mean:.1f} (std: {std:.1f})")
    if len(anomalies) > 0:
        print(f"   {len(anomalies)} anomalous weeks detected:")
        for _, row in anomalies.iterrows():
            direction = 'HIGH' if row['z_score'] > 0 else 'LOW'
            print(f"     Week of {row['week_dt'].strftime('%b %d, %Y')}: "
                  f"{row['count']} reports (z={row['z_score']:.2f}) [{direction}]")
    else:
        print("   No significant anomalies detected")

    # Plot
    fig, ax = plt.subplots(figsize=(14, 5))
    week_dts = weekly['week'].dt.to_timestamp()
    ax.plot(week_dts, weekly['count'], color='#3498db', linewidth=1.5, label='Weekly count')
    ax.axhline(mean,          color='#2ecc71', linestyle='--', linewidth=1, label=f'Mean ({mean:.1f})')
    ax.axhline(mean + 1.8*std, color='#e74c3c', linestyle=':', linewidth=1, label='Anomaly threshold')
    ax.axhline(mean - 1.8*std, color='#e74c3c', linestyle=':', linewidth=1)

    if len(anomalies) > 0:
        ax.scatter(
            anomalies['week_dt'], anomalies['count'],
            color='#e74c3c', zorder=5, s=80, label='Anomaly'
        )

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    plt.xticks(rotation=45, ha='right')
    ax.set_title('Weekly Incident Count — Anomaly Detection', fontsize=14, fontweight='bold')
    ax.set_xlabel('Week')
    ax.set_ylabel('Reports')
    ax.legend()
    plt.tight_layout()

    path = os.path.join(OUTPUT_DIR, '04_anomaly_detection.png')
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"    Saved: {path}")

    return anomalies[['week', 'count', 'z_score']].to_dict('records')


# ─── 5. DAY OF WEEK ANALYSIS ─────────────────────────────────────────────────

def plot_day_of_week(reports: pd.DataFrame):
    print("Generating day-of-week analysis...")
 
    dow_order  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    dow_counts = (
        reports.groupby(['dow', 'nature'])
               .size()
               .unstack(fill_value=0)
               .reindex(dow_order)
    )
 
    fig, ax = plt.subplots(figsize=(14, 6))
    dow_counts.plot(
        kind='bar', stacked=True, ax=ax,
        color=[COLORS.get(c, '#bdc3c7') for c in dow_counts.columns]
    )
    ax.set_title('Incidents by Day of Week', fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('Day', labelpad=10)
    ax.set_ylabel('Number of Reports', labelpad=10)
    plt.xticks(rotation=30, ha='right', fontsize=10)
 
    # Move legend outside plot to the right
    ax.legend(
        loc='upper left',
        bbox_to_anchor=(1.01, 1),
        borderaxespad=0,
        fontsize=9,
        title='Incident Type',
        title_fontsize=9
    )
 
    plt.tight_layout(pad=2.0)
 
    path = os.path.join(OUTPUT_DIR, '05_day_of_week.png')
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f" Saved: {path}")



# ─── 6. TOP BUILDINGS BAR CHART ──────────────────────────────────────────────

def plot_top_buildings(reports: pd.DataFrame):
    print("Generating top buildings chart...")
 
    top = (
        reports.groupby(['building', 'nature'])
               .size()
               .unstack(fill_value=0)
    )
    top['total'] = top.sum(axis=1)
    top = top.sort_values('total', ascending=False).head(15).drop(columns='total')
 
    fig, ax = plt.subplots(figsize=(16, 9))
    top.plot(
        kind='barh', stacked=True, ax=ax,
        color=[COLORS.get(c, '#bdc3c7') for c in top.columns]
    )
    ax.set_title('Top 15 Buildings by Incident Count', fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('Number of Reports', labelpad=10)
    ax.set_ylabel('')
    ax.tick_params(axis='y', labelsize=10)
 
    # Move legend outside plot to the right
    ax.legend(
        loc='upper left',
        bbox_to_anchor=(1.01, 1),
        borderaxespad=0,
        fontsize=9,
        title='Incident Type',
        title_fontsize=9
    )
 
    # Add extra left margin for long building names
    plt.subplots_adjust(left=0.28)
    plt.tight_layout(pad=2.0)
 
    path = os.path.join(OUTPUT_DIR, '06_top_buildings.png')
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved: {path}")


# ─── 7. SEVERITY & ESCALATION ANALYSIS ───────────────────────────────────────

def analyze_escalation(reports: pd.DataFrame):
    print("📊 Analyzing escalation patterns...")

    escalated = reports[reports['rupd_called'] == True]
    ems       = reports[reports['ems_present']  == True]
    transport = reports[reports['transported']  == True]

    print(f"   RUPD called:    {len(escalated)}/{len(reports)} reports "
          f"({100*len(escalated)/len(reports):.1f}%)")
    print(f"   EMS present:    {len(ems)}/{len(reports)} reports "
          f"({100*len(ems)/len(reports):.1f}%)")
    print(f"   Transported:    {len(transport)}/{len(reports)} reports "
          f"({100*len(transport)/len(reports):.1f}%)")

    # Escalation rate by nature
    esc_by_nature = (
        reports.groupby('nature')
               .agg(
                   total=('id', 'count'),
                   rupd=('rupd_called', 'sum'),
                   ems=('ems_present', 'sum'),
               )
               .assign(
                   rupd_rate=lambda x: (x['rupd'] / x['total'] * 100).round(1),
                   ems_rate =lambda x: (x['ems']  / x['total'] * 100).round(1),
               )
    )

    print("\n   Escalation rates by incident type:")
    print(esc_by_nature[['total','rupd','rupd_rate','ems','ems_rate']].to_string())

    # Plot escalation rates
    fig, ax = plt.subplots(figsize=(10, 5))
    x = np.arange(len(esc_by_nature))
    width = 0.35
    ax.bar(x - width/2, esc_by_nature['rupd_rate'], width,
           label='RUPD Called (%)', color='#e74c3c', alpha=0.8)
    ax.bar(x + width/2, esc_by_nature['ems_rate'],  width,
           label='EMS Present (%)', color='#9b59b6', alpha=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(esc_by_nature.index, rotation=25, ha='right', fontsize=9)
    ax.set_title('Escalation Rates by Incident Type', fontsize=14, fontweight='bold')
    ax.set_ylabel('Escalation Rate (%)')
    ax.legend()
    plt.tight_layout()

    path = os.path.join(OUTPUT_DIR, '07_escalation_rates.png')
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"    Saved: {path}")


# ─── 8. EXPORT SUMMARY JSON ──────────────────────────────────────────────────

def export_summary(reports, forecast_data, anomaly_data):
    print("💾 Exporting analytics summary JSON...")

    summary = {
        'generated_at': datetime.now().isoformat(),
        'total_reports': len(reports),
        'date_range': {
            'start': reports['date'].min().strftime('%Y-%m-%d'),
            'end':   reports['date'].max().strftime('%Y-%m-%d'),
        },
        'by_nature': reports['nature'].value_counts().to_dict(),
        'by_campus': reports['campus'].value_counts().to_dict(),
        'escalation': {
            'rupd_called':  int(reports['rupd_called'].sum()),
            'ems_present':  int(reports['ems_present'].sum()),
            'transported':  int(reports['transported'].sum()),
        },
        'forecast':   forecast_data,
        'anomalies':  [
            {
                'week':    str(a['week']),
                'count':   int(a['count']),
                'z_score': round(float(a['z_score']), 2),
            }
            for a in anomaly_data
        ],
        'top_buildings': (
            reports.groupby('building')
                   .size()
                   .sort_values(ascending=False)
                   .head(10)
                   .to_dict()
        ),
    }

    path = os.path.join(OUTPUT_DIR, 'analytics_summary.json')
    with open(path, 'w') as f:
        json.dump(summary, f, indent=2)
    print(f"    Saved: {path}")

    return summary


# ─── MAIN ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 55)
    print("  RUTrending — Python Analytics")
    print("=" * 55 + "\n")

    reports, staff_reports = load_data()

    plot_monthly_trends(reports)
    plot_campus_heatmap(reports)
    forecast_data  = forecast_trends(reports)
    anomaly_data   = detect_anomalies(reports)
    plot_day_of_week(reports)
    plot_top_buildings(reports)
    analyze_escalation(reports)
    summary = export_summary(reports, forecast_data, anomaly_data)

    print("\n" + "=" * 55)
    print("Analytics complete!")
    print(f"Outputs saved to: {OUTPUT_DIR}")
    print("=" * 55)
    print(f"\n  Reports analyzed:  {summary['total_reports']}")
    print(f"  Date range:        {summary['date_range']['start']} → {summary['date_range']['end']}")
    print(f"  RUPD involved:     {summary['escalation']['rupd_called']} reports")
    print(f"  Forecast (next 3): {list(summary['forecast']['forecast'].values())}")
    print(f"  Anomalies found:   {len(summary['anomalies'])}")