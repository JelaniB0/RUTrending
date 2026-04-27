"""
pipeline.py — RUTrending multi-agent pipeline (Python port of agents.ts)

Usage:
    python pipeline.py                         # general analysis
    python pipeline.py --campus BUSCH          # filter by campus
    python pipeline.py --query "which building has the most alcohol incidents"
    python pipeline.py --out results/run1.json # save full result to JSON
"""

import os
import json
import asyncio
import argparse
import re
import time
from pathlib import Path
from typing import Optional, TypedDict
from dotenv import load_dotenv
from openai import AsyncOpenAI
from langgraph.graph import StateGraph, END

# always find .env one level up from this file (experiments/.env)
load_dotenv(Path(__file__).parent.parent / ".env")

USE_REAL_DB: bool = True

client = AsyncOpenAI(
    api_key=os.environ["GITHUB_TOKEN"],
    base_url="https://models.inference.ai.azure.com",
)

MAX_CONCURRENT = 2
semaphore = asyncio.Semaphore(MAX_CONCURRENT)

# ─── MODEL CALLS ──────────────────────────────────────────────────────────────

async def call_model(prompt: str) -> str:
    async with semaphore:
        response = await client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return response.choices[0].message.content or ""

async def call_model_mini(prompt: str) -> str:
    async with semaphore:
        response = await client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return response.choices[0].message.content or ""

# ─── STATE ────────────────────────────────────────────────────────────────────

class TrendState(TypedDict):
    # Inputs
    campus:                Optional[str]
    building_id:           Optional[int]
    start_date:            Optional[str]
    end_date:              Optional[str]
    user_query:            Optional[str]
    disabled_agents:       Optional[list[str]]

    # Raw data
    raw_reports:           list[dict]
    building_stats:        list[dict]
    campus_stats:          list[dict]

    # Agent outputs
    building_analysis:     Optional[str]
    campus_analysis:       Optional[str]
    location_analysis:     Optional[str]
    person_analysis:       Optional[str]
    query_analysis:        Optional[str]
    alerts:                list[str]
    final_report:          Optional[str]

    # Routing flags
    should_drill_location: bool
    should_drill_person:   bool
    flagged_buildings:     list[str]

# ─── DB HELPERS ───────────────────────────────────────────────────────────────

def get_db_connection():
    import psycopg2
    url = os.environ["DATABASE_URL"]
    # strip pgbouncer param that psycopg2 doesn't support (common with Supabase)
    url = re.sub(r'[?&]pgbouncer=[^&]*', '', url).rstrip('?').rstrip('&')
    return psycopg2.connect(url)

def query_db(sql: str, params=None) -> list[dict]:
    import psycopg2.extras
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()

# ─── AGENT NODES ──────────────────────────────────────────────────────────────

