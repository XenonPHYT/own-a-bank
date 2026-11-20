import json, random, math, uuid

def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex[:10]

def money(v):
    return round(float(v), 2)

def new_game(name, location, difficulty, seed=None):
    rng = random.Random(seed)
    # The foundation is the same across difficulties. Difficulty affects assistance and pressure.
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
        "market_condition": "Stable", "last_active": None, "event_counter": 0,
        "market_total_deposits": 42000000.0, "reputation": 55.0,
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
    for name2, loc, strategy, assets, deposits, reputation in rival_specs:
        bank["competitors"].append({"id": uid("rival"), "name": name2, "location": loc,
            "strategy": strategy, "assets": assets, "deposits": deposits,
            "reputation": reputation, "market_share": 0.0, "last_move": "Maintaining operations"})
    bank["loan_applications"] = [make_application(rng) for _ in range(3)]
    bank["history"].append({"day": 1, "text": "Your institution commenced operations with its founding team and initial customer base."})
    return bank

def make_application(rng):
    amount = rng.choice([80000, 120000, 180000, 250000, 350000, 500000])
    quality = rng.randint(42, 94)
    return {"id": uid("loan"), "borrower": rng.choice(["Luntian Trading", "Santos Family Enterprise", "Eastern Supply Cooperative", "Baybay Food Services", "Visayan Agri Ventures", "Harbor Logistics"]),
            "amount": amount, "credit_score": quality, "purpose": rng.choice(["Working capital", "Equipment financing", "Business expansion", "Agricultural operations"]),
            "risk": "Lower" if quality >= 76 else ("Moderate" if quality >= 60 else "Elevated")}

def assets(b):
    return money(b["cash"] + b["loans"] + b["other_assets"])

def liabilities(b):
    return money(b["deposits"] + b["wholesale_funding"] + b["other_liabilities"])

def recalc_equity(b):
    b["equity"] = money(assets(b) - liabilities(b))
    return b["equity"]

def stage(level):
    bands = [(10,"STARTER"),(20,"DEVELOPING"),(35,"ESTABLISHED"),(50,"REGIONAL"),(65,"NATIONAL"),(80,"MAJOR"),(90,"INTERNATIONAL"),(100,"GLOBAL")]
    for cap, label in bands:
        if level <= cap: return label
    return "GLOBAL"

def summary(b):
    a = assets(b); l = liabilities(b)
    capital = (b["equity"] / a * 100) if a > 0 else 0
    liquidity = (b["cash"] / b["deposits"] * 100) if b["deposits"] > 0 else 0
    npl = b.get("npl", 0.0)
    return {
        "assets": a, "liabilities": l, "equity": money(b["equity"]),
        "capital_ratio": round(capital, 2), "liquidity_ratio": round(liquidity, 2),
        "npl": money(npl), "npl_ratio": round((npl / b["loans"] * 100) if b["loans"] else 0, 2),
        "stage": stage(b["level"]), "payroll": sum(e["salary"] for e in b["employees"]),
        "morale": round(sum(e["morale"] for e in b["employees"]) / max(1,len(b["employees"])),1),
        "market_share": round(b["deposits"] / max(1,b["market_total_deposits"]) * 100,2)
    }

def add_event(b, title, description, severity="Moderate", category="Market", choices=None):
    b["event_counter"] += 1
    ev = {"id": uid("event"), "day": b["day"], "title": title, "description": description,
          "severity": severity, "category": category, "status": "Open",
          "choices": choices or [], "level": b["level"]}
    b["events"].insert(0, ev)
    b["events"] = b["events"][:60]
    return ev

def choose(seq, rng):
    return seq[rng.randrange(len(seq))] if seq else ""

