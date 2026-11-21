import json, random, math, uuid

# ---------------------------------------------------------------------------
# Own A Bank simulation engine.
# Public functions called from app.js: new_game, summary, tick, hire, approve_loan,
# reject_loan, campaign, action, resolve_event, give_raise, offline_catchup.
# Mutating functions change the bank dict in place; tick() also returns it.
# ---------------------------------------------------------------------------

LOAN_RATE = {"conservative": 0.085, "balanced": 0.10, "growth": 0.115}
DEFAULT_RATE = {"conservative": 0.00006, "balanced": 0.00012, "growth": 0.0002}
FEE_PER_ACCOUNT = 16.0      # daily service fee income per deposit account
FEE_PER_TX = 22.0           # fee income per transaction
FUNDING_RATE_DEPOSITS = 0.022
FUNDING_RATE_WHOLESALE = 0.055

MARKETS = {
    "Stable":     {"dep": 0.0,     "default": 1.0,  "demand": 1.0, "yield": 0.035},
    "Expanding":  {"dep": 0.0012,  "default": 0.85, "demand": 1.5, "yield": 0.040},
    "Tightening": {"dep": -0.0008, "default": 1.25, "demand": 0.8, "yield": 0.045},
    "Stressed":   {"dep": -0.0018, "default": 1.7,  "demand": 0.6, "yield": 0.050},
}
MARKET_NEXT = {
    "Stable":     [("Stable", .35), ("Expanding", .35), ("Tightening", .27), ("Stressed", .03)],
    "Expanding":  [("Stable", .50), ("Expanding", .30), ("Tightening", .20)],
    "Tightening": [("Stable", .45), ("Tightening", .20), ("Stressed", .15), ("Expanding", .20)],
    "Stressed":   [("Tightening", .50), ("Stable", .40), ("Stressed", .10)],
}
MARKET_TEXT = {
    "Stable": "Market conditions have settled. Customer behaviour and credit quality look steady.",
    "Expanding": "The local economy is expanding. Deposits and loan demand are rising, and defaults are easing.",
    "Tightening": "Conditions are tightening. Deposit growth is slowing and credit risk is edging up.",
    "Stressed": "The market is under stress. Deposit outflows and loan defaults are more likely. Protect liquidity.",
}

ADVERSE = {"increase withdrawals", "delay repayments", "move deposits"}
POSITIVE = {"increase savings", "adopt digital services"}
SEV_MAG = {"limited": 0.5, "moderate": 1.0, "elevated": 1.6, "material": 2.4}
DIFF_MAG = {"easy": 0.8, "medium": 1.0, "hard": 1.25}
IMPACT_TEXT = {
    "increase withdrawals": "Expected impact: deposits flow out for about {d} days, reducing cash.",
    "move deposits": "Expected impact: customers move deposits to rivals for about {d} days.",
    "delay repayments": "Expected impact: more loans may become non-performing over about {d} days.",
    "seek refinancing": "Expected impact: extra loan applications arrive over about {d} days.",
    "compare lending rates": "Expected impact: extra loan applications arrive over about {d} days.",
    "increase savings": "Expected impact: deposits grow for about {d} days.",
    "adopt digital services": "Expected impact: new customers join for about {d} days if service quality is good.",
}
BEST_RESPONSE = {
    "increase withdrawals": {"review liquidity planning", "strengthen customer communication"},
    "move deposits": {"strengthen customer communication", "improve service capacity"},
    "delay repayments": {"reassess credit exposure", "adjust lending criteria"},
    "seek refinancing": {"adjust lending criteria", "review liquidity planning"},
    "compare lending rates": {"adjust lending criteria", "review operating expenditure"},
    "increase savings": {"review liquidity planning", "strengthen customer communication"},
    "adopt digital services": {"improve service capacity", "strengthen customer communication"},
}
SALARY_BENCH = {
    "Operations Manager": 2800, "Credit Officer": 2300, "Risk Analyst": 2300, "Compliance Officer": 2300,
    "Technology Officer": 2600, "Customer Service Associate": 1500, "Branch Manager": 2900,
    "Finance Officer": 2100, "Human Resources Officer": 2100, "Branch Operations Officer": 2400,
    "Credit Analyst": 2200,
}


def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex[:10]


def money(v):
    return round(float(v), 2)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def abs_day(b):
    return (b["year"] - 2026) * 365 + b["day"]


# ---------------------------------------------------------------------------
# Regional market context (derived from the selected headquarters location)
# ---------------------------------------------------------------------------
# The headquarters population picks a market tier. Tiers change the *environment*
# (size of the rest of the market, rival strength, loan demand, default pressure,
# operating costs, competitor activity). They never change the starting balance sheet.
REGION_TIERS = [
    (5000,    "Village market",      {"rest": 6000000.0,  "rival": 0.6, "demand": 0.70, "default": 1.00, "cost": 0.85, "activity": 0.70}),
    (20000,   "Town market",         {"rest": 12000000.0, "rival": 0.8, "demand": 0.85, "default": 1.00, "cost": 0.92, "activity": 0.85}),
    (100000,  "Small-city market",   {"rest": 18000000.0, "rival": 1.0, "demand": 1.00, "default": 1.00, "cost": 1.00, "activity": 1.00}),
    (500000,  "City market",         {"rest": 30000000.0, "rival": 1.3, "demand": 1.15, "default": 1.03, "cost": 1.08, "activity": 1.15}),
    (2000000, "Large-city market",   {"rest": 50000000.0, "rival": 1.6, "demand": 1.30, "default": 1.05, "cost": 1.18, "activity": 1.30}),
    (None,    "Metropolitan market", {"rest": 90000000.0, "rival": 2.0, "demand": 1.50, "default": 1.08, "cost": 1.30, "activity": 1.50}),
]
BASELINE_TIER = 2  # Small-city market == the pre-regional behaviour of the engine