async def intake_agent(state: TrendState) -> dict:
    print("Intake Agent: fetching data...")
    t0 = time.perf_counter()

    campus_clause = f"WHERE b.campus = '{state['campus']}'" if state["campus"] else ""

    raw_reports = query_db(f"""
        SELECT r.*, b.name AS building_name, b.campus
        FROM reports r JOIN buildings b ON r.building_id = b.id
        {campus_clause}
        ORDER BY r.date DESC
    """)

    building_stats = query_db(f"""
        SELECT
            b.id AS building_id, b.name AS building_name, b.campus,
            COUNT(r.id)::int AS total_reports,
            COUNT(CASE WHEN r.nature = 'Title IX' THEN 1 END)::int AS title_ix,
            COUNT(CASE WHEN r.nature = 'Mental Health Concern' THEN 1 END)::int AS mental_health,
            COUNT(CASE WHEN r.nature = 'Policy Violation' THEN 1 END)::int AS policy_violation,
            COUNT(CASE WHEN r.nature = 'Roommate Conflict' THEN 1 END)::int AS roommate_conflict,
            COUNT(CASE WHEN r.nature = 'General Residence Life Concern' THEN 1 END)::int AS general_concern,
            COUNT(CASE WHEN r.nature = 'Facilities Issues' THEN 1 END)::int AS facilities,
            COUNT(CASE WHEN r.rupd_called = true THEN 1 END)::int AS rupd_called,
            COUNT(CASE WHEN r.ems_present = true THEN 1 END)::int AS ems_present
        FROM reports r JOIN buildings b ON r.building_id = b.id
        {campus_clause}
        GROUP BY b.id, b.name, b.campus
        ORDER BY total_reports DESC
    """)

    campus_stats = query_db("""
        SELECT
            b.campus,
            COUNT(r.id)::int AS total_reports,
            COUNT(CASE WHEN r.nature = 'Title IX' THEN 1 END)::int AS title_ix,
            COUNT(CASE WHEN r.nature = 'Mental Health Concern' THEN 1 END)::int AS mental_health,
            COUNT(CASE WHEN r.nature = 'Policy Violation' THEN 1 END)::int AS policy_violation,
            COUNT(CASE WHEN r.nature = 'Roommate Conflict' THEN 1 END)::int AS roommate_conflict,
            COUNT(CASE WHEN r.nature = 'Facilities Issues' THEN 1 END)::int AS facilities,
            COUNT(CASE WHEN r.rupd_called = true THEN 1 END)::int AS rupd_called,
            COUNT(CASE WHEN r.ems_present = true THEN 1 END)::int AS ems_present
        FROM reports r JOIN buildings b ON r.building_id = b.id
        GROUP BY b.campus ORDER BY total_reports DESC
    """)

    print(f"  Fetched {len(raw_reports)} reports, {len(building_stats)} buildings ({time.perf_counter()-t0:.2f}s)")
    return {"raw_reports": raw_reports, "building_stats": building_stats, "campus_stats": campus_stats}


async def building_agent(state: TrendState) -> dict:
    print("Building Agent: analyzing building patterns...")
    t0 = time.perf_counter()

    top_buildings = state["building_stats"][:10]
    prompt = f"""
You are a Rutgers University Residence Life analyst. Analyze these building-level incident statistics.

BUILDING STATISTICS:
{json.dumps(top_buildings, indent=2, default=str)}

USER QUERY (if any): {state['user_query'] or 'General trend analysis'}

Provide a concise analysis covering:
1. Which buildings have the highest incident rates and what types dominate
2. Any buildings with concerning patterns (high Title IX, repeated mental health, high RUPD involvement)
3. Buildings that may need additional RA support or resources
4. Any notable cross-building trends

Also at the end of your response, on a new line, output a JSON array of building names that warrant
deeper location-level analysis (i.e. buildings with 4+ reports or alarming incident type concentrations).
Format: FLAGGED_BUILDINGS: ["Building Name 1", "Building Name 2"]

3-5 paragraphs of analysis, then the FLAGGED_BUILDINGS line.
"""
    content = await call_model(prompt)

    flagged_buildings: list[str] = []
    match = re.search(r'FLAGGED_BUILDINGS:\s*(\[.*?\])', content)
    if match:
        try:
            flagged_buildings = json.loads(match.group(1))
        except json.JSONDecodeError:
            flagged_buildings = []

    building_analysis = re.sub(r'FLAGGED_BUILDINGS:.*$', '', content, flags=re.MULTILINE).strip()
    query_wants_location = bool(
        re.search(r'room|floor|lounge|lobby|area|location|specific|where',
                  state["user_query"] or "", re.I)
    )
    should_drill_location = len(flagged_buildings) > 0 or query_wants_location

    print(f"  Flagged {len(flagged_buildings)} buildings ({time.perf_counter()-t0:.2f}s)")
    return {
        "building_analysis": building_analysis,
        "flagged_buildings": flagged_buildings,
        "should_drill_location": should_drill_location,
    }