def generate_event(b, data, rng):
    diff = data["probability_ranges"][b["difficulty"]]
    context = next((x for x in data["level_context"] if x["min"] <= b["level"] <= x["max"]), data["level_context"][-1])
    # Probability is context-filtered and modified by actual exposures; it is not a fixed event schedule.
    base = rng.uniform(*diff["event"])
    risk_pressure = 0.0
    if b["cash"] < b["deposits"] * 0.12: risk_pressure += 0.12
    if b.get("npl",0) / max(1,b["loans"]) > 0.08: risk_pressure += 0.08
    if b["confidence"] < 45: risk_pressure += 0.06
    chance = min(0.78, base + risk_pressure)
    if rng.random() > chance: return None
    terms = data["terms"]
    subject = choose(terms["subjects"], rng)
    pressure = choose(terms["pressures"], rng)
    behavior = choose(terms["behaviors"], rng)
    direction = choose(terms["directions"], rng)
    scope = choose(context["scope"], rng)
    severity = choose(terms["severity"], rng)
    if b["level"] < 11 and scope in ("cross-border operations", "national financial market"):
        scope = "local market"
    title_options = [
        (f"Changing activity among {subject}", f"In the {scope}, {subject} are responding to {pressure}. Some may {behavior}. The trend is currently {direction}."),
        (f"Market pressure: {pressure}", f"Conditions in the {scope} are showing {direction} signals. Your institution may need to consider how {subject} could {behavior}."),
        (f"Customer and market development", f"New information suggests {subject} in the {scope} may {behavior} amid {pressure}. The scale is still developing.")
    ]
    title, desc = choose(title_options, rng)
    if severity == "Material" and b["level"] < 21: severity = "Elevated"
    return add_event(b, title, desc, severity, "Market", [
        {"label":"Monitor conditions", "action":"monitor"},
        {"label":choose(terms["actions"],rng), "action":"respond"}
    ])