def region_tier(population):
    try:
        pop = int(population)
    except (TypeError, ValueError):
        pop = 0
    if pop <= 0:
        return BASELINE_TIER, False
    for i, (limit, _label, _params) in enumerate(REGION_TIERS):
        if limit is None or pop < limit:
            return i, True
    return len(REGION_TIERS) - 1, True


def build_region(details, legacy=False):
    details = details if isinstance(details, dict) else {}
    if legacy:
        idx, known = BASELINE_TIER, False
    else:
        idx, known = region_tier(details.get("population"))
    _limit, label, params = REGION_TIERS[idx]
    region = dict(params)
    region.update({
        "tier": idx, "label": label if not legacy else "Baseline market (saved before regional markets)",
        "population": details.get("population"), "population_known": known and not legacy,
        "city": details.get("city"), "province": details.get("province"), "region": details.get("region"),
        "country": details.get("country"), "country_code": details.get("country_code"),
        "place_id": details.get("place_id"), "admin1_code": details.get("admin1_code"), "admin2_code": details.get("admin2_code"),
        "legacy": bool(legacy),
    })
    return region


def region_of(b):
    r = b.get("region")
    if not isinstance(r, dict) or "rest" not in r:
        r = build_region(b.get("location_details"), legacy=True)
        b["region"] = r
    return r


def apply_regional_context(b, details=None, rescale_rivals=True):
    """Initialise the regional market from the headquarters location (new games).
    details: {country, country_code, region, province, city, population, place_id, admin1_code, admin2_code}"""
    if details is None:
        details = b.get("location_details")
    if isinstance(details, dict):
        b["location_details"] = details
    region = build_region(details, legacy=False)
    b["region"] = region
    if rescale_rivals:
        for r in b.get("competitors", []):
            r["deposits"] = money(r["deposits"] * region["rival"])
            r["assets"] = money(r["assets"] * region["rival"])
    b["market_total_deposits"] = money(b["deposits"] + sum(r["deposits"] for r in b.get("competitors", [])) + region["rest"])
    for r in b.get("competitors", []):
        r["market_share"] = round(r["deposits"] / max(1, b["market_total_deposits"]) * 100, 2)
    return {"ok": True, "region": region}


# ---------------------------------------------------------------------------
# Setup and save migration
# ---------------------------------------------------------------------------

def new_game(name, location, difficulty, seed=None):
    rng = random.Random(seed)
    bank = {
        "id": uid("bank"), "name": name.strip() or "Northstar Community Bank",
        "location": location, "difficulty": difficulty, "level": 1, "xp": 0,
        "day": 1, "year": 2026, "paused": False, "speed": 1,
        "cash": 8200000.0, "loans": 1800000.0, "other_assets": 300000.0,
        "deposits": 7200000.0, "wholesale_funding": 0.0, "other_liabilities": 0.0,
        "equity": 3100000.0, "retained_earnings": 0.0,
        "cumulative_income": 0.0, "cumulative_expenses": 0.0, "net_income": 0.0,
        "customers": 420, "accounts": 510, "transactions": 0, "confidence": 78.0,
        "branches": 1, "employees": [], "competitors": [], "events": [],
        "loan_applications": [], "credit_policy": "balanced", "service_quality": 60.0,
        "market_condition": "Stable", "market_days_left": 24, "last_active": None, "event_counter": 0,
        "market_total_deposits": 42000000.0, "reputation": 55.0, "npl": 0.0,
        "effects": [], "campaign_log": [], "last_pnl": {},
        "history": [], "created_at": None, "version": 1
    }
    roles = [
        ("Mara Villanueva", "Branch Operations Officer", "Operations", 76, 73, 2400),
        ("Noah Reyes", "Credit Analyst", "Credit", 72, 69, 2200),
        ("Aira Santos", "Customer Service Associate", "Customer Service", 81, 80, 1500),
        ("Ethan Cruz", "Finance Officer", "Finance", 78, 74, 2100)
    ]
    for n, role, dept, comp, loyalty, salary in roles:
        bank["employees"].append({"id": uid("emp"), "name": n, "role": role, "department": dept,
                                   "competence": comp, "loyalty": loyalty, "morale": 76,
                                   "salary": salary, "experience": rng.randint(1, 5)})
    rival_specs = [
        ("Harborline Savings Bank", location, "conservative", 12500000, 9000000, 76),
        ("Meridian Commercial Bank", location, "aggressive", 19500000, 14700000, 70),
        ("Civic First Bank", location, "digital-focused", 10000000, 7600000, 82)
    ]
    for name2, loc, strategy, assets_, deposits, reputation in rival_specs:
        bank["competitors"].append({"id": uid("rival"), "name": name2, "location": loc,
            "strategy": strategy, "assets": assets_, "deposits": deposits,
            "reputation": reputation, "market_share": 0.0, "last_move": "Maintaining operations"})
    bank["loan_applications"] = [make_application(rng) for _ in range(3)]
    bank["history"].append({"day": 1, "text": "Your institution commenced operations with its founding team and initial customer base."})
    return bank