async def campus_agent(state: TrendState) -> dict:
    print("Campus Agent: analyzing campus-wide trends...")
    t0 = time.perf_counter()

    prompt = f"""
You are a Rutgers University Residence Life analyst. Analyze these campus-wide incident statistics.

CAMPUS STATISTICS:
{json.dumps(state['campus_stats'], indent=2, default=str)}

BUILDING ANALYSIS:
{state['building_analysis']}

USER QUERY (if any): {state['user_query'] or 'General trend analysis'}

Provide a campus-wide trend analysis covering:
1. Which campuses have the most incidents and what types dominate
2. Significant differences between campuses
3. Resources or interventions that should be prioritized at the campus level
4. Overall residential community health assessment

3-4 paragraphs, factual and actionable.
"""
    campus_analysis = await call_model(prompt)
    print(f"  Campus analysis complete ({time.perf_counter()-t0:.2f}s)")
    return {"campus_analysis": campus_analysis}


async def alert_agent(state: TrendState) -> dict:
    print("Alert Agent: scanning for urgent patterns...")
    t0 = time.perf_counter()

    from collections import defaultdict
    loc_counter: dict = defaultdict(list)
    for r in state["raw_reports"]:
        key = (r.get("building_name", ""), r.get("specific_location", ""))
        loc_counter[key].append(r.get("nature", ""))

    repeat_locations = sorted([
        {"building_name": b, "specific_location": l,
         "incident_count": len(natures), "incident_types": natures}
        for (b, l), natures in loc_counter.items() if len(natures) > 1
    ], key=lambda x: -x["incident_count"])[:10]

    student_map: dict = defaultdict(lambda: {"roles": [], "types": []})
    for r in state["raw_reports"]:
        for s in r.get("students", []):
            sid = s.get("ruid") or s.get("student_name", "unknown")
            student_map[sid]["name"] = s.get("student_name", sid)
            student_map[sid]["roles"].append(s.get("role", ""))
            student_map[sid]["types"].append(r.get("nature", ""))

    repeat_students = [v for v in student_map.values() if len(v["roles"]) >= 2]

    high_severity_count = sum(
        1 for r in state["raw_reports"]
        if r.get("rupd_called") or r.get("ems_present") or r.get("transported")
    )

    prompt = f"""
You are a Rutgers Residence Life safety analyst. Review these patterns and generate specific alerts.

REPEAT INCIDENT LOCATIONS:
{json.dumps(repeat_locations, indent=2, default=str)}

STUDENTS APPEARING IN MULTIPLE REPORTS: {len(repeat_students)} students
HIGH SEVERITY INCIDENTS (RUPD/EMS involved): {high_severity_count}

USER QUERY (if any): {state['user_query'] or 'General trend analysis'}

Generate specific, actionable alerts. Each alert should start with "ALERT:".
Focus on repeat locations, high RUPD/EMS involvement, and escalating patterns.

Return ONLY a JSON array of alert strings. No explanation, no markdown.
"""
    raw = await call_model(prompt)
    try:
        alerts = json.loads(re.sub(r'```json|```', '', raw).strip())
    except json.JSONDecodeError:
        alerts = ["ALERT: Unable to parse alert data — manual review recommended."]

    query_wants_person = bool(
        re.search(r'person|student|resident|individual|who|repeat offender|same person',
                  state["user_query"] or "", re.I)
    )
    should_drill_person = len(repeat_students) > 0 or query_wants_person

    print(f"  Generated {len(alerts)} alerts. Person drill-down: {should_drill_person} ({time.perf_counter()-t0:.2f}s)")
    return {"alerts": alerts, "should_drill_person": should_drill_person}


