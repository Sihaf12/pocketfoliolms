# Stage 4 review: response shapes and lesson content

## `GET /api/v1/pathway`

```jsonc
{
  "level": "practitioner",                       // explorer | learner | practitioner | specialist
  "baseline": { "learn": 76, "safeguard": 72, "apply": 64, "specialise": 60 },
  "nextLessonId": "uuid" | null,                 // first open lesson: tier, then catalogue order, then position
  "tiers": [{
    "tier": "learn", "unlocked": true, "gateReason": null,     // e.g. "Unlocks at Learn 50 or above. You are at 20."
    "courses": [{
      "id": "uuid", "slug": "foundations-of-digital-assets", "title": "Foundations of Digital Assets",
      "estMinutes": 30, "state": "not_started" | "in_progress" | "completed", "progressPct": 67,
      "certificate": { "serial": "PA-MFQ0-HNEZ", "issuedAt": "ISO-8601" } | null,
      "lessons": [{
        "id": "uuid", "position": 2, "title": "Assets and instruments", "minutes": 11, "xp": 140,
        "state": "done" | "open" | "locked",
        "gateReason": null | "Requires: How markets work" | "<tier gate text>",
        "requires": ["uuid"]                     // lesson ids, met or not; the edges of the tree
      }]
    }]
  }]
}
```

## `GET /api/v1/me`

```jsonc
{
  "user": { "id": "uuid", "email": "…", "displayName": "…", "lifecycle": "certified",
            "ibRefCode": "IB-4417" | null, "goal": "new" | "some_experience" | "stop_losing" | "go_deeper" | null,
            "dailyMinutes": 10 | 20 | 30 | null },
  "academy": { "name": "GTL Academy" },
  "placement": { "level": "practitioner", "baseline": { … } } | null,   // null until placed
  "stats": { "xp": 400, "streakDays": 1, "verifiedLessons": 3, "totalLessons": 11 },
  "tiers": [{ "tier": "learn", "verifiedLessons": 3, "totalLessons": 3 }, …],
  "recent": [{ "lessonId": "uuid", "title": "Orders and execution", "tier": "learn", "xp": 140, "verifiedAt": "ISO-8601" }],
  "certificates": [{ "serial": "PA-MFQ0-HNEZ", "courseTitle": "Foundations of Digital Assets", "issuedAt": "ISO-8601" }]
}
```

How these are computed:

- **XP:** each verified lesson counts once.
- **Streak:** consecutive UTC days on which a lesson was first verified, ending today or yesterday.
- **`totalLessons`:** counts this academy's enabled catalogue.

## Lesson content summary

| Course (tier) | Lesson | Min · XP | Requires | Its three steps |
|---|---|---|---|---|
| Foundations of Digital Assets (Learn) | How markets work | 9 · 120 | – | queue of offers · the spread · liquidity |
| | Assets and instruments | 11 · 140 | L1 | spot vs derivative · custody · stablecoin pegs |
| | Orders and execution | 10 · 140 | L1 | market orders · limit orders · slippage |
| Risk and Protection (Safeguard) | Risk, plainly | 8 · 160 | L2 | risk vs feeling · recovery arithmetic · affordable loss |
| | Leverage and margin | 12 · 200 | S1 | *prototype text, verbatim* · simulator |
| | Scams and protection | 9 · 160 | S1 | guarantees · check the register yourself · pressure, recovery scams |
| Practical Execution (Apply) | Reading a chart | 11 · 180 | L3 | candles · timeframes · volume |
| | Position sizing | 12 · 220 | A1 + S2 | risk per trade · size = risk ÷ stop distance · stop sets size |
| | Writing a plan | 10 · 220 | A2 | written before · exits over entries · review when flat |
| Advanced Markets (Specialise) | Derivatives basics | 13 · 260 | A3 | futures · perpetuals and funding · options |
| | Portfolio construction | 13 · 260 | A3 | weigh risk · correlation · rebalancing |

- **What each lesson has:** three steps, an "In practice" callout, a four-line transcript, and 2–4 glossary terms.
- **Check questions:** 55 in total (five per lesson). Each has three options, a rationale for every option, and correct answers spread across a, b and c.
- **Placement:** the prototype's eight questions, verbatim. The rationales for their wrong options are new.
- **Reused from the prototype:** S2's lesson text, its transcript and its three check questions.
- **Newly written:** everything else, marked "Draft, Global Tutoring Lab curriculum / Pending compliance review", with no review date.
- **The arithmetic is checked:** 50%→100% and 20%→25% loss recovery; 1% of 10,000 over a 4% stop = 2,500; five 2% losses ≈ 9.6% of the account; 5x leverage → 20% move to zero.

**Claims a compliance reviewer should look at first**, because they generalise about venues or behaviour:

- "Many disciplined traders use 1 to 2%."
- "Several [stablecoins] have lost their peg."
- Recovery scams are "sometimes run by the same people".
- "Most venues do not charge for an order that did not fill."
- A margin call on "most retail crypto and CFD venues" is immediate liquidation (this one is prototype text).