def migrate(b):
    """Make older saves compatible with the current engine. Safe to call repeatedly."""
    b.setdefault("npl", 0.0)
    b.setdefault("effects", [])
    b.setdefault("campaign_log", [])
    b.setdefault("last_pnl", {})
    b.setdefault("wholesale_funding", 0.0)
    b.setdefault("other_liabilities", 0.0)
    b.setdefault("service_quality", 60.0)
    b.setdefault("reputation", 55.0)
    b.setdefault("market_condition", "Stable")
    if b["market_condition"] not in MARKETS:
        b["market_condition"] = "Stable"
    b.setdefault("market_days_left", 20)
    b.setdefault("event_counter", 0)
    b.setdefault("retained_earnings", 0.0)
    region_of(b)
    for a in b.get("loan_applications", []):
        a.setdefault("age", 0)
    for e in b.get("events", []):
        e.setdefault("age", 0)
        if isinstance(e.get("severity"), str):
            e["severity"] = e["severity"].capitalize()
    return b


def make_application(rng):
    amount = rng.choice([80000, 120000, 180000, 250000, 350000, 500000])
    quality = rng.randint(42, 94)
    return {"id": uid("loan"), "borrower": rng.choice(["Luntian Trading", "Santos Family Enterprise", "Eastern Supply Cooperative", "Baybay Food Services", "Visayan Agri Ventures", "Harbor Logistics"]),
            "amount": amount, "credit_score": quality, "purpose": rng.choice(["Working capital", "Equipment financing", "Business expansion", "Agricultural operations"]),
            "risk": "Lower" if quality >= 76 else ("Moderate" if quality >= 60 else "Elevated"), "age": 0}


# ---------------------------------------------------------------------------
# Balance sheet helpers
# ---------------------------------------------------------------------------

def assets(b):
    return money(b["cash"] + b["loans"] + b["other_assets"])


def liabilities(b):
    return money(b["deposits"] + b["wholesale_funding"] + b["other_liabilities"])


def recalc_equity(b):
    b["equity"] = money(assets(b) - liabilities(b))
    return b["equity"]


def spend(b, amount):
    """Pay an operating expense from cash and record it in the income statement."""
    b["cash"] = money(b["cash"] - amount)
    b["cumulative_expenses"] = money(b["cumulative_expenses"] + amount)
    b["net_income"] = money(b["net_income"] - amount)
    recalc_equity(b)


def stage(level):
    bands = [(10, "STARTER"), (20, "DEVELOPING"), (35, "ESTABLISHED"), (50, "REGIONAL"), (65, "NATIONAL"), (80, "MAJOR"), (90, "INTERNATIONAL"), (100, "GLOBAL")]
    for cap, label in bands:
        if level <= cap:
            return label
    return "GLOBAL"


def staff_profile(b):
    emps = b["employees"]

    def w(*words):
        return sum(e["competence"] / 75.0 for e in emps if any(x in (e["role"] + " " + e["department"]).lower() for x in words))
    p = {"credit": w("credit"), "service": w("customer service"), "finance": w("finance"),
         "ops": w("operations", "branch"), "risk": w("risk", "compliance"),
         "tech": w("technology"), "hr": w("human resources")}
    avg_comp = sum(e["competence"] for e in emps) / max(1, len(emps))
    p["default_mult"] = max(0.6, 1 - 0.06 * p["credit"] - 0.03 * p["risk"])
    p["event_mult"] = max(0.6, 1 - 0.05 * p["risk"])
    p["yield_bonus"] = min(0.006, 0.0012 * p["finance"])
    p["capacity"] = 300 + 85 * len(emps) + 60 * p["ops"] + 300 * (b["branches"] - 1)
    p["service_target"] = clamp(38 + 8 * p["service"] + 0.12 * avg_comp + 2 * p["tech"], 30, 92)
    p["fee_mult"] = 1 + 0.03 * p["tech"]
    p["morale_bonus"] = 0.8 * p["hr"]
    return p


def summary(b):
    a = assets(b)
    l = liabilities(b)
    capital = (b["equity"] / a * 100) if a > 0 else 0
    liquidity = (b["cash"] / b["deposits"] * 100) if b["deposits"] > 0 else 0
    npl = b.get("npl", 0.0)
    p = staff_profile(b)
    return {
        "assets": a, "liabilities": l, "equity": money(b["equity"]),
        "capital_ratio": round(capital, 2), "liquidity_ratio": round(liquidity, 2),
        "npl": money(npl), "npl_ratio": round((npl / b["loans"] * 100) if b["loans"] else 0, 2),
        "stage": stage(b["level"]), "payroll": sum(e["salary"] for e in b["employees"]),
        "morale": round(sum(e["morale"] for e in b["employees"]) / max(1, len(b["employees"])), 1),
        "market_share": round(b["deposits"] / max(1, b["market_total_deposits"]) * 100, 2),
        "capacity": int(p["capacity"]), "service_quality": round(b.get("service_quality", 60), 1),
        "pnl": b.get("last_pnl", {}), "active_effects": len(b.get("effects", [])),
        "market_label": region_of(b).get("label"), "market_population": region_of(b).get("population"),
        "market_known": region_of(b).get("population_known", False)
    }


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def add_event(b, title, description, severity="Moderate", category="Market", choices=None, status=None, impact=None):
    b["event_counter"] += 1
    choices = choices or []
    ev = {"id": uid("event"), "day": b["day"], "title": title, "description": description,
          "severity": str(severity).capitalize(), "category": category,
          "status": status or ("Open" if choices else "Noted"),
          "choices": choices, "level": b["level"], "age": 0}
    if impact:
        ev["impact"] = impact
    b["events"].insert(0, ev)
    b["events"] = b["events"][:60]
    return ev


def choose(seq, rng):
    return seq[rng.randrange(len(seq))] if seq else ""


def slug(text):
    return text.lower().replace(" ", "_")


def open_events(b):
    return sum(1 for e in b["events"] if e.get("status") == "Open")