async def location_agent(state: TrendState) -> dict:
    print("Location Agent: drilling into flagged buildings...")
    t0 = time.perf_counter()

    flagged = set(state["flagged_buildings"])
    location_data = [r for r in state["raw_reports"] if r.get("building_name") in flagged]

    from collections import defaultdict
    summary: dict = defaultdict(lambda: defaultdict(lambda: {"count": 0, "types": []}))
    for r in location_data:
        b = r.get("building_name", "")
        l = r.get("specific_location", "Unknown")
        summary[b][l]["count"] += 1
        if r.get("nature") not in summary[b][l]["types"]:
            summary[b][l]["types"].append(r.get("nature"))

    hotspots = {
        b: {l: d for l, d in locs.items() if d["count"] >= 2}
        for b, locs in summary.items()
    }
    hotspots = {b: locs for b, locs in hotspots.items() if locs}

    prompt = f"""
You are a Rutgers Residence Life analyst. Analyze repeat incident locations.

HOTSPOT LOCATIONS (2+ incidents only):
{json.dumps(hotspots, indent=2, default=str)}

USER QUERY (if any): {state['user_query'] or 'Location pattern analysis'}

Identify the most concerning repeat locations and recommend interventions. 3 paragraphs max.
"""
    location_analysis = await call_model_mini(prompt)
    print(f"  Location analysis complete ({time.perf_counter()-t0:.2f}s)")
    return {"location_analysis": location_analysis}


async def person_agent(state: TrendState) -> dict:
    print("Person Agent: analyzing repeat involved parties...")
    t0 = time.perf_counter()

    from collections import defaultdict
    student_map: dict = defaultdict(lambda: {
        "roles": [], "types": [], "hall": None,
        "first_report": None, "last_report": None
    })
    for r in state["raw_reports"]:
        date = str(r.get("date", ""))
        for s in r.get("students", []):
            sid = s.get("ruid") or s.get("student_name", "unknown")
            student_map[sid]["name"] = s.get("student_name", sid)
            student_map[sid]["hall"] = s.get("hall", r.get("building_name"))
            student_map[sid]["roles"].append(s.get("role", ""))
            student_map[sid]["types"].append(r.get("nature", ""))
            dates = [d for d in [student_map[sid]["first_report"], date] if d]
            if dates:
                student_map[sid]["first_report"] = min(dates)
                student_map[sid]["last_report"]  = max(dates)

    repeat_students = [
        {"name": v["name"], "report_count": len(v["roles"]), "roles": v["roles"],
         "incident_types": list(set(v["types"])), "hall": v["hall"],
         "first_report": v["first_report"], "last_report": v["last_report"]}
        for v in student_map.values() if len(v["roles"]) >= 2
    ]

    if not repeat_students:
        return {"person_analysis": "No students appeared in multiple reports during this period."}

    prompt = f"""
You are a Rutgers Residence Life case manager reviewing students who appear in multiple incident reports.

REPEAT INVOLVED PARTIES:
{json.dumps(repeat_students, indent=2, default=str)}

USER QUERY (if any): {state['user_query'] or 'Person pattern analysis'}

Analyze these patterns:
1. Students appearing as accused in multiple reports — escalation risk
2. Students appearing as victims or students of concern multiple times — support needs
3. Any students whose incident types suggest a pattern
4. Recommended follow-up actions for case management

Be clinical and professional. Refer to students by initials only for privacy (e.g. "Student L.S.").
3-4 paragraphs.
"""
    person_analysis = await call_model(prompt)
    print(f"  Person analysis complete ({time.perf_counter()-t0:.2f}s)")
    return {"person_analysis": person_analysis}