def tick(b, data, count=1, seed=None):
    rng = random.Random(seed)
    outputs = []
    for _ in range(max(1, min(100, int(count)))):
        if b.get("paused"): break
        b["day"] += 1
        if b["day"] > 365:
            b["day"] = 1; b["year"] += 1
        # Day-to-day deposit behavior, affected by confidence and service, with bounded random variation.
        deposit_delta = rng.uniform(-0.004, 0.006) * b["deposits"] + (b["confidence"]-60)*180
        b["deposits"] = max(100000, money(b["deposits"] + deposit_delta))
        b["cash"] = max(0, money(b["cash"] + deposit_delta * 0.72))
        b["customers"] = max(20, int(b["customers"] + rng.choice([-2,-1,0,0,1,2,3]) + (b["confidence"]-60)/35))
        b["accounts"] = max(b["customers"], int(b["accounts"] + rng.choice([-1,0,0,1,2])))
        b["transactions"] += rng.randint(24, 95)
        # Interest income, funding cost, operating expense and payroll.
        loan_rate = {"conservative":0.085,"balanced":0.10,"growth":0.115}[b["credit_policy"]]
        interest_income = b["loans"] * loan_rate / 365
        funding_cost = b["deposits"] * 0.022 / 365
        payroll = sum(e["salary"] for e in b["employees"])
        operating = 1750 + b["branches"] * 650 + len(b["employees"]) * 160
        credit_loss = b["loans"] * (0.000035 if b["credit_policy"]=="conservative" else 0.00006 if b["credit_policy"]=="balanced" else 0.000095)
        daily_net = interest_income - funding_cost - payroll - operating - credit_loss
        b["cash"] = money(b["cash"] + interest_income - funding_cost - payroll - operating)
        b["cumulative_income"] = money(b["cumulative_income"] + interest_income)
        b["cumulative_expenses"] = money(b["cumulative_expenses"] + funding_cost + payroll + operating + credit_loss)
        b["net_income"] = money(b["net_income"] + daily_net)
        b["equity"] = money(b["equity"] + daily_net)
        # Staff sentiment changes gradually based on salary burden, not random disloyalty.
        for e in b["employees"]:
            e["morale"] = max(15, min(99, e["morale"] + rng.uniform(-0.5,0.4) + (1 if e["salary"] >= 1800 else -0.4)))
            e["loyalty"] = max(10, min(99, e["loyalty"] + (0.12 if e["morale"] > 65 else -0.18)))
        # Competitor AI: strategy-led independent actions.
        for rival in b["competitors"]:
            drift = rng.uniform(-0.002,0.004) if rival["strategy"]=="aggressive" else rng.uniform(-0.001,0.002)
            rival["deposits"] = money(max(100000, rival["deposits"] * (1+drift)))
            rival["assets"] = money(max(rival["deposits"]*1.02, rival["assets"]*(1+drift*0.8)))
            if rng.random() < 0.035:
                rival["last_move"] = rng.choice(["Adjusted deposit pricing","Expanded digital services","Tightened credit standards","Increased local marketing","Reviewed branch network"])
        b["market_total_deposits"] = money(b["deposits"] + sum(r["deposits"] for r in b["competitors"]) + 18000000)
        # XP and level progression from responsible, sustained operations.
        b["xp"] += max(1, int(max(0, daily_net)/3500) + 2)
        while b["level"] < 100 and b["xp"] >= b["level"] * 95:
            b["xp"] -= b["level"] * 95
            b["level"] += 1
            outputs.append(add_event(b, f"Institutional milestone: Level {b['level']}", f"Your bank has reached the {stage(b['level'])} stage. New scale and complexity may become relevant as your institution develops.", "Positive", "Progression"))
        # Occasional loan applications are generated contextually.
        if rng.random() < 0.13:
            b["loan_applications"].append(make_application(rng))
            b["loan_applications"] = b["loan_applications"][-8:]
        # Competitor and market news emerges, not from a fixed schedule.
        ev = generate_event(b, data, rng)
        if ev: outputs.append(ev)
        # Distress warnings depend on balance sheet condition.
        if b["cash"] < b["deposits"] * 0.08 and not any(e["title"]=="Liquidity pressure requires attention" and e["status"]=="Open" for e in b["events"]):
            outputs.append(add_event(b, "Liquidity pressure requires attention", "Your available cash has fallen relative to customer deposit obligations. Review liquidity, funding, and lending decisions promptly.", "Material", "Risk", [{"label":"Seek wholesale funding","action":"funding"},{"label":"Tighten new lending","action":"tighten"},{"label":"Monitor and preserve cash","action":"monitor"}]))
        if b.get("npl",0) > b["loans"]*0.1 and not any(e["title"]=="Credit quality deterioration" and e["status"]=="Open" for e in b["events"]):
            outputs.append(add_event(b, "Credit quality deterioration", "A growing portion of the loan portfolio is not performing as expected. Review underwriting and collection practices.", "Elevated", "Credit", [{"label":"Tighten lending policy","action":"tighten"},{"label":"Invest in collections","action":"collections"}]))
        recalc_equity(b)
    return {"bank":b, "new_events":outputs, "summary":summary(b)}

def hire(b, name, role, department, salary):
    salary = max(700, min(15000, int(salary)))
    if b["cash"] < salary * 10:
        return {"ok":False,"message":"Insufficient cash buffer for this recruitment commitment."}
    employee = {"id":uid("emp"),"name":name.strip() or "New Employee","role":role,"department":department,
                "competence":random.randint(58,88),"loyalty":random.randint(55,82),"morale":72,
                "salary":salary,"experience":random.randint(0,8)}
    b["employees"].append(employee)
    b["cash"] = money(b["cash"] - salary*5)
    b["other_assets"] = money(b["other_assets"] + salary*5) # onboarding and recruitment prepayment asset proxy
    return {"ok":True,"message":f"{employee['name']} joined your institution.","employee":employee}

def approve_loan(b, application_id):
    app = next((x for x in b["loan_applications"] if x["id"]==application_id),None)
    if not app: return {"ok":False,"message":"This application is no longer available."}
    if app["amount"] > b["cash"]*0.35:
        return {"ok":False,"message":"The requested amount is too large relative to currently available liquidity."}
    if app["credit_score"] < 48 and b["credit_policy"] != "growth":
        return {"ok":False,"message":"The application falls below the current policy's indicative credit threshold."}
    b["cash"] = money(b["cash"] - app["amount"])
    b["loans"] = money(b["loans"] + app["amount"])
    if app["credit_score"] < 62:
        b["npl"] = money(b.get("npl",0) + app["amount"]*0.07)
    b["loan_applications"].remove(app)
    b["xp"] += 25
    return {"ok":True,"message":f"Loan approved for {app['borrower']}. Credit exposure has increased."}