def generate_event(b, data, rng, p):
    if open_events(b) >= 4:
        return None
    diff = data["probability_ranges"][b["difficulty"]]
    context = next((x for x in data["level_context"] if x["min"] <= b["level"] <= x["max"]), data["level_context"][-1])
    base = rng.uniform(*diff["event"]) * 0.7
    risk_pressure = 0.0
    if b["cash"] < b["deposits"] * 0.12: risk_pressure += 0.12
    if b.get("npl", 0) / max(1, b["loans"]) > 0.08: risk_pressure += 0.08
    if b["confidence"] < 45: risk_pressure += 0.06
    chance = min(0.78, base + risk_pressure)
    if rng.random() > chance:
        return None
    terms = data["terms"]
    subject = choose(terms["subjects"], rng)
    pressure = choose(terms["pressures"], rng)
    behavior = choose(terms["behaviors"], rng)
    direction = choose(terms["directions"], rng)
    scope = choose(context["scope"], rng)
    severity = choose(terms["severity"], rng)
    if b["level"] < 11 and scope in ("cross-border operations", "national financial market"):
        scope = "local market"
    city = (region_of(b).get("city") or "").strip()
    if city and scope == "local market":
        scope = f"{city} market"
    if severity == "material" and b["level"] < 21:
        severity = "elevated"
    title_options = [
        (f"Changing activity among {subject}", f"In the {scope}, {subject} are responding to {pressure}. Some may {behavior}. The trend is currently {direction}."),
        (f"Market pressure: {pressure}", f"Conditions in the {scope} are showing {direction} signals. Your institution may need to consider how {subject} could {behavior}."),
        ("Customer and market development", f"New information suggests {subject} in the {scope} may {behavior} amid {pressure}. The scale is still developing.")
    ]
    title, desc = choose(title_options, rng)
    mag = SEV_MAG.get(severity, 1.0) * DIFF_MAG.get(b["difficulty"], 1.0)
    if behavior in ADVERSE:
        mag *= p["event_mult"]
    days = int(5 + SEV_MAG.get(severity, 1.0) * 3)
    shown = "Positive" if behavior in POSITIVE else severity.capitalize()
    cost = int(round(4000 + 6000 * mag, -2))
    pool = list(terms["actions"])
    rng.shuffle(pool)
    choices = [{"label": "Monitor conditions", "action": "monitor"}]
    for lab in pool[:2]:
        choices.append({"label": f"{lab} (₱{cost:,})", "action": "respond:" + slug(lab)})
    ev = add_event(b, title, desc, shown, "Market", choices, impact=IMPACT_TEXT.get(behavior, "").format(d=days))
    ev["behavior"] = behavior
    ev["response_cost"] = cost
    b["effects"].append({"id": uid("fx"), "event_id": ev["id"], "kind": behavior, "days_left": days,
                         "strength": round(mag, 3), "title": title})
    return ev