async def query_agent(state: TrendState) -> dict:
    print("Query Agent: answering specific user question...")
    t0 = time.perf_counter()

    if not state["user_query"]:
        return {"query_analysis": None}

    sql_prompt = f"""
You are a PostgreSQL expert. Write a SQL query to answer the user's question using this schema.

SCHEMA:
- reports (id, nature, policy_type, severity_level, rupd_called, ems_present, transported, date, specific_location, building_id, narrative)
- buildings (id, name, campus)

nature values: 'Title IX', 'Mental Health Concern', 'Policy Violation', 'Roommate Conflict', 'General Residence Life Concern', 'Facilities Issues'
policy_type values: 'ALCOHOL_UNDERAGE', 'DRUG_CANNABIS', 'NOISE', 'FIRE_SAFETY_HOTPLATE', 'FIRE_SAFETY_CANDLE', 'FIRE_SAFETY_LITHIUM', 'GUEST_OVERSTAY', 'GUEST_PROPPED', 'PROHIBITED_ITEM', 'VANDALISM', 'SMOKING', 'DISRUPTION', 'WEAPONS'
severity_level values: 'LOW', 'MEDIUM', 'HIGH', 'CRISIS'
campus values: 'Busch', 'Livingston', 'College Ave', 'Cook/Douglass'

QUESTION: {state['user_query']}

Rules:
- Always JOIN buildings on r.building_id = b.id
- Always include b.name AS building and b.campus in SELECT when relevant
- Use COUNT()::int for counts
- ORDER BY count DESC, LIMIT 20
- Return ONLY the raw SQL query, no markdown, no explanation, no backticks
"""
    context_data: list = []
    generated_sql: Optional[str] = None

    try:
        raw_sql = await call_model(sql_prompt)
        generated_sql = re.sub(r'```sql|```', '', raw_sql).strip()
        print(f"  Generated SQL: {generated_sql[:120]}...")
        context_data = query_db(generated_sql)
    except Exception as e:
        print(f"  Text-to-SQL failed, falling back to building stats: {e}")
        context_data = state["building_stats"][:15]

    answer_prompt = f"""
You are a Rutgers Residence Life analyst. Answer the user's question directly using the data provided.

QUESTION: {state['user_query']}

DATA:
{json.dumps(context_data, indent=2, default=str)}

ADDITIONAL CONTEXT:
{state.get('building_analysis') or ''}

Answer the question directly in the first sentence. Use specific numbers and names.
2-4 paragraphs, factual and specific.
"""
    query_analysis = await call_model(answer_prompt)
    print(f"  Query analysis complete ({time.perf_counter()-t0:.2f}s)")
    return {"query_analysis": query_analysis}


async def join_node(state: TrendState) -> dict:
    print("Join Node: all branches complete, proceeding to report...")
    return {}


async def report_agent(state: TrendState) -> dict:
    print("Report Agent: compiling final report...")
    t0 = time.perf_counter()

    sections = "\n\n".join(filter(None, [
        f"SPECIFIC QUERY ANSWER:\n{state['query_analysis']}"   if state.get("query_analysis")   else None,
        f"CAMPUS ANALYSIS:\n{state['campus_analysis']}",
        f"BUILDING ANALYSIS:\n{state['building_analysis']}",
        f"LOCATION DRILL-DOWN:\n{state['location_analysis']}" if state.get("location_analysis") else None,
        f"PERSON PATTERNS:\n{state['person_analysis']}"       if state.get("person_analysis")   else None,
        f"ALERTS:\n" + "\n".join(state["alerts"]),
    ]))

    prompt = f"""
You are a Rutgers University Residence Life director writing an executive summary report.

GROUND TRUTH — USE ONLY THESE EXACT NUMBERS:

CAMPUS STATS (authoritative):
{json.dumps(state['campus_stats'], indent=2, default=str)}

TOP BUILDINGS (authoritative):
{json.dumps(state['building_stats'][:10], indent=2, default=str)}

AGENT ANALYSES (use for narrative depth, specific locations, and patterns — but verify all numbers against GROUND TRUTH above):
{sections}

USER QUERY (if any): {state['user_query'] or 'General trend analysis'}

Write a concise executive summary (4-6 paragraphs) for a Residence Life director:
1. Overall community health assessment
2. Top concerns and hotspots — ONLY cite numbers from CAMPUS STATS and TOP BUILDINGS above
3. Notable patterns (location, person, or escalation trends if applicable)
4. Recommended immediate actions
5. Longer-term recommendations

CRITICAL: Every number must match the GROUND TRUTH exactly. Do not round or estimate.
"""
    final_report = await call_model(prompt)
    print(f"  Final report compiled ({time.perf_counter()-t0:.2f}s)")
    return {"final_report": final_report}

# ─── ROUTING ──────────────────────────────────────────────────────────────────