def reject_loan(b, application_id):
    app = next((x for x in b["loan_applications"] if x["id"]==application_id),None)
    if not app: return {"ok":False,"message":"This application is no longer available."}
    b["loan_applications"].remove(app)
    b["confidence"] = min(100,b["confidence"] + (0.2 if app["credit_score"]<55 else -0.15))
    return {"ok":True,"message":"Application declined and recorded in the credit decision history."}

def campaign(b):
    cost = 18000
    if b["cash"] < cost: return {"ok":False,"message":"Insufficient available cash for this campaign."}
    b["cash"] -= cost
    b["equity"] -= cost
    gain = random.uniform(0.008,0.024)*b["deposits"]
    b["deposits"] += gain
    b["cash"] += gain
    b["customers"] += random.randint(12,38)
    b["confidence"] = min(100,b["confidence"]+1.2)
    b["xp"] += 18
    recalc_equity(b)
    return {"ok":True,"message":f"Campaign completed. Approximately ₱{gain:,.0f} in deposits were attracted."}

def action(b, action_name):
    if action_name=="service":
        if b["cash"] < 25000: return {"ok":False,"message":"Insufficient cash for the service improvement."}
        b["cash"]-=25000; b["equity"]-=25000
        b["service_quality"]=min(100,b["service_quality"]+8); b["confidence"]=min(100,b["confidence"]+3)
        recalc_equity(b)
        return {"ok":True,"message":"Service quality investment completed."}
    if action_name=="funding":
        amount=500000
        b["cash"]+=amount; b["wholesale_funding"]+=amount
        recalc_equity(b)
        add_event(b,"Wholesale funding arranged","Your bank secured additional wholesale funding. Liquidity improved, but repayment and funding costs now matter.","Moderate","Treasury")
        return {"ok":True,"message":"Funding secured. Remember that it creates a liability."}
    if action_name=="tighten":
        b["credit_policy"]="conservative"
        return {"ok":True,"message":"Credit policy tightened. New lending will be more selective."}
    if action_name=="retain":
        b["retained_earnings"] += max(0,b["net_income"])
        return {"ok":True,"message":"Earnings will remain in the institution."}
    if action_name=="collections":
        b["confidence"]=max(0,b["confidence"]-0.5)
        b["npl"]=max(0,b.get("npl",0)*0.92)
        return {"ok":True,"message":"Collections resources increased. Some overdue balances were recovered."}
    if action_name=="monitor":
        return {"ok":True,"message":"You chose to monitor conditions. The situation may evolve."}
    if action_name=="respond":
        b["confidence"]=min(100,b["confidence"]+0.7)
        return {"ok":True,"message":"Management response initiated. Outcomes will depend on subsequent conditions."}
    return {"ok":False,"message":"Unknown management action."}

def resolve_event(b, event_id, action_name):
    ev=next((e for e in b["events"] if e["id"]==event_id),None)
    if not ev or ev["status"]!="Open": return {"ok":False,"message":"This situation is no longer open."}
    result=action(b,action_name)
    if result["ok"]:
        ev["status"]="Reviewed"
        ev["resolution"]=action_name
        ev["resolved_day"]=b["day"]
    return result

def offline_catchup(b, data, elapsed_seconds):
    seconds=max(0,min(86400,int(elapsed_seconds)))
    days=min(24,seconds/86400)
    ticks=max(0,int(days*24)) # 24 simulation ticks per real offline day
    if ticks:
        tick(b,data,ticks,seed=int(b["day"]*17+seconds))
    return {"simulated_ticks":ticks,"capped_seconds":seconds,"summary":summary(b)}