def apply_effects(b, rng):
    keep = []
    for fx in b["effects"]:
        k, s = fx["kind"], fx["strength"]
        if k == "increase withdrawals":
            out = min(b["cash"] * 0.5, b["deposits"] * 0.0018 * s)
            b["deposits"] = money(b["deposits"] - out)
            b["cash"] = money(b["cash"] - out)
        elif k == "move deposits":
            out = min(b["cash"] * 0.5, b["deposits"] * 0.0012 * s)
            b["deposits"] = money(b["deposits"] - out)
            b["cash"] = money(b["cash"] - out)
            b["customers"] = max(20, b["customers"] - int(round(1 * s)))
            if b["competitors"]:
                r = max(b["competitors"], key=lambda x: x["reputation"])
                r["deposits"] = money(r["deposits"] + out)
        elif k == "delay repayments":
            b["npl"] = money(min(b["loans"], b.get("npl", 0) + b["loans"] * 0.0009 * s))
        elif k in ("seek refinancing", "compare lending rates"):
            if rng.random() < min(0.9, 0.35 * s):
                b["loan_applications"].append(make_application(rng))
                b["loan_applications"] = b["loan_applications"][-8:]
        elif k == "increase savings":
            gain = b["deposits"] * 0.0015 * s
            b["deposits"] = money(b["deposits"] + gain)
            b["cash"] = money(b["cash"] + gain)
        elif k == "adopt digital services":
            n = int(round(2 * s))
            b["customers"] += n if b["service_quality"] >= 55 else -max(0, n // 2)
        fx["days_left"] -= 1
        if fx["days_left"] > 0:
            keep.append(fx)
    b["effects"] = keep


# ---------------------------------------------------------------------------
# Daily simulation
# ---------------------------------------------------------------------------

def update_market(b, rng, outputs):
    b["market_days_left"] -= 1
    if b["market_days_left"] > 0:
        return
    options = MARKET_NEXT[b["market_condition"]]
    r = rng.random()
    total = 0.0
    new = options[-1][0]
    for name, wgt in options:
        total += wgt
        if r <= total:
            new = name
            break
    b["market_days_left"] = rng.randint(14, 40)
    if new != b["market_condition"]:
        b["market_condition"] = new
        outputs.append(add_event(b, f"Market conditions: {new}", MARKET_TEXT[new],
                                 "Positive" if new == "Expanding" else ("Material" if new == "Stressed" else "Moderate"),
                                 "Market", status="Noted"))


def tick(b, data, count=1, seed=None):
    migrate(b)
    rng = random.Random(seed)
    outputs = []
    for _ in range(max(1, min(100, int(count)))):
        if b.get("paused"):
            break
        b["day"] += 1
        if b["day"] > 365:
            b["day"] = 1
            b["year"] += 1
        update_market(b, rng, outputs)
        mk = MARKETS[b["market_condition"]]
        rg = region_of(b)
        p = staff_profile(b)

        # Ageing: lapsed situations close, stale loan applications go to other banks.
        for e in b["events"]:
            e["age"] = e.get("age", 0) + 1
            if e.get("status") == "Open" and e["age"] > 10:
                e["status"] = "Lapsed"
        for a in b["loan_applications"]:
            a["age"] = a.get("age", 0) + 1
        b["loan_applications"] = [a for a in b["loan_applications"] if a["age"] <= 14]

        # Active event impacts play out.
        apply_effects(b, rng)

        # Deposits: confidence, service, the market cycle and room left in the market all matter.
        share = b["deposits"] / max(1, b["market_total_deposits"]) * 100
        room = clamp(1.4 - share / 14.0, 0.1, 1.2)
        drift = (b["confidence"] - 60) * 0.00004 + (b["service_quality"] - 60) * 0.00002 + mk["dep"]
        delta = b["deposits"] * (drift * room + rng.uniform(-0.0020, 0.0026))
        if delta < 0:
            delta = -min(-delta, b["cash"] * 0.5)
        b["deposits"] = money(max(100000, b["deposits"] + delta))
        b["cash"] = money(max(0, b["cash"] + delta))
        b["customers"] = max(20, int(b["customers"] + round(delta / 17000.0 + rng.uniform(-1.0, 1.5))))
        target_accounts = b["customers"] * 1.215
        b["accounts"] = max(b["customers"], int(round(b["accounts"] + (target_accounts - b["accounts"]) * 0.25)))
        tx_today = int(b["customers"] * rng.uniform(0.07, 0.2))
        b["transactions"] = tx_today

        # Income statement.
        performing = max(0.0, b["loans"] - b.get("npl", 0.0))
        interest_income = performing * LOAN_RATE[b["credit_policy"]] / 365
        treasury_income = max(0.0, b["cash"]) * (mk["yield"] + p["yield_bonus"]) / 365
        fee_income = (b["accounts"] * FEE_PER_ACCOUNT + tx_today * FEE_PER_TX) * p["fee_mult"]
        funding_cost = (b["deposits"] * FUNDING_RATE_DEPOSITS + b["wholesale_funding"] * FUNDING_RATE_WHOLESALE) / 365
        payroll = sum(e["salary"] for e in b["employees"])
        operating = (1750 + 650 + (b["branches"] - 1) * 1400 + len(b["employees"]) * 160) * rg["cost"]

        # Credit book: repayments, new defaults, cures and write-offs.
        repay = performing * 0.0012
        b["loans"] = money(b["loans"] - repay)
        b["cash"] = money(b["cash"] + repay)
        new_default = max(0.0, b["loans"] - b.get("npl", 0.0)) * DEFAULT_RATE[b["credit_policy"]] * mk["default"] * rg["default"] * p["default_mult"] * rng.uniform(0.6, 1.4)
        npl = b.get("npl", 0.0) + new_default
        writeoff = npl * 0.004
        cure = npl * 0.004
        npl = max(0.0, npl - writeoff - cure)
        b["loans"] = money(max(0.0, b["loans"] - writeoff))
        b["npl"] = money(min(npl, b["loans"]))

        revenue = interest_income + treasury_income + fee_income
        costs = funding_cost + payroll + operating + writeoff
        daily_net = revenue - costs
        b["cash"] = money(b["cash"] + revenue - funding_cost - payroll - operating)
        b["cumulative_income"] = money(b["cumulative_income"] + revenue)
        b["cumulative_expenses"] = money(b["cumulative_expenses"] + costs)
        b["net_income"] = money(b["net_income"] + daily_net)
        b["last_pnl"] = {"day": b["day"], "interest": round(interest_income), "treasury": round(treasury_income),
                         "fees": round(fee_income), "funding_cost": round(funding_cost), "payroll": round(payroll),
                         "operating": round(operating), "writeoffs": round(writeoff), "net": round(daily_net)}

        # Cash safety valve: a bank cannot hold negative cash.
        if b["cash"] < 0:
            shortfall = -b["cash"]
            b["wholesale_funding"] = money(b["wholesale_funding"] + shortfall)
            b["cash"] = 0.0
            outputs.append(add_event(b, "Emergency liquidity support drawn",
                                     f"Cash ran out and ₱{shortfall:,.0f} of emergency wholesale funding was drawn at a penalty cost. Rebuild liquidity quickly.",
                                     "Material", "Risk", status="Noted"))
        recalc_equity(b)

        # Service quality, confidence and reputation respond to staffing, capacity and balance sheet strength.
        overload = max(0.0, (b["customers"] - p["capacity"]) / max(1.0, p["capacity"]) * 100)
        service_target = clamp(p["service_target"] - min(25, overload), 20, 95)
        b["service_quality"] = round(clamp(b["service_quality"] + (service_target - b["service_quality"]) * 0.03, 0, 100), 2)
        a_total = max(1.0, assets(b))
        capital_ratio = b["equity"] / a_total * 100
        liquidity_ratio = b["cash"] / max(1.0, b["deposits"]) * 100
        liq_score = clamp(liquidity_ratio * 0.9, 0, 100)
        cap_score = clamp(capital_ratio * 4, 0, 100)
        conf_target = 0.45 * b["service_quality"] + 0.25 * b["reputation"] + 0.2 * liq_score + 0.1 * cap_score
        if b.get("npl", 0) / max(1.0, b["loans"]) > 0.08:
            conf_target -= 8
        if capital_ratio < 8:
            conf_target -= 10
        b["confidence"] = round(clamp(b["confidence"] + (conf_target - b["confidence"]) * 0.03 + rng.uniform(-0.25, 0.25), 0, 100), 2)
        b["reputation"] = round(clamp(b["reputation"] + (b["confidence"] - b["reputation"]) * 0.01, 0, 100), 2)

        # Staff: morale follows pay versus role benchmark, confidence and HR support; loyalty follows morale.
        for e in list(b["employees"]):
            bench = SALARY_BENCH.get(e["role"], 1800)
            target = clamp(70 + (e["salary"] / bench - 1) * 80 + (b["confidence"] - 60) * 0.12 + p["morale_bonus"], 20, 96)
            e["morale"] = round(clamp(e["morale"] + (target - e["morale"]) * 0.04 + rng.uniform(-0.3, 0.3), 15, 99), 1)
            e["loyalty"] = round(clamp(e["loyalty"] + (e["morale"] - 62) * 0.006 + rng.uniform(-0.1, 0.1), 10, 99), 1)
            e["competence"] = round(clamp(e["competence"] + 0.01, 0, 99), 1)
            if e["loyalty"] < 35 and rng.random() < 0.03 and len(b["employees"]) > 1:
                b["employees"].remove(e)
                outputs.append(add_event(b, f"{e['name']} has resigned",
                                         f"{e['name']} ({e['role']}) left the institution. Low loyalty and pay below expectations were contributing factors.",
                                         "Elevated", "People", status="Noted"))

        # Competitors act on their own strategies and sometimes pressure your deposit base.
        for rival in b["competitors"]:
            drift_r = rng.uniform(-0.002, 0.004) if rival["strategy"] == "aggressive" else rng.uniform(-0.001, 0.002)
            rival["deposits"] = money(max(100000, rival["deposits"] * (1 + drift_r)))
            rival["assets"] = money(max(rival["deposits"] * 1.02, rival["assets"] * (1 + drift_r * 0.8)))
            if rng.random() < 0.035 * rg["activity"]:
                move = rng.choice(["Adjusted deposit pricing", "Expanded digital services", "Tightened credit standards", "Increased local marketing", "Reviewed branch network"])
                rival["last_move"] = move
                if move in ("Adjusted deposit pricing", "Increased local marketing") and open_events(b) < 4:
                    mag = 0.6 * DIFF_MAG.get(b["difficulty"], 1.0)
                    cost = int(round(4000 + 6000 * mag, -2))
                    ev = add_event(b, f"Competitor activity: {rival['name']}",
                                   f"{rival['name']} has {move.lower()}. Some of your customers may compare offers.",
                                   "Limited", "Competition",
                                   [{"label": "Monitor conditions", "action": "monitor"},
                                    {"label": f"Strengthen customer communication (₱{cost:,})", "action": "respond:strengthen_customer_communication"}],
                                   impact="Expected impact: customers move deposits to rivals for about 6 days.")
                    ev["behavior"] = "move deposits"
                    ev["response_cost"] = cost
                    b["effects"].append({"id": uid("fx"), "event_id": ev["id"], "kind": "move deposits", "days_left": 6,
                                         "strength": round(mag, 3), "title": ev["title"]})
                    outputs.append(ev)
        b["market_total_deposits"] = money(b["deposits"] + sum(r["deposits"] for r in b["competitors"]) + rg["rest"])
        for r in b["competitors"]:
            r["market_share"] = round(r["deposits"] / max(1, b["market_total_deposits"]) * 100, 2)

        # XP and level progression from responsible, sustained operations.
        b["xp"] += max(1, int(max(0, daily_net) / 3500) + 2)
        while b["level"] < 100 and b["xp"] >= b["level"] * 95:
            b["xp"] -= b["level"] * 95
            b["level"] += 1
            outputs.append(add_event(b, f"Institutional milestone: Level {b['level']}", f"Your bank has reached the {stage(b['level'])} stage. New scale and complexity may become relevant as your institution develops.", "Positive", "Progression", status="Noted"))

        # Loan demand depends on the market cycle and your credit team.
        if rng.random() < 0.13 * mk["demand"] * rg["demand"] * (1 + 0.15 * p["credit"]):
            b["loan_applications"].append(make_application(rng))
            b["loan_applications"] = b["loan_applications"][-8:]

        # Market and customer developments (with real consequences).
        ev = generate_event(b, data, rng, p)
        if ev:
            outputs.append(ev)

        # Risk warnings that depend on balance sheet condition.
        if b["cash"] < b["deposits"] * 0.08 and not any(e["title"] == "Liquidity pressure requires attention" and e["status"] == "Open" for e in b["events"]):
            outputs.append(add_event(b, "Liquidity pressure requires attention", "Your available cash has fallen relative to customer deposit obligations. Review liquidity, funding, and lending decisions promptly.", "Material", "Risk", [{"label": "Seek wholesale funding", "action": "funding"}, {"label": "Tighten new lending", "action": "tighten"}, {"label": "Monitor and preserve cash", "action": "monitor"}]))
        if b.get("npl", 0) > b["loans"] * 0.1 and not any(e["title"] == "Credit quality deterioration" and e["status"] == "Open" for e in b["events"]):
            outputs.append(add_event(b, "Credit quality deterioration", "A growing portion of the loan portfolio is not performing as expected. Review underwriting and collection practices.", "Elevated", "Credit", [{"label": "Tighten lending policy", "action": "tighten"}, {"label": "Invest in collections (₱15,000)", "action": "collections"}]))
        if b["confidence"] < 40 and rng.random() < 0.08 and not any(f["kind"] == "increase withdrawals" and f["title"] == "Depositor concern" for f in b["effects"]):
            ev = add_event(b, "Depositor concern", "Customer confidence has fallen sharply and depositors are withdrawing funds.", "Material", "Risk", status="Noted",
                           impact="Expected impact: heavy deposit outflows for about 6 days.")
            b["effects"].append({"id": uid("fx"), "event_id": ev["id"], "kind": "increase withdrawals", "days_left": 6, "strength": 2.0, "title": "Depositor concern"})
            outputs.append(ev)
        recalc_equity(b)
    return {"bank": b, "new_events": outputs, "summary": summary(b)}


# ---------------------------------------------------------------------------
# Player decisions
# ---------------------------------------------------------------------------

def hire(b, name, role, department, salary):
    migrate(b)
    salary = max(700, min(15000, int(salary)))
    if b["cash"] < salary * 10:
        return {"ok": False, "message": "Insufficient cash buffer for this recruitment commitment."}
    employee = {"id": uid("emp"), "name": name.strip() or "New Employee", "role": role, "department": department,
                "competence": random.randint(58, 88), "loyalty": random.randint(55, 82), "morale": 72,
                "salary": salary, "experience": random.randint(0, 8)}
    b["employees"].append(employee)
    b["cash"] = money(b["cash"] - salary * 5)
    b["other_assets"] = money(b["other_assets"] + salary * 5)  # onboarding and recruitment prepayment asset proxy
    b["xp"] += 10
    bench = SALARY_BENCH.get(role, 1800)
    note = " Pay is below the usual range for this role, so morale may suffer." if salary < bench * 0.85 else ""
    return {"ok": True, "message": f"{employee['name']} joined as {role}. Daily payroll rises by ₱{salary:,}.{note}", "employee": employee}


def give_raise(b, employee_id):
    migrate(b)
    e = next((x for x in b["employees"] if x["id"] == employee_id), None)
    if not e:
        return {"ok": False, "message": "Employee not found."}
    if e["salary"] >= 15000:
        return {"ok": False, "message": "This salary is already at the maximum."}
    new_salary = min(15000, int(round(e["salary"] * 1.1)))
    e["salary"] = new_salary
    e["morale"] = round(min(99, e["morale"] + 5), 1)
    e["loyalty"] = round(min(99, e["loyalty"] + 3), 1)
    return {"ok": True, "message": f"{e['name']} received a raise to ₱{new_salary:,} per day. Morale and loyalty improved."}


def approve_loan(b, application_id):
    migrate(b)
    app = next((x for x in b["loan_applications"] if x["id"] == application_id), None)
    if not app:
        return {"ok": False, "message": "This application is no longer available."}
    if app["amount"] > b["cash"] * 0.35:
        return {"ok": False, "message": "The requested amount is too large relative to currently available liquidity."}
    if app["credit_score"] < 48 and b["credit_policy"] != "growth":
        return {"ok": False, "message": "The application falls below the current policy's indicative credit threshold."}
    b["cash"] = money(b["cash"] - app["amount"])
    b["loans"] = money(b["loans"] + app["amount"])
    fee = app["amount"] * 0.005
    b["cash"] = money(b["cash"] + fee)
    b["cumulative_income"] = money(b["cumulative_income"] + fee)
    b["net_income"] = money(b["net_income"] + fee)
    if app["credit_score"] < 62:
        b["npl"] = money(b.get("npl", 0) + app["amount"] * 0.07)
    b["loan_applications"].remove(app)
    b["xp"] += 25
    recalc_equity(b)
    return {"ok": True, "message": f"Loan of ₱{app['amount']:,} approved for {app['borrower']}. Origination fee ₱{fee:,.0f} earned; it will now earn interest daily."}


def reject_loan(b, application_id):
    migrate(b)
    app = next((x for x in b["loan_applications"] if x["id"] == application_id), None)
    if not app:
        return {"ok": False, "message": "This application is no longer available."}
    b["loan_applications"].remove(app)
    b["confidence"] = min(100, b["confidence"] + (0.2 if app["credit_score"] < 55 else -0.15))
    return {"ok": True, "message": "Application declined and recorded in the credit decision history."}


def campaign(b):
    migrate(b)
    cost = 18000
    today = abs_day(b)
    b["campaign_log"] = [d for d in b["campaign_log"] if today - d < 10]
    if b["campaign_log"] and today - b["campaign_log"][-1] < 2:
        wait = 2 - (today - b["campaign_log"][-1])
        return {"ok": False, "message": f"Your marketing team is still running the last campaign. Try again in {wait} day{'s' if wait != 1 else ''}."}
    if b["cash"] < cost:
        return {"ok": False, "message": "Insufficient available cash for this campaign."}
    eff = 1.0 / (1 + len(b["campaign_log"]))
    share = b["deposits"] / max(1, b["market_total_deposits"]) * 100
    room = clamp(1.4 - share / 14.0, 0.15, 1.2)
    spend(b, cost)
    gain = random.uniform(0.008, 0.024) * b["deposits"] * eff * room
    new_customers = max(1, int(random.randint(12, 38) * eff * room))
    b["deposits"] = money(b["deposits"] + gain)
    b["cash"] = money(b["cash"] + gain)
    b["customers"] += new_customers
    b["confidence"] = min(100, b["confidence"] + 1.2 * eff)
    b["xp"] += 18
    b["campaign_log"].append(today)
    recalc_equity(b)
    note = " Repeated campaigns are less effective." if eff < 1 else ""
    return {"ok": True, "message": f"Campaign cost ₱{cost:,} and attracted about ₱{gain:,.0f} in deposits and {new_customers} customers.{note}"}


def action(b, action_name):
    migrate(b)
    today = abs_day(b)
    if action_name == "service":
        if b["cash"] < 25000:
            return {"ok": False, "message": "Insufficient cash for the service improvement."}
        spend(b, 25000)
        b["service_quality"] = min(100, b["service_quality"] + 8)
        b["confidence"] = min(100, b["confidence"] + 3)
        return {"ok": True, "message": "Service quality +8 and confidence +3. Lasting gains also need customer service staff and spare capacity."}
    if action_name == "funding":
        amount = 500000
        if b["wholesale_funding"] + amount > b["deposits"] * 0.4:
            return {"ok": False, "message": "Wholesale funding is already high relative to your deposit base."}
        fee = amount * 0.005
        b["cash"] += amount
        b["wholesale_funding"] += amount
        spend(b, fee)
        add_event(b, "Wholesale funding arranged", "Your bank secured additional wholesale funding. Liquidity improved, but repayment and funding costs now matter.", "Moderate", "Treasury", status="Noted")
        return {"ok": True, "message": f"₱{amount:,} funding secured (fee ₱{fee:,.0f}). It costs about 5.5% a year and must be repaid."}
    if action_name == "repay":
        amount = min(b["wholesale_funding"], 500000, b["cash"] * 0.8)
        if amount < 1000:
            return {"ok": False, "message": "There is no wholesale funding to repay, or cash is too low."}
        b["cash"] = money(b["cash"] - amount)
        b["wholesale_funding"] = money(b["wholesale_funding"] - amount)
        recalc_equity(b)
        return {"ok": True, "message": f"Repaid ₱{amount:,.0f} of wholesale funding. Funding costs fall."}
    if action_name == "tighten":
        if b["credit_policy"] == "conservative":
            return {"ok": True, "message": "Credit policy is already conservative."}
        b["credit_policy"] = "conservative"
        return {"ok": True, "message": "Credit policy tightened. Lower lending income, fewer defaults."}
    if action_name == "retain":
        last = b.get("retain_day")
        if last is not None and today - last < 10:
            return {"ok": False, "message": "You recently retained earnings. Wait a few days before another statement."}
        b["retain_day"] = today
        b["retained_earnings"] += max(0, b["net_income"])
        b["reputation"] = min(100, b["reputation"] + 0.8)
        b["confidence"] = min(100, b["confidence"] + 0.8)
        return {"ok": True, "message": "Earnings retained. Reputation and confidence improved slightly."}
    if action_name == "collections":
        if b["cash"] < 15000:
            return {"ok": False, "message": "Insufficient cash for a collections drive."}
        spend(b, 15000)
        before = b.get("npl", 0)
        b["confidence"] = max(0, b["confidence"] - 0.5)
        b["npl"] = money(max(0, before * 0.85))
        return {"ok": True, "message": f"Collections drive cost ₱15,000 and recovered ₱{before - b['npl']:,.0f} of overdue balances."}
    if action_name == "branch":
        cost = 450000
        if b["level"] < 2:
            return {"ok": False, "message": "Branch expansion unlocks at Level 2."}
        if b["branches"] >= 5:
            return {"ok": False, "message": "You already operate the maximum number of branches."}
        if b["cash"] < cost * 2:
            return {"ok": False, "message": "Keep at least twice the branch cost in cash before expanding."}
        b["cash"] = money(b["cash"] - cost)
        b["other_assets"] = money(b["other_assets"] + cost)
        b["branches"] += 1
        b["customers"] += 40
        b["xp"] += 60
        return {"ok": True, "message": f"New branch opened for ₱{cost:,}. Capacity +300 customers; operating cost rises by ₱1,400 per day."}
    if action_name == "monitor":
        return {"ok": True, "message": "You chose to monitor conditions. The situation may evolve."}
    if action_name.startswith("respond"):
        b["confidence"] = min(100, b["confidence"] + 0.7)
        return {"ok": True, "message": "Management response initiated."}
    return {"ok": False, "message": "Unknown management action."}


def resolve_event(b, event_id, action_name):
    migrate(b)
    ev = next((e for e in b["events"] if e["id"] == event_id), None)
    if not ev or ev["status"] != "Open":
        return {"ok": False, "message": "This situation is no longer open."}
    if action_name.startswith("respond:"):
        label = action_name.split(":", 1)[1].replace("_", " ")
        cost = ev.get("response_cost", 8000)
        if b["cash"] < cost:
            return {"ok": False, "message": "Insufficient cash for this response."}
        spend(b, cost)
        behavior = ev.get("behavior")
        best = label in BEST_RESPONSE.get(behavior, set())
        fx = next((f for f in b["effects"] if f.get("event_id") == ev["id"]), None)
        b["confidence"] = min(100, b["confidence"] + 0.7)
        b["xp"] += 8
        if fx:
            if behavior in POSITIVE:
                fx["strength"] = round(fx["strength"] * (1.5 if best else 1.25), 3)
                msg = f"Response cost ₱{cost:,}. This {'strongly ' if best else ''}boosts the opportunity."
            else:
                fx["strength"] = round(fx["strength"] * (0.3 if best else 0.65), 3)
                msg = f"Response cost ₱{cost:,}. {'A well-matched response: the expected impact falls sharply.' if best else 'A partial response: the expected impact falls somewhat.'}"
        else:
            msg = f"Response cost ₱{cost:,}."
        ev["status"] = "Reviewed"
        ev["resolution"] = label
        ev["resolved_day"] = b["day"]
        return {"ok": True, "message": msg}
    result = action(b, action_name)
    if result["ok"]:
        ev["status"] = "Reviewed"
        ev["resolution"] = action_name
        ev["resolved_day"] = b["day"]
    return result


def offline_catchup(b, data, elapsed_seconds):
    migrate(b)
    seconds = max(0, min(86400, int(elapsed_seconds)))
    days = min(24, seconds / 86400)
    ticks = max(0, int(days * 24))  # 24 simulation ticks per real offline day
    if ticks:
        tick(b, data, ticks, seed=int(b["day"] * 17 + seconds))
    return {"simulated_ticks": ticks, "capped_seconds": seconds, "summary": summary(b)}