def route_location(state: TrendState) -> str:
    if "location" in state.get("disabled_agents", []):
        return END
    return "locationAnalyzer" if state["should_drill_location"] else END

def route_person(state: TrendState) -> str:
    if "person" in state.get("disabled_agents", []):
        return END
    return "personAnalyzer" if state["should_drill_person"] else END

# ─── BUILD GRAPH ──────────────────────────────────────────────────────────────

def build_graph():
    g = StateGraph(TrendState)

    g.add_node("intake",           intake_agent)
    g.add_node("buildingAnalyzer", building_agent)
    g.add_node("campusAnalyzer",   campus_agent)
    g.add_node("alertScanner",     alert_agent)
    g.add_node("locationAnalyzer", location_agent)
    g.add_node("personAnalyzer",   person_agent)
    g.add_node("queryAnalyzer",    query_agent)

    g.set_entry_point("intake")

    g.add_edge("intake", "buildingAnalyzer")
    g.add_edge("intake", "campusAnalyzer")
    g.add_edge("intake", "alertScanner")
    g.add_edge("intake", "queryAnalyzer")

    g.add_edge("campusAnalyzer", END)
    g.add_edge("queryAnalyzer",  END)

    g.add_conditional_edges("buildingAnalyzer", route_location,
                             {"locationAnalyzer": "locationAnalyzer",
                              END:                END})
    g.add_edge("locationAnalyzer", END)

    g.add_conditional_edges("alertScanner", route_person,
                             {"personAnalyzer": "personAnalyzer",
                              END:              END})
    g.add_edge("personAnalyzer", END)

    return g.compile()

trend_agent = build_graph()

# ─── PUBLIC API ───────────────────────────────────────────────────────────────

async def run_trend_analysis(
    campus:     Optional[str] = None,
    start_date: Optional[str] = None,
    end_date:   Optional[str] = None,
    user_query: Optional[str] = None,
    disabled_agents: Optional[list[str]] = None,  
) -> dict:
    initial: TrendState = {
        "campus":               campus,
        "building_id":          None,
        "start_date":           start_date,
        "end_date":             end_date,
        "user_query":           user_query,
        "raw_reports":          [],
        "building_stats":       [],
        "campus_stats":         [],
        "building_analysis":    None,
        "campus_analysis":      None,
        "location_analysis":    None,
        "person_analysis":      None,
        "query_analysis":       None,
        "alerts":               [],
        "final_report":         None,
        "should_drill_location": False,
        "should_drill_person":   False,
        "flagged_buildings":    [],
        "disabled_agents":      disabled_agents or []
    }
    t0 = time.perf_counter()
    result = await trend_agent.ainvoke(initial)

    # compile report outside the graph — guaranteed to run exactly once
    report = await report_agent(result)
    result.update(report)

    result["_total_time"] = time.perf_counter() - t0
    return result

# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RUTrending pipeline")
    parser.add_argument("--campus", help="Filter by campus (Busch, College Ave, Cook/Douglass, Livingston)")
    parser.add_argument("--start",  help="Start date YYYY-MM-DD")
    parser.add_argument("--end",    help="End date YYYY-MM-DD")
    parser.add_argument("--query",  help="Natural language query")
    parser.add_argument("--out",    help="Write result JSON to this file")
    args = parser.parse_args()

    async def main():
        result = await run_trend_analysis(
            campus=args.campus,
            start_date=args.start,
            end_date=args.end,
            user_query=args.query,
        )
        print("\n" + "=" * 60)
        print("FINAL REPORT")
        print("=" * 60)
        print(result["final_report"])
        print(f"\nTotal time: {result['_total_time']:.2f}s")

        if args.out:
            os.makedirs(os.path.dirname(args.out) if os.path.dirname(args.out) else ".", exist_ok=True)
            with open(args.out, "w") as f:
                json.dump(
                    {k: v for k, v in result.items() if k != "raw_reports"},
                    f, indent=2, default=str
                )
            print(f"Result written to {args.out}")

    asyncio.run(main())