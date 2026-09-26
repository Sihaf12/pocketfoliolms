-- =====================================================================
-- Demo seed: three branded academies and the prototype's curriculum.
--
-- For the local demo only (npm run demo), loaded into its own database,
-- academy_demo. Never load it into the test database: its placement
-- questions would join every test learner's paper.
--
-- Idempotent. Academies, courses and lessons are keyed by slug and
-- position; questions by ids derived from stable keys, so re-seeding
-- updates content in place and existing attempts keep pointing at it.
--
-- Authorship: all lesson content is a draft. Author "Draft, Global
-- Tutoring Lab curriculum", reviewer "Pending compliance review", and no
-- review date, until a real person has read it.
--
-- The content is one JSON document below, so prose needs no SQL quoting.
-- Lesson bodies use a small Markdown subset:
--   ## Heading            a lesson step
--   > **In practice**     the callout (following lines start with "> ")
--   [[term|definition]]   a glossary term
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE demo (doc jsonb) ON COMMIT DROP;
INSERT INTO demo VALUES ($demo$
{
  "academies": [
    {
      "slug": "gtl-academy",
      "name": "GTL Academy",
      "domain": "gtl.academy.test",
      "brand": {
        "sub": "Global Tutoring Lab",
        "mode": "light",
        "tokens": {
          "--brand": "#1A6DC2",
          "--brand-d": "#12508F",
          "--brand-t": "#E8F1FB",
          "--accent": "#F5C400",
          "--accent-ink": "#1F1A00",
          "--brandtext": "#FFFFFF",
          "--bg": "#F2F6FB",
          "--surface": "#FFFFFF",
          "--surface-2": "#F7FAFD",
          "--line": "#DDE6F1",
          "--line-2": "#EAF0F7",
          "--ink": "#14203A",
          "--muted": "#5D6D85",
          "--faint": "#93A3B8",
          "--ok": "#1E8E4E",
          "--ok-t": "#E3F5EB",
          "--warn": "#B4790E",
          "--warn-t": "#FCF3DC",
          "--bad": "#B23A3A",
          "--bad-t": "#FBEAEA",
          "--learn": "#2F7DD1",
          "--safeguard": "#0F8A7E",
          "--apply": "#B4790E",
          "--specialise": "#7B3F98",
          "--r": "16px",
          "--r-s": "11px",
          "--r-l": "22px"
        }
      }
    },
    {
      "slug": "pocketfolio",
      "name": "Pocketfolio Academy",
      "domain": "pocketfolio.academy.test",
      "brand": {
        "sub": "Zento Era",
        "mode": "light",
        "tokens": {
          "--brand": "#3D6D67",
          "--brand-d": "#2C524D",
          "--brand-t": "#E6F0EE",
          "--accent": "#FACC15",
          "--accent-ink": "#231F00",
          "--brandtext": "#FFFFFF",
          "--bg": "#F3F7F6",
          "--surface": "#FFFFFF",
          "--surface-2": "#F7FBFA",
          "--line": "#DCE7E5",
          "--line-2": "#EAF2F1",
          "--ink": "#152624",
          "--muted": "#5C6F6C",
          "--faint": "#93A5A2",
          "--ok": "#1E8E4E",
          "--ok-t": "#E3F5EB",
          "--warn": "#B4790E",
          "--warn-t": "#FCF3DC",
          "--bad": "#B23A3A",
          "--bad-t": "#FBEAEA",
          "--learn": "#3D6D67",
          "--safeguard": "#2F8F84",
          "--apply": "#C08A1E",
          "--specialise": "#6E5AA8",
          "--r": "20px",
          "--r-s": "14px",
          "--r-l": "26px"
        }
      }
    },
    {
      "slug": "meridian-inst",
      "name": "Meridian Institute",
      "domain": "meridian.academy.test",
      "brand": {
        "sub": "Institutional",
        "mode": "dark",
        "tokens": {
          "--brand": "#C9A227",
          "--brand-d": "#A8851B",
          "--brand-t": "#22314B",
          "--accent": "#C9A227",
          "--accent-ink": "#121E2F",
          "--brandtext": "#121E2F",
          "--bg": "#0E1826",
          "--surface": "#18263C",
          "--surface-2": "#1E2F49",
          "--line": "#2A3C58",
          "--line-2": "#22334E",
          "--ink": "#EEF3FA",
          "--muted": "#A3B3CA",
          "--faint": "#7B8DA8",
          "--ok": "#4FC98A",
          "--ok-t": "#16311F",
          "--warn": "#E0B34C",
          "--warn-t": "#332913",
          "--bad": "#E38080",
          "--bad-t": "#3A1E1E",
          "--learn": "#5B9BE0",
          "--safeguard": "#3FB5A6",
          "--apply": "#DCAE4A",
          "--specialise": "#A783D6",
          "--r": "10px",
          "--r-s": "7px",
          "--r-l": "14px"
        }
      }
    }
  ],
  "courses": [
    {
      "slug": "foundations-of-digital-assets",
      "title": "Foundations of Digital Assets",
      "tier": "learn",
      "summary": "How markets, assets and orders actually work.",
      "minutes": 30
    },
    {
      "slug": "risk-and-protection",
      "title": "Risk and Protection",
      "tier": "safeguard",
      "summary": "Risk in plain terms, leverage and margin, and how to recognise a scam.",
      "minutes": 29
    },
    {
      "slug": "practical-execution",
      "title": "Practical Execution",
      "tier": "apply",
      "summary": "Reading a chart, sizing a position and writing a plan you will follow.",
      "minutes": 33
    },
    {
      "slug": "advanced-markets",
      "title": "Advanced Markets",
      "tier": "specialise",
      "summary": "Derivatives and how to build a portfolio that is more than a list of positions.",
      "minutes": 26
    }
  ],
  "lessons": [
    {
      "code": "L1",
      "course": "foundations-of-digital-assets",
      "position": 1,
      "title": "How markets work",
      "minutes": 9,
      "xp": 120,
      "requires": [],
      "experience": null,
      "body": "## A market is a queue of offers\nEvery price you see is the last price at which a buyer and a seller agreed. Behind it sit two queues: [[bids|Offers to buy at a stated price. The highest bid is the best price anyone will currently pay.]] waiting to buy, and [[asks|Offers to sell at a stated price. The lowest ask is the cheapest anyone will currently sell for.]] waiting to sell.\n\n## The spread is the cost of trading now\nThe gap between the best bid and the best ask is the [[spread|The difference between the best ask and the best bid. Crossing it is the cost of trading immediately.]]. If you buy and immediately sell, you lose roughly the spread. In busy markets it is small; in thin ones it can be several per cent.\n\n## Liquidity decides how far a price moves\nA market is [[liquid|Having many offers close to the current price, so trades of normal size barely move it.]] when there are many offers near the current price. In a thin market, one large order can walk through several price levels and move the price sharply.\n\n> **In practice**\n> Before trading anything, look at the spread and at the offers near the price. If a normal-sized order would move the price, you are paying more than the chart shows.",
      "transcript": [
        {
          "at": "0:00",
          "text": "A price is not a fact about an asset. It is the last point where a buyer and a seller agreed."
        },
        {
          "at": "0:40",
          "text": "Behind every price sit two queues: bids to buy, and asks to sell."
        },
        {
          "at": "1:25",
          "text": "The gap between them is the spread, and crossing it is what trading immediately costs."
        },
        {
          "at": "2:10",
          "text": "Liquidity is how much sits near the price. Thin markets move sharply on small orders."
        }
      ],
      "checks": [
        {
          "prompt": "What does the last traded price tell you?",
          "options": [
            {
              "key": "a",
              "text": "The price at which a buyer and a seller most recently agreed"
            },
            {
              "key": "b",
              "text": "The fair value of the asset"
            },
            {
              "key": "c",
              "text": "The price you are guaranteed to trade at next"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. It is a record of the last agreement, nothing more.",
            "b": "Price and value are different things. The last trade says what someone paid, not what the asset is worth.",
            "c": "The next trade happens at whatever offers are available when you trade."
          }
        },
        {
          "prompt": "The best bid is 99 and the best ask is 101. You buy and immediately sell. Roughly what happens?",
          "options": [
            {
              "key": "a",
              "text": "You break even"
            },
            {
              "key": "b",
              "text": "You lose about 2, the width of the spread"
            },
            {
              "key": "c",
              "text": "You gain about 2"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Buying takes the ask at 101 and selling takes the bid at 99, so you cannot come out even.",
            "b": "Correct. Crossing the spread in both directions costs its full width.",
            "c": "Crossing the spread is a cost, never a gain."
          }
        },
        {
          "prompt": "Which market is more liquid?",
          "options": [
            {
              "key": "a",
              "text": "One with a wide spread and few offers"
            },
            {
              "key": "b",
              "text": "One where ordinary orders move the price a lot"
            },
            {
              "key": "c",
              "text": "One with many offers close to the current price"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "A wide spread and few offers are the signs of a thin market.",
            "b": "Large moves on ordinary orders are what thin liquidity looks like.",
            "c": "Correct. Depth near the price is what liquidity means."
          }
        },
        {
          "prompt": "Why can a small token jump 20% on a single order?",
          "options": [
            {
              "key": "a",
              "text": "Few offers sit near the price, so one order walks through several price levels"
            },
            {
              "key": "b",
              "text": "Exchanges set its price each morning"
            },
            {
              "key": "c",
              "text": "Small tokens are always undervalued"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. With little depth, one order uses up the nearest offers and trades at worse and worse levels.",
            "b": "Exchanges match orders. They do not set prices.",
            "c": "Size says nothing about value. The jump is mechanical, not a verdict."
          }
        },
        {
          "prompt": "Before your first trade on a new market, what is most useful to check?",
          "options": [
            {
              "key": "a",
              "text": "What people are saying about it online"
            },
            {
              "key": "b",
              "text": "The spread and the offers near the current price"
            },
            {
              "key": "c",
              "text": "Its all-time high"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Opinion does not tell you what a trade will cost you.",
            "b": "Correct. They tell you what trading will actually cost, and how far your order may move the price.",
            "c": "A past high tells you nothing about the cost of trading now."
          }
        }
      ]
    },
    {
      "code": "L2",
      "course": "foundations-of-digital-assets",
      "position": 2,
      "title": "Assets and instruments",
      "minutes": 11,
      "xp": 140,
      "requires": [
        "L1"
      ],
      "experience": null,
      "body": "## Owning the asset is not the only way in\nYou can hold an asset itself, or an instrument whose value follows it. [[Spot|Buying or selling the asset itself, for delivery now.]] means you own the thing. A derivative, such as a future or a CFD, is a contract that pays out depending on the asset's price.\n\n## Who holds it matters\nIf you keep assets on an exchange, the exchange holds them for you and you hold a claim on the exchange. In [[self-custody|Holding assets in a wallet whose keys only you control.]] you hold the keys, and the whole responsibility for not losing them.\n\n## Stablecoins are a promise, not a guarantee\nA [[stablecoin|A token designed to track a reference asset, usually the US dollar, backed by reserves or held there by a mechanism.]] aims to stay at one dollar. Whether it does depends on what backs it and whether holders can redeem. Several have lost their peg.\n\n> **In practice**\n> For anything you hold, write down three answers: what you actually own, who holds it, and what would have to fail for you to lose it.",
      "transcript": [
        {
          "at": "0:00",
          "text": "Owning an asset and being exposed to its price are two different things."
        },
        {
          "at": "0:45",
          "text": "Spot means you own it. Derivatives are contracts that pay out depending on its price."
        },
        {
          "at": "1:35",
          "text": "Where an asset is held matters as much as what it is. On an exchange, you hold a claim."
        },
        {
          "at": "2:20",
          "text": "Stablecoins aim for a fixed value. Whether they keep it depends on what stands behind them."
        }
      ],
      "checks": [
        {
          "prompt": "You buy a token on spot. What do you have?",
          "options": [
            {
              "key": "a",
              "text": "A contract that pays the price difference"
            },
            {
              "key": "b",
              "text": "The token itself, or a claim on it if an exchange holds it for you"
            },
            {
              "key": "c",
              "text": "A loan from the exchange"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "That describes a derivative, not spot.",
            "b": "Correct. Spot is ownership, held directly or through the exchange.",
            "c": "A spot purchase is paid for in full. No loan is involved unless you use margin."
          }
        },
        {
          "prompt": "What is a derivative?",
          "options": [
            {
              "key": "a",
              "text": "A contract whose value depends on another asset's price"
            },
            {
              "key": "b",
              "text": "A cheaper version of the asset"
            },
            {
              "key": "c",
              "text": "A token issued by a regulator"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. You hold the contract, not the asset.",
            "b": "It is not a version of the asset. It is a separate contract with its own risks.",
            "c": "Derivatives are issued by exchanges and counterparties, not by regulators."
          }
        },
        {
          "prompt": "Your assets sit in an exchange account. Who holds them?",
          "options": [
            {
              "key": "a",
              "text": "You, directly"
            },
            {
              "key": "b",
              "text": "The blockchain, which guarantees them"
            },
            {
              "key": "c",
              "text": "The exchange, and you hold a claim on it"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Without the keys, you do not hold them directly.",
            "b": "A blockchain records ownership. It does not guarantee that a custodian stays solvent.",
            "c": "Correct. If the exchange fails, your claim on it is what you have left."
          }
        },
        {
          "prompt": "What is the main responsibility that comes with self-custody?",
          "options": [
            {
              "key": "a",
              "text": "Paying the exchange's custody fee"
            },
            {
              "key": "b",
              "text": "Keeping the keys safe, because nobody can recover them for you"
            },
            {
              "key": "c",
              "text": "Reporting your trades to the exchange"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "In self-custody no exchange holds your assets.",
            "b": "Correct. Lose the keys and the assets are gone. There is no password reset.",
            "c": "No exchange is involved in holding self-custodied assets."
          }
        },
        {
          "prompt": "A stablecoin is trading at 0.93 dollars. What has most likely happened?",
          "options": [
            {
              "key": "a",
              "text": "Confidence in its backing, or in redeeming it, has weakened"
            },
            {
              "key": "b",
              "text": "Nothing unusual: stablecoins float freely"
            },
            {
              "key": "c",
              "text": "The dollar has risen 7%"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. A peg holds only while holders trust they can redeem at one dollar.",
            "b": "A stablecoin is designed to hold its peg. A 7% gap is that design failing.",
            "c": "Currency moves of that size in a day are very rare. The problem is the token, not the dollar."
          }
        }
      ]
    },
    {
      "code": "L3",
      "course": "foundations-of-digital-assets",
      "position": 3,
      "title": "Orders and execution",
      "minutes": 10,
      "xp": 140,
      "requires": [
        "L1"
      ],
      "experience": null,
      "body": "## Market orders buy certainty of execution\nA [[market order|An instruction to trade immediately at the best prices currently available.]] fills straight away at whatever prices are available. You know it will fill. You do not know exactly at what price.\n\n## Limit orders buy certainty of price\nA [[limit order|An instruction to trade only at a stated price or better.]] fills only at your price or better. You know the price. You do not know whether it will fill.\n\n## Slippage is the gap between expected and actual\n[[Slippage|The difference between the price you expected and the price you actually received.]] happens when an order is larger than the offers at the best price, or when the price moves before the order fills. It is largest in thin markets and fast moves.\n\n> **In practice**\n> In a thin or fast market, use a limit order and accept that it may not fill. A missed trade costs nothing; a bad fill costs money.",
      "transcript": [
        {
          "at": "0:00",
          "text": "Every order trades one certainty for another."
        },
        {
          "at": "0:35",
          "text": "A market order is certain to fill, at an uncertain price."
        },
        {
          "at": "1:20",
          "text": "A limit order is certain of its price, and uncertain to fill."
        },
        {
          "at": "2:05",
          "text": "Slippage is what you pay when the price you expected is not the price you get."
        }
      ],
      "checks": [
        {
          "prompt": "You must sell immediately, whatever the price. Which order fits?",
          "options": [
            {
              "key": "a",
              "text": "A limit order well above the current price"
            },
            {
              "key": "b",
              "text": "A market order"
            },
            {
              "key": "c",
              "text": "A limit order at last week's price"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "A sell limit above the market waits for the price to rise, and may never fill.",
            "b": "Correct. A market order fills straight away at the best prices available.",
            "c": "It fills only if the market returns to that price."
          }
        },
        {
          "prompt": "What does a limit order guarantee?",
          "options": [
            {
              "key": "a",
              "text": "That it will fill"
            },
            {
              "key": "b",
              "text": "That there will be no fees"
            },
            {
              "key": "c",
              "text": "That it trades at your price or better"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Filling is exactly what a limit order does not guarantee.",
            "b": "Fees depend on the venue, not the order type.",
            "c": "Correct. Price certainty is what you trade the certainty of filling for."
          }
        },
        {
          "prompt": "You place a market buy larger than the offers at the best ask. What happens?",
          "options": [
            {
              "key": "a",
              "text": "It fills through several price levels, at a worse average price"
            },
            {
              "key": "b",
              "text": "It waits until enough sellers arrive at the best ask"
            },
            {
              "key": "c",
              "text": "The exchange rejects it"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. It takes each level of offers in turn until it is filled.",
            "b": "A market order does not wait. That is what a limit order does.",
            "c": "Venues fill it against the offers available, sometimes with protections, but they do not simply refuse it."
          }
        },
        {
          "prompt": "When is slippage usually largest?",
          "options": [
            {
              "key": "a",
              "text": "In deep, calm markets"
            },
            {
              "key": "b",
              "text": "In thin markets and during fast moves"
            },
            {
              "key": "c",
              "text": "On limit orders"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Deep, calm markets are where slippage is smallest.",
            "b": "Correct. Few offers or a moving price both widen the gap between expected and actual.",
            "c": "A limit order cannot fill worse than its price, so it cannot slip past it."
          }
        },
        {
          "prompt": "Your limit order did not fill. What did it cost you?",
          "options": [
            {
              "key": "a",
              "text": "Nothing except the missed trade"
            },
            {
              "key": "b",
              "text": "The spread"
            },
            {
              "key": "c",
              "text": "A penalty for not trading"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. An unfilled limit order has no fill to pay for.",
            "b": "The spread is paid only when you actually trade.",
            "c": "Most venues do not charge for an order that did not fill."
          }
        }
      ]
    },
    {
      "code": "S1",
      "course": "risk-and-protection",
      "position": 1,
      "title": "Risk, plainly",
      "minutes": 8,
      "xp": 160,
      "requires": [
        "L2"
      ],
      "experience": null,
      "body": "## Risk is what you can lose, not how it feels\nRisk is the amount you could lose and how likely that is. [[Volatility|How much and how quickly a price moves. High volatility means large swings in both directions.]] is how much a price swings, which tells you how far it can go against you in an ordinary week.\n\n## Losses are harder to recover than they look\nA 50% loss needs a 100% gain to get back to where you started. A 20% loss needs 25%. The deeper the hole, the harder the climb, which is why limiting losses matters more than chasing gains.\n\n## Only risk what you can afford to lose\nMoney you need for rent, bills or emergencies should never be exposed to a volatile asset. Decide the amount you could lose entirely without it changing your life, and treat that as the ceiling.\n\n> **In practice**\n> Write down the largest loss you would accept on your whole account this year. Every position you open has to fit inside it.",
      "transcript": [
        {
          "at": "0:00",
          "text": "Risk is not a feeling. It is the amount you could lose, and how likely that is."
        },
        {
          "at": "0:40",
          "text": "Volatility tells you how far a price moves in an ordinary week, in both directions."
        },
        {
          "at": "1:20",
          "text": "Losses compound against you. A 50 per cent loss needs a 100 per cent gain to recover."
        },
        {
          "at": "2:00",
          "text": "So the first rule is simple: only put at risk money you can afford to lose entirely."
        }
      ],
      "checks": [
        {
          "prompt": "You lose 50% of an account. What gain takes you back to the start?",
          "options": [
            {
              "key": "a",
              "text": "50%"
            },
            {
              "key": "b",
              "text": "100%"
            },
            {
              "key": "c",
              "text": "75%"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "50% of the smaller balance only brings you back to 75% of where you started.",
            "b": "Correct. Half the money has to double to return to the original amount.",
            "c": "75% of the smaller balance brings you back to 87.5% of the start."
          }
        },
        {
          "prompt": "What does high volatility mean?",
          "options": [
            {
              "key": "a",
              "text": "The price will probably rise"
            },
            {
              "key": "b",
              "text": "The asset is hard to trade"
            },
            {
              "key": "c",
              "text": "The price swings widely, in both directions"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Volatility has no direction. It describes the size of the swings.",
            "b": "That describes low liquidity, which is a different thing.",
            "c": "Correct. Large swings either way are what volatility measures."
          }
        },
        {
          "prompt": "Which money should never go into a volatile asset?",
          "options": [
            {
              "key": "a",
              "text": "Money you need for rent and bills"
            },
            {
              "key": "b",
              "text": "A small amount you have decided you can lose"
            },
            {
              "key": "c",
              "text": "Money you could lose without it changing your life"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. Money with a job to do should not be exposed to large swings.",
            "b": "That is exactly the kind of money that can be put at risk.",
            "c": "That is the definition of money you can afford to lose."
          }
        },
        {
          "prompt": "A 20% loss needs what gain to recover?",
          "options": [
            {
              "key": "a",
              "text": "20%"
            },
            {
              "key": "b",
              "text": "25%"
            },
            {
              "key": "c",
              "text": "40%"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "20% of the smaller balance only brings you back to 96% of the start.",
            "b": "Correct. 80 has to grow by 20, which is 25% of 80.",
            "c": "That is far more than needed. 80 times 1.25 is already 100."
          }
        },
        {
          "prompt": "What is the most useful first question before any trade?",
          "options": [
            {
              "key": "a",
              "text": "How much could I lose, and can I afford it?"
            },
            {
              "key": "b",
              "text": "How much could I make?"
            },
            {
              "key": "c",
              "text": "What is everyone else buying?"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. The downside decides whether a trade is acceptable at all.",
            "b": "The upside matters, but only after you know you can survive the downside.",
            "c": "Other people's trades say nothing about your capital or your plan."
          }
        }
      ]
    },
    {
      "code": "S2",
      "course": "risk-and-protection",
      "position": 2,
      "title": "Leverage and margin",
      "minutes": 12,
      "xp": 200,
      "requires": [
        "S1"
      ],
      "experience": "leverage_simulator",
      "body": "## Leverage is borrowed size\nYou put up part of the position value as [[margin|The cash you put up to open and hold a leveraged position. It is not a fee, it is collateral.]], and the venue lends the rest. Ten times leverage means you control ten dollars of exposure for every dollar you have posted.\n\n## It multiplies both directions\nA 10% favourable move at 10x roughly doubles your margin. A 10% adverse move at 10x roughly erases it. The mechanism has no preference for which way it works.\n\n## The margin call is not a warning\nWhen your equity falls below the venue's maintenance level, the position is closed for you, at whatever price the market offers. You do not get to wait for the recovery.\n\n> **In practice**\n> Before opening any leveraged position, work out the percentage move that would take you to zero. If that number is smaller than a normal day for the asset, the size is wrong, not the market.",
      "transcript": [
        {
          "at": "0:00",
          "text": "Leverage is borrowed size. You put up part of the position and the venue lends the rest."
        },
        {
          "at": "0:38",
          "text": "Here is the part people miss. Leverage multiplies the outcome in both directions, equally."
        },
        {
          "at": "1:24",
          "text": "At ten times, a ten per cent move against you takes roughly all of your margin."
        },
        {
          "at": "2:05",
          "text": "A margin call is not a warning. It is the venue closing your position for you."
        },
        {
          "at": "2:51",
          "text": "So the question is never how much leverage is available. It is how much you can survive."
        }
      ],
      "checks": [
        {
          "prompt": "You open a position at 10x. The asset moves 9% against you. What is the most accurate description of your position?",
          "options": [
            {
              "key": "a",
              "text": "Down about 9%"
            },
            {
              "key": "b",
              "text": "Down about 90% of your margin, and close to being closed for you"
            },
            {
              "key": "c",
              "text": "Unchanged until you sell"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "That would be true without leverage. At 10x the move is multiplied by ten.",
            "b": "Correct. Roughly 90% of your margin is gone, and most venues would be at or near a margin call.",
            "c": "Unrealised losses are still losses when leverage is involved, because the venue acts on them."
          }
        },
        {
          "prompt": "What does a margin call actually mean on most venues?",
          "options": [
            {
              "key": "a",
              "text": "A request to add funds within 24 hours"
            },
            {
              "key": "b",
              "text": "Your position is closed automatically at market"
            },
            {
              "key": "c",
              "text": "A temporary pause on the position"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Some traditional brokers work that way. Most retail crypto and CFD venues do not wait.",
            "b": "Correct. Liquidation is automatic and happens at whatever price is available, not the one you hoped for.",
            "c": "Nothing is paused. The position is closed and the loss is realised."
          }
        },
        {
          "prompt": "Which question is the useful one before choosing leverage?",
          "options": [
            {
              "key": "a",
              "text": "What is the maximum this venue offers?"
            },
            {
              "key": "b",
              "text": "What move would take me to zero, and is that a normal day for this asset?"
            },
            {
              "key": "c",
              "text": "What are other traders using?"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Maximum available leverage tells you about the venue's risk appetite, not yours.",
            "b": "Correct. If the distance to zero is smaller than the asset's ordinary daily range, the size is wrong.",
            "c": "Other people's size tells you nothing about your own capital or plan."
          }
        },
        {
          "prompt": "At 5x leverage, roughly what adverse move takes your margin to zero?",
          "options": [
            {
              "key": "a",
              "text": "5%"
            },
            {
              "key": "b",
              "text": "50%"
            },
            {
              "key": "c",
              "text": "20%"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "At 5x, a 5% move costs about 25% of your margin.",
            "b": "That would be true at 2x.",
            "c": "Correct. 100 divided by the leverage: 100 / 5 = 20%."
          }
        },
        {
          "prompt": "Which statement about margin is accurate?",
          "options": [
            {
              "key": "a",
              "text": "It is collateral you post, and you can lose all of it"
            },
            {
              "key": "b",
              "text": "It is a fee for opening the position"
            },
            {
              "key": "c",
              "text": "It is insurance against losses"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. Margin is your own money standing behind the position.",
            "b": "Fees are separate. Margin is collateral, and it is at risk.",
            "c": "Margin protects the venue, not you. It is the first money lost."
          }
        }
      ]
    },
    {
      "code": "S3",
      "course": "risk-and-protection",
      "position": 3,
      "title": "Scams and protection",
      "minutes": 9,
      "xp": 160,
      "requires": [
        "S1"
      ],
      "experience": null,
      "body": "## Guaranteed returns are the signal\nNo legitimate investment guarantees returns, least of all high monthly ones. A promise of fixed profit with no risk is the most reliable sign of a scheme, whatever story comes with it.\n\n## Check the regulator yourself\nBefore sending money, find the firm on the [[regulator's register|The public list a financial regulator keeps of the firms it authorises.]] yourself, starting from the regulator's own website. Do not use a link, phone number or certificate the firm gave you. Those can be forged.\n\n## Pressure is part of the method\nUrgency, secrecy and stories of friends getting rich are tools. A real opportunity survives a day's delay and a conversation with someone you trust. [[Recovery scams|Offers to recover money already lost to a scam, for an upfront fee. They are sometimes run by the same people.]] target people who have already been caught once.\n\n> **In practice**\n> Adopt one rule: never send money on the same day you first hear about an opportunity. Most schemes cannot survive the wait.",
      "transcript": [
        {
          "at": "0:00",
          "text": "Most scams in this space follow a few patterns, and the patterns are easy to learn."
        },
        {
          "at": "0:40",
          "text": "The first signal is a guarantee. No real investment can promise fixed returns."
        },
        {
          "at": "1:25",
          "text": "Check the firm on the regulator's own register, never through a link they sent you."
        },
        {
          "at": "2:10",
          "text": "And watch for pressure. Urgency and secrecy are part of the method."
        }
      ],
      "checks": [
        {
          "prompt": "An offer promises 5% a month, guaranteed. What does the guarantee tell you?",
          "options": [
            {
              "key": "a",
              "text": "The firm is confident in its strategy"
            },
            {
              "key": "b",
              "text": "It is the clearest warning sign there is"
            },
            {
              "key": "c",
              "text": "The returns are insured"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Confidence is what a scheme sells. Real investments cannot promise fixed returns.",
            "b": "Correct. Guaranteed high returns are the oldest signal of a scheme.",
            "c": "No insurance covers investment returns. A claim that it does is a second warning sign."
          }
        },
        {
          "prompt": "How should you check that a firm is authorised?",
          "options": [
            {
              "key": "a",
              "text": "Ask them for their licence number and certificate"
            },
            {
              "key": "b",
              "text": "Read their online reviews"
            },
            {
              "key": "c",
              "text": "Search the regulator's register yourself, starting from the regulator's own website"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Documents the firm supplies can be forged, and often are.",
            "b": "Reviews are easy to fake and say nothing about authorisation.",
            "c": "Correct. Only the regulator's own register, reached independently, answers the question."
          }
        },
        {
          "prompt": "You are told the offer closes in two hours. What is the best response?",
          "options": [
            {
              "key": "a",
              "text": "Decide quickly so you do not miss out"
            },
            {
              "key": "b",
              "text": "Treat the urgency itself as a warning, and wait"
            },
            {
              "key": "c",
              "text": "Send a smaller amount to test it"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Speed is what the deadline is designed to produce.",
            "b": "Correct. A genuine opportunity survives a delay. A scheme needs you to act before you think.",
            "c": "Schemes often pay out on small test deposits to win larger ones."
          }
        },
        {
          "prompt": "After losing money to a scam, someone offers to recover it for an upfront fee. What is this most likely to be?",
          "options": [
            {
              "key": "a",
              "text": "A recovery scam, sometimes run by the same people"
            },
            {
              "key": "b",
              "text": "A legitimate law firm"
            },
            {
              "key": "c",
              "text": "A regulator's compensation scheme"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. People who have lost money once are targeted again with the promise of getting it back.",
            "b": "Legitimate firms do not cold-contact victims and demand fees up front to recover funds.",
            "c": "Regulators do not charge upfront fees and do not approach people this way."
          }
        },
        {
          "prompt": "A friend doubled their money on a platform and urges you to join. What should you do first?",
          "options": [
            {
              "key": "a",
              "text": "Join, since someone you trust has been paid"
            },
            {
              "key": "b",
              "text": "Ask how much they have made in total"
            },
            {
              "key": "c",
              "text": "Check the platform on the regulator's register before anything else"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Early payouts to recruits are how many schemes grow.",
            "b": "Past payouts prove nothing. Many schemes pay early members from later deposits.",
            "c": "Correct. Your friend's experience does not tell you whether the platform is authorised."
          }
        }
      ]
    },
    {
      "code": "A1",
      "course": "practical-execution",
      "position": 1,
      "title": "Reading a chart",
      "minutes": 11,
      "xp": 180,
      "requires": [
        "L3"
      ],
      "experience": null,
      "body": "## A candle is four prices\nEach [[candlestick|A bar showing the open, high, low and close prices for one period.]] shows the open, high, low and close for one period. The body spans open to close; the wicks reach to the high and the low.\n\n## Timeframe changes the story\nThe same market can look like an uptrend on a daily chart and a downtrend on an hourly one. Always know which timeframe you are reading, and check at least one longer one.\n\n## Volume shows participation\n[[Volume|The amount traded during a period. A move on high volume involved more participants than the same move on low volume.]] tells you how much traded. A price move on high volume involved many participants; the same move on thin volume can reverse easily.\n\n> **In practice**\n> A chart describes what has already happened, not what will. Use it to find the levels your plan refers to, never as a forecast.",
      "transcript": [
        {
          "at": "0:00",
          "text": "A chart is a record of what has already traded, drawn so you can read it quickly."
        },
        {
          "at": "0:40",
          "text": "Each candle holds four prices: open, high, low and close."
        },
        {
          "at": "1:25",
          "text": "The same market looks different on different timeframes. Always know which one you are on."
        },
        {
          "at": "2:10",
          "text": "Volume shows how many took part in a move, and how much weight it carries."
        }
      ],
      "checks": [
        {
          "prompt": "What four prices does a candlestick show?",
          "options": [
            {
              "key": "a",
              "text": "Open, high, low and close"
            },
            {
              "key": "b",
              "text": "Bid, ask, last and volume"
            },
            {
              "key": "c",
              "text": "Average, median, high and low"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. One candle, one period, four prices.",
            "b": "Bid and ask belong to the order book, not to a candle.",
            "c": "Candles show actual traded prices, not averages."
          }
        },
        {
          "prompt": "A candle closed above where it opened. What does that tell you about the period?",
          "options": [
            {
              "key": "a",
              "text": "Volume was high"
            },
            {
              "key": "b",
              "text": "The price ended the period higher than it started"
            },
            {
              "key": "c",
              "text": "The next period will rise"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "A candle's colour says nothing about volume.",
            "b": "Correct. Close above open means the period ended higher.",
            "c": "A candle records the past. It predicts nothing."
          }
        },
        {
          "prompt": "A market is rising on the daily chart but falling on the hourly chart. Which is right?",
          "options": [
            {
              "key": "a",
              "text": "The daily chart, always"
            },
            {
              "key": "b",
              "text": "The hourly chart, because it is more recent"
            },
            {
              "key": "c",
              "text": "Both: they describe different timeframes"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "A longer timeframe is not more true, only longer.",
            "b": "Recent does not mean more accurate. It is a shorter window.",
            "c": "Correct. A short-term fall can sit inside a longer-term rise."
          }
        },
        {
          "prompt": "A price breaks above a level on very low volume. What is a fair reading?",
          "options": [
            {
              "key": "a",
              "text": "Few participants took part, so the move may not hold"
            },
            {
              "key": "b",
              "text": "It is certain to continue"
            },
            {
              "key": "c",
              "text": "Volume does not matter for breakouts"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. A move with little participation is easier to reverse.",
            "b": "Nothing on a chart is certain to continue.",
            "c": "Volume is one of the few things that shows how much weight a move carries."
          }
        },
        {
          "prompt": "What is a chart best used for?",
          "options": [
            {
              "key": "a",
              "text": "Predicting next week's price"
            },
            {
              "key": "b",
              "text": "Finding the levels your plan refers to"
            },
            {
              "key": "c",
              "text": "Deciding how much to risk"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Charts describe the past. Using them as forecasts is how plans get abandoned.",
            "b": "Correct. Entry, stop and target levels come from the chart; the decisions come from the plan.",
            "c": "Risk is set by your plan and your account, not by the shape of a chart."
          }
        }
      ]
    },
    {
      "code": "A2",
      "course": "practical-execution",
      "position": 2,
      "title": "Position sizing",
      "minutes": 12,
      "xp": 220,
      "requires": [
        "A1",
        "S2"
      ],
      "experience": null,
      "body": "## Risk per trade comes first\nDecide how much of your account you will lose if a trade fails, before anything else. Many disciplined traders use 1 to 2%. That number, not the size of the opportunity, sets the size.\n\n## Size is arithmetic\nPosition size equals the amount at risk divided by the distance to your stop. With a 1,000 account, 2% risk is 20. If your [[stop|A price set in advance at which you exit a losing position.]] is 5% below entry, the position is 20 / 0.05 = 400.\n\n## The stop sets the size, not the other way round\nPlace the stop where the trade idea is proven wrong, then size to it. Moving the stop to fit a bigger position turns a plan into a hope.\n\n> **In practice**\n> Before every trade, write three numbers: the amount at risk, the distance to the stop, and the position size. If the third number surprises you, trust the arithmetic.",
      "transcript": [
        {
          "at": "0:00",
          "text": "Position sizing is the one part of trading that is pure arithmetic."
        },
        {
          "at": "0:40",
          "text": "Start with how much of your account you will lose if the trade fails. One to two per cent is common."
        },
        {
          "at": "1:30",
          "text": "Divide that amount by the distance to your stop, and you have your size."
        },
        {
          "at": "2:20",
          "text": "Place the stop where the idea is wrong, then size to it. Never the reverse."
        }
      ],
      "checks": [
        {
          "prompt": "Account 10,000, risk 1% per trade, stop 4% below entry. What is the position size?",
          "options": [
            {
              "key": "a",
              "text": "400"
            },
            {
              "key": "b",
              "text": "2,500"
            },
            {
              "key": "c",
              "text": "10,000"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "400 is 4% of the account. The amount at risk is 100, and 100 / 0.04 = 2,500.",
            "b": "Correct. 1% of 10,000 is 100, and 100 / 0.04 = 2,500.",
            "c": "The whole account with a 4% stop risks 4%, four times the limit."
          }
        },
        {
          "prompt": "What should set your position size?",
          "options": [
            {
              "key": "a",
              "text": "How strongly you believe in the trade"
            },
            {
              "key": "b",
              "text": "The largest size the venue allows"
            },
            {
              "key": "c",
              "text": "Your amount at risk and the distance to your stop"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Conviction is a feeling. Size has to come from arithmetic.",
            "b": "The venue's limit is about its risk appetite, not yours.",
            "c": "Correct. Those two numbers are all the calculation needs."
          }
        },
        {
          "prompt": "Your stop is in the right place but the size feels too small. What is the disciplined move?",
          "options": [
            {
              "key": "a",
              "text": "Move the stop closer so you can size up"
            },
            {
              "key": "b",
              "text": "Accept the size the arithmetic gives"
            },
            {
              "key": "c",
              "text": "Double the risk, just this once"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "A stop moved to fit a size no longer marks where the idea is wrong.",
            "b": "Correct. A small size on a sound trade is still a sound trade.",
            "c": "\"Just this once\" is how risk limits stop being limits."
          }
        },
        {
          "prompt": "Why size a leveraged trade from your stop rather than from your leverage?",
          "options": [
            {
              "key": "a",
              "text": "Leverage decides how much capital is posted; the stop decides how much you can lose"
            },
            {
              "key": "b",
              "text": "Leverage has no effect on risk"
            },
            {
              "key": "c",
              "text": "Stops do not work with leverage"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. The loss if you are wrong is size times stop distance, whatever the leverage.",
            "b": "Leverage changes how close liquidation is, which is why the stop must sit well inside it.",
            "c": "Stops work with leverage. They must simply sit before the liquidation price."
          }
        },
        {
          "prompt": "You risk 2% per trade and lose five trades in a row. Roughly how much of the account is gone?",
          "options": [
            {
              "key": "a",
              "text": "About 10%"
            },
            {
              "key": "b",
              "text": "About 50%"
            },
            {
              "key": "c",
              "text": "All of it"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. Roughly 10%, which is survivable. That is the point of a small fixed risk.",
            "b": "That would take about 13% risk per trade.",
            "c": "A small fixed risk is exactly what stops a losing streak from ending the account."
          }
        }
      ]
    },
    {
      "code": "A3",
      "course": "practical-execution",
      "position": 3,
      "title": "Writing a plan",
      "minutes": 10,
      "xp": 220,
      "requires": [
        "A2"
      ],
      "experience": null,
      "body": "## A plan is written before the trade\nA trading plan states in advance what you will trade, when you will enter, where you will exit if wrong, where you will take profit, and how much you will risk. Written down, before any position is open.\n\n## Exits matter more than entries\nMost plans are detailed about entries and vague about exits. Decide both your [[stop-loss|The exit you take if the trade proves you wrong.]] and your target before entering. An exit decided while carrying a loss is the one people regret.\n\n## Review when flat\nKeep a [[trading journal|A record of each trade: the plan, what happened, and whether the plan was followed.]] and review it when you have no open positions. Judge whether you followed the plan, not whether the trade made money.\n\n> **In practice**\n> If you cannot write down the exit before you enter, you do not have a trade yet, only an opinion.",
      "transcript": [
        {
          "at": "0:00",
          "text": "A plan is a set of decisions made before you are under pressure."
        },
        {
          "at": "0:40",
          "text": "It states the entry, the exit if wrong, the target, and the amount at risk."
        },
        {
          "at": "1:20",
          "text": "Exits deserve more care than entries, because they are decided while you are losing."
        },
        {
          "at": "2:00",
          "text": "Review the plan when you are flat, and judge the process, not the outcome."
        }
      ],
      "checks": [
        {
          "prompt": "When should the exit for a trade be decided?",
          "options": [
            {
              "key": "a",
              "text": "Before entering"
            },
            {
              "key": "b",
              "text": "Once the trade moves against you"
            },
            {
              "key": "c",
              "text": "When you start to feel unsure"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. Decided calmly, in advance, it is a rule. Decided under a loss, it is a hope.",
            "b": "That is precisely when judgement is worst.",
            "c": "Feelings are what the plan exists to replace."
          }
        },
        {
          "prompt": "Your plan says exit at 6% down. You are 7% down and convinced it will recover. What does the plan say to do?",
          "options": [
            {
              "key": "a",
              "text": "Hold, since you have new information"
            },
            {
              "key": "b",
              "text": "Add more to lower your average price"
            },
            {
              "key": "c",
              "text": "Exit as planned, and review the rule afterwards"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Conviction while carrying a loss is not new information. It is the situation the rule was written for.",
            "b": "Adding to a loser increases the very risk the plan was built to cap.",
            "c": "Correct. Plans are written for the moment they feel wrong. Review the rule when flat."
          }
        },
        {
          "prompt": "A trade made money but broke your plan. How should the journal record it?",
          "options": [
            {
              "key": "a",
              "text": "As a success"
            },
            {
              "key": "b",
              "text": "As a plan violation to learn from"
            },
            {
              "key": "c",
              "text": "It should be left out"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Profit from a broken rule teaches you to break it again.",
            "b": "Correct. The process is what you can repeat. The outcome of one trade is partly luck.",
            "c": "Leaving it out hides exactly the behaviour the journal is there to catch."
          }
        },
        {
          "prompt": "Which belongs in a written plan?",
          "options": [
            {
              "key": "a",
              "text": "A price prediction for next month"
            },
            {
              "key": "b",
              "text": "Entry, stop, target and the amount at risk"
            },
            {
              "key": "c",
              "text": "The trades other people are making"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "A plan is about your decisions, not forecasts.",
            "b": "Correct. These are the decisions a plan exists to fix in advance.",
            "c": "Other people's trades are not part of your plan."
          }
        },
        {
          "prompt": "When is the best time to change a rule in your plan?",
          "options": [
            {
              "key": "a",
              "text": "While a position is open and moving against you"
            },
            {
              "key": "b",
              "text": "When you have no open positions, after reviewing the journal"
            },
            {
              "key": "c",
              "text": "Never"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Rules changed under pressure are rules abandoned.",
            "b": "Correct. Change rules with evidence, and without a position to protect.",
            "c": "Rules should improve with evidence. The point is to change them calmly, not never."
          }
        }
      ]
    },
    {
      "code": "X1",
      "course": "advanced-markets",
      "position": 1,
      "title": "Derivatives basics",
      "minutes": 13,
      "xp": 260,
      "requires": [
        "A3"
      ],
      "experience": null,
      "body": "## A future is an agreement on a later price\nA [[futures contract|An agreement to buy or sell an asset at a set price on a future date.]] fixes a price now for a trade later. Many are settled in cash rather than by delivering the asset. Futures are traded on margin, so they carry leverage.\n\n## Perpetuals and funding\nA [[perpetual|A futures contract with no expiry date, kept close to the spot price by funding payments.]] has no expiry. To keep it near spot, holders on one side pay the other a periodic [[funding rate|A periodic payment between long and short holders of a perpetual that pulls its price towards spot.]]. When longs pay shorts, more traders are positioned long.\n\n## Options give a right, not an obligation\nA [[call option|The right, but not the obligation, to buy at a set price before a set date.]] gives the right to buy at a set price; a put gives the right to sell. The buyer's loss is limited to the premium paid. The seller's can be far larger.\n\n> **In practice**\n> Before trading any derivative, write down the most you can lose and exactly how it would happen. If you cannot, you do not understand the contract yet.",
      "transcript": [
        {
          "at": "0:00",
          "text": "A derivative is a contract whose value follows another asset."
        },
        {
          "at": "0:45",
          "text": "A future fixes a price now for a trade later, and it is traded on margin."
        },
        {
          "at": "1:40",
          "text": "A perpetual never expires. Funding payments between longs and shorts keep it near spot."
        },
        {
          "at": "2:30",
          "text": "Options give a right, not an obligation. The buyer's loss is limited to the premium."
        }
      ],
      "checks": [
        {
          "prompt": "Funding on a perpetual has been high and positive for weeks. What does that suggest?",
          "options": [
            {
              "key": "a",
              "text": "Many traders are positioned long, and longs are paying shorts"
            },
            {
              "key": "b",
              "text": "The exchange is raising its fees"
            },
            {
              "key": "c",
              "text": "The spot price is about to fall"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. Positive funding means longs pay shorts, which happens when long positioning is crowded.",
            "b": "Funding is paid between traders, not to the exchange.",
            "c": "Funding describes positioning. It is not a forecast."
          }
        },
        {
          "prompt": "What is the most the buyer of an option can lose?",
          "options": [
            {
              "key": "a",
              "text": "An unlimited amount"
            },
            {
              "key": "b",
              "text": "The premium paid"
            },
            {
              "key": "c",
              "text": "The strike price"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Unlimited losses belong to some option sellers, not buyers.",
            "b": "Correct. The buyer can walk away, losing only what was paid for the option.",
            "c": "The strike is the agreed price, not the buyer's loss."
          }
        },
        {
          "prompt": "How is a futures contract different from buying spot?",
          "options": [
            {
              "key": "a",
              "text": "It is an agreement to trade later at a set price, traded on margin"
            },
            {
              "key": "b",
              "text": "It always delivers the asset"
            },
            {
              "key": "c",
              "text": "It carries no price risk"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. A later trade at a fixed price, with leverage built in through margin.",
            "b": "Many futures settle in cash, with no asset delivered.",
            "c": "Futures carry the asset's price risk, multiplied by leverage."
          }
        },
        {
          "prompt": "A call option gives its buyer:",
          "options": [
            {
              "key": "a",
              "text": "The obligation to buy"
            },
            {
              "key": "b",
              "text": "The right to sell"
            },
            {
              "key": "c",
              "text": "The right, but not the obligation, to buy at a set price"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "An obligation is what the seller of the option takes on, not the buyer.",
            "b": "The right to sell is a put.",
            "c": "Correct. The buyer chooses whether to use it."
          }
        },
        {
          "prompt": "Why can a futures position lose money faster than the same amount of spot?",
          "options": [
            {
              "key": "a",
              "text": "Futures prices are more volatile than spot"
            },
            {
              "key": "b",
              "text": "It is traded on margin, which is leverage"
            },
            {
              "key": "c",
              "text": "Futures carry higher fees"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "A future tracks its asset closely. The difference is how much exposure your money controls.",
            "b": "Correct. Margin means the same capital controls a larger position, so losses arrive faster.",
            "c": "Fees are a small, steady cost. Leverage is what makes losses fast."
          }
        }
      ]
    },
    {
      "code": "X2",
      "course": "advanced-markets",
      "position": 2,
      "title": "Portfolio construction",
      "minutes": 13,
      "xp": 260,
      "requires": [
        "A3"
      ],
      "experience": null,
      "body": "## Weigh risk, not excitement\nA portfolio is a set of positions judged together. Two assets with the same return can add very different risk, depending on how volatile they are and how they move with everything else you hold.\n\n## Correlation decides what diversification is worth\n[[Correlation|How closely two assets move together, from -1 (opposite) to +1 (in step).]] measures how much assets move together. Holding ten assets that all move in step is closer to holding one. Diversification helps only when some positions do not fall with the rest.\n\n## Rebalancing keeps the plan honest\nOver time winners grow into a larger share of the portfolio, and risk concentrates. [[Rebalancing|Returning a portfolio to its target weights by trimming what has grown and adding to what has shrunk.]] back to target weights restores the risk you chose.\n\n> **In practice**\n> List what you hold and ask one question of each position: if everything else fell 30% tomorrow, would this fall with it?",
      "transcript": [
        {
          "at": "0:00",
          "text": "A portfolio is judged as a whole, not position by position."
        },
        {
          "at": "0:45",
          "text": "Two assets with the same return can add very different amounts of risk."
        },
        {
          "at": "1:40",
          "text": "Correlation decides whether diversification helps. Ten assets moving in step behave like one."
        },
        {
          "at": "2:30",
          "text": "Rebalancing trims what has grown, so the risk you hold stays the risk you chose."
        }
      ],
      "checks": [
        {
          "prompt": "You hold ten tokens that all rise and fall together. How diversified are you?",
          "options": [
            {
              "key": "a",
              "text": "Well diversified, with ten positions"
            },
            {
              "key": "b",
              "text": "Barely: holdings that move in step behave like one"
            },
            {
              "key": "c",
              "text": "It depends only on how many you hold"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "Ten positions that move together give you one risk, ten times.",
            "b": "Correct. Diversification comes from assets that behave differently, not from the count.",
            "c": "Count matters far less than how the positions move relative to each other."
          }
        },
        {
          "prompt": "What does a correlation of +1 between two assets mean?",
          "options": [
            {
              "key": "a",
              "text": "They move in opposite directions"
            },
            {
              "key": "b",
              "text": "They are unrelated"
            },
            {
              "key": "c",
              "text": "They move in step"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Opposite movement is a correlation of -1.",
            "b": "Unrelated movement is a correlation near 0.",
            "c": "Correct. At +1 they rise and fall together."
          }
        },
        {
          "prompt": "One position has grown from 10% to 40% of your portfolio. What has happened to your risk?",
          "options": [
            {
              "key": "a",
              "text": "It is unchanged"
            },
            {
              "key": "b",
              "text": "It has concentrated in that one position"
            },
            {
              "key": "c",
              "text": "It has fallen, because the position is profitable"
            }
          ],
          "correct": "b",
          "rationales": {
            "a": "The weights changed, so the risk changed with them.",
            "b": "Correct. Much more of your outcome now depends on one asset.",
            "c": "Past profit does not reduce future risk. A larger weight increases it."
          }
        },
        {
          "prompt": "What does rebalancing do?",
          "options": [
            {
              "key": "a",
              "text": "Trims what has grown and adds to what has shrunk, back to target weights"
            },
            {
              "key": "b",
              "text": "Sells everything that has fallen"
            },
            {
              "key": "c",
              "text": "Moves everything into the best performer"
            }
          ],
          "correct": "a",
          "rationales": {
            "a": "Correct. It restores the risk you originally chose.",
            "b": "That is abandoning positions, not rebalancing.",
            "c": "That is the opposite of rebalancing: it concentrates risk."
          }
        },
        {
          "prompt": "When does adding an asset reduce portfolio risk the most?",
          "options": [
            {
              "key": "a",
              "text": "When it has the highest recent return"
            },
            {
              "key": "b",
              "text": "When it is the most volatile available"
            },
            {
              "key": "c",
              "text": "When it moves independently of, or against, what you already hold"
            }
          ],
          "correct": "c",
          "rationales": {
            "a": "Recent return says nothing about how it behaves alongside your other holdings.",
            "b": "Volatility on its own adds risk.",
            "c": "Correct. Low or negative correlation is what makes diversification work."
          }
        }
      ]
    }
  ],
  "placement": [
    {
      "tier": "learn",
      "prompt": "A friend says a token \"went up 8% today\". Eight per cent of what, exactly?",
      "options": [
        {
          "key": "a",
          "text": "Of its price at the start of the period being measured"
        },
        {
          "key": "b",
          "text": "Of the total money invested in it worldwide"
        },
        {
          "key": "c",
          "text": "Of the exchange's daily trading limit"
        }
      ],
      "correct": "a",
      "rationales": {
        "a": "Correct. A percentage move is always measured against a starting price over a stated period. Without the period, the number means nothing.",
        "b": "A price move is about price, not about how much money is invested in the asset.",
        "c": "Some venues pause trading on large moves, but a price change is not measured against any limit."
      }
    },
    {
      "tier": "learn",
      "prompt": "What is actually being exchanged when you \"buy\" on an exchange?",
      "options": [
        {
          "key": "a",
          "text": "A promise from the exchange to pay you later"
        },
        {
          "key": "b",
          "text": "Your money for an asset, at a price someone else agreed to sell at"
        },
        {
          "key": "c",
          "text": "A share of the exchange's reserves"
        }
      ],
      "correct": "b",
      "rationales": {
        "a": "On spot you receive the asset, or a claim on it, not a promise of payment.",
        "b": "Correct. Every trade needs a willing seller at your price. That is why thin markets move sharply: there are fewer people on the other side.",
        "c": "You buy the asset from another trader, not a share of the exchange."
      }
    },
    {
      "tier": "safeguard",
      "prompt": "You open a position with 10x leverage. The asset falls 10%. What has happened to your capital?",
      "options": [
        {
          "key": "a",
          "text": "You have lost about 10% of it"
        },
        {
          "key": "b",
          "text": "You have lost roughly all of it"
        },
        {
          "key": "c",
          "text": "Nothing, until you close the position"
        }
      ],
      "correct": "b",
      "rationales": {
        "a": "That would be true without leverage. At 10x the move is multiplied ten times.",
        "b": "Correct. Leverage multiplies both directions. At 10x, a 10% adverse move wipes out roughly the whole margin. This one idea prevents more losses than any other.",
        "c": "The venue acts on unrealised losses. A leveraged position can be closed for you before you choose to."
      }
    },
    {
      "tier": "safeguard",
      "prompt": "Someone offers guaranteed 5% monthly returns with no risk. The most useful response is:",
      "options": [
        {
          "key": "a",
          "text": "Ask which regulator authorises them, and check the register yourself"
        },
        {
          "key": "b",
          "text": "Start small to test whether it pays"
        },
        {
          "key": "c",
          "text": "Ask for testimonials from existing members"
        }
      ],
      "correct": "a",
      "rationales": {
        "a": "Correct. Guaranteed returns are the oldest signal there is. Checking the register yourself is the one test a scheme cannot pass.",
        "b": "Schemes often pay out on small early deposits to win bigger ones.",
        "c": "Testimonials are easy to fake, and existing members are part of how schemes recruit."
      }
    },
    {
      "tier": "apply",
      "prompt": "You have a 2% risk limit per trade and a stop 5% below entry. Roughly what position size fits?",
      "options": [
        {
          "key": "a",
          "text": "About 40% of your account"
        },
        {
          "key": "b",
          "text": "About 10% of your account"
        },
        {
          "key": "c",
          "text": "The full account, since the stop protects you"
        }
      ],
      "correct": "a",
      "rationales": {
        "a": "Correct. Risk equals position size times distance to stop. 40% of the account moving 5% loses 2% of the account. Sizing is arithmetic, not instinct.",
        "b": "10% of the account falling 5% loses 0.5%, a quarter of your limit.",
        "c": "The full account falling 5% loses 5%, more than twice your limit, and stops can slip in fast markets."
      }
    },
    {
      "tier": "apply",
      "prompt": "Your plan says exit at a 6% loss. You are down 7% and convinced it will recover. The disciplined action is:",
      "options": [
        {
          "key": "a",
          "text": "Hold, since you have new information"
        },
        {
          "key": "b",
          "text": "Exit as planned, and review the rule afterwards"
        },
        {
          "key": "c",
          "text": "Add more to lower your average price"
        }
      ],
      "correct": "b",
      "rationales": {
        "a": "Conviction under a loss is not new information. It is the situation the rule was written for.",
        "b": "Correct. Plans are written precisely for the moment they feel wrong. Review the rule when flat, never while carrying the position.",
        "c": "Adding to a losing position increases the risk the plan was built to cap."
      }
    },
    {
      "tier": "specialise",
      "prompt": "What does a perpetual futures funding rate actually do?",
      "options": [
        {
          "key": "a",
          "text": "Pays the exchange for holding a position overnight"
        },
        {
          "key": "b",
          "text": "Transfers payments between long and short holders to keep the price near spot"
        },
        {
          "key": "c",
          "text": "Sets the maximum leverage available that day"
        }
      ],
      "correct": "b",
      "rationales": {
        "a": "Funding is paid between traders, not to the exchange as a holding fee.",
        "b": "Correct. Funding is a periodic payment between the two sides that anchors the perpetual to spot. Persistently high funding is a crowding signal.",
        "c": "Leverage limits are set by the venue separately. Funding does not change them."
      }
    },
    {
      "tier": "specialise",
      "prompt": "Two assets both returned 20% last year. What would most change how you weight them?",
      "options": [
        {
          "key": "a",
          "text": "Which had the larger single-day gain"
        },
        {
          "key": "b",
          "text": "How they moved relative to each other and to the rest of the portfolio"
        },
        {
          "key": "c",
          "text": "Which is more widely discussed"
        }
      ],
      "correct": "b",
      "rationales": {
        "a": "One day's move says little about the risk an asset adds over time.",
        "b": "Correct. Portfolio construction is about correlation and contribution to total risk, not about ranking returns side by side.",
        "c": "Popularity says nothing about how an asset behaves in a portfolio."
      }
    }
  ]
}
$demo$);

-- ---------------------------------------------------------------------
-- Academies, with their brand tokens.
-- ---------------------------------------------------------------------
INSERT INTO app.tenants (slug, name, primary_domain, brand, status)
SELECT a->>'slug', a->>'name', a->>'domain', a->'brand', 'active'
  FROM demo, jsonb_array_elements(doc->'academies') a
ON CONFLICT (slug) DO UPDATE
   SET name = EXCLUDED.name, primary_domain = EXCLUDED.primary_domain,
       brand = EXCLUDED.brand, status = 'active';

-- ---------------------------------------------------------------------
-- Courses, one per tier, platform-owned.
-- ---------------------------------------------------------------------
INSERT INTO platform.courses (slug, title, tier, summary, est_minutes, review_state, published_at)
SELECT c->>'slug', c->>'title', (c->>'tier')::platform.tier, c->>'summary', (c->>'minutes')::int, 'published', now()
  FROM demo, jsonb_array_elements(doc->'courses') c
ON CONFLICT (slug) DO UPDATE
   SET title = EXCLUDED.title, tier = EXCLUDED.tier, summary = EXCLUDED.summary,
       est_minutes = EXCLUDED.est_minutes, review_state = 'published',
       published_at = COALESCE(platform.courses.published_at, EXCLUDED.published_at), updated_at = now();

CREATE TEMP TABLE demo_course ON COMMIT DROP AS
SELECT co.id, co.tier
  FROM demo CROSS JOIN LATERAL jsonb_array_elements(doc->'courses') c
  JOIN platform.courses co ON co.slug = c->>'slug';

-- ---------------------------------------------------------------------
-- Lessons.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE demo_lesson ON COMMIT DROP AS
SELECT l->>'code' AS code, co.id AS course_id, co.tier, (l->>'position')::int AS position, l
  FROM demo CROSS JOIN LATERAL jsonb_array_elements(doc->'lessons') l
  JOIN platform.courses co ON co.slug = l->>'course';

INSERT INTO platform.lessons
  (course_id, position, title, body_md, transcript, duration_secs, author_name, reviewer_name, reviewed_at, xp, experience)
SELECT d.course_id, d.position, d.l->>'title', d.l->>'body', d.l->'transcript', (d.l->>'minutes')::int * 60,
       'Draft, Global Tutoring Lab curriculum', 'Pending compliance review', NULL,
       (d.l->>'xp')::int, d.l->>'experience'
  FROM demo_lesson d
ON CONFLICT (course_id, position) DO UPDATE
   SET title = EXCLUDED.title, body_md = EXCLUDED.body_md, transcript = EXCLUDED.transcript,
       duration_secs = EXCLUDED.duration_secs, author_name = EXCLUDED.author_name,
       reviewer_name = EXCLUDED.reviewer_name, reviewed_at = NULL,
       xp = EXCLUDED.xp, experience = EXCLUDED.experience;

ALTER TABLE demo_lesson ADD COLUMN lesson_id uuid;
UPDATE demo_lesson d SET lesson_id = l.id
  FROM platform.lessons l WHERE l.course_id = d.course_id AND l.position = d.position;

-- ---------------------------------------------------------------------
-- Prerequisites, replaced wholesale for the demo lessons.
-- ---------------------------------------------------------------------
DELETE FROM platform.lesson_prerequisites p
 USING demo_lesson d WHERE p.lesson_id = d.lesson_id;

INSERT INTO platform.lesson_prerequisites (lesson_id, requires_lesson_id)
SELECT d.lesson_id, r.lesson_id
  FROM demo_lesson d CROSS JOIN LATERAL jsonb_array_elements_text(d.l->'requires') req(code)
  JOIN demo_lesson r ON r.code = req.code;

-- ---------------------------------------------------------------------
-- Knowledge checks: five per lesson, three drawn per attempt.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE demo_question ON COMMIT DROP AS
SELECT md5('pocketfolio-demo:check:' || d.code || ':' || q.n)::uuid AS id,
       d.course_id, d.lesson_id, d.tier, false AS is_placement, q.q
  FROM demo_lesson d CROSS JOIN LATERAL jsonb_array_elements(d.l->'checks') WITH ORDINALITY q(q, n)
UNION ALL
-- Placement questions belong to the course of their tier, with no lesson.
SELECT md5('pocketfolio-demo:placement:' || p.n)::uuid,
       dc.id, NULL, dc.tier, true, p.q
  FROM demo CROSS JOIN LATERAL jsonb_array_elements(doc->'placement') WITH ORDINALITY p(q, n)
  JOIN demo_course dc ON dc.tier = (p.q->>'tier')::platform.tier;

INSERT INTO platform.questions (id, course_id, lesson_id, tier, is_placement, prompt, options, correct_key, rationales)
SELECT id, course_id, lesson_id, tier, is_placement, q->>'prompt', q->'options', q->>'correct', q->'rationales'
  FROM demo_question
ON CONFLICT (id) DO UPDATE
   SET course_id = EXCLUDED.course_id, lesson_id = EXCLUDED.lesson_id, tier = EXCLUDED.tier,
       is_placement = EXCLUDED.is_placement, prompt = EXCLUDED.prompt, options = EXCLUDED.options,
       correct_key = EXCLUDED.correct_key, rationales = EXCLUDED.rationales;

-- Questions dropped from the document leave the demo courses too.
DELETE FROM platform.questions q
 WHERE q.course_id IN (SELECT id FROM demo_course)
   AND q.id NOT IN (SELECT id FROM demo_question);

-- ---------------------------------------------------------------------
-- Every academy offers all four courses, in tier order.
-- ---------------------------------------------------------------------
INSERT INTO app.tenant_catalogues (tenant_id, course_id, enabled, position)
SELECT t.id, dc.id, true, array_position(ARRAY['learn','safeguard','apply','specialise'], dc.tier::text)
  FROM demo CROSS JOIN LATERAL jsonb_array_elements(doc->'academies') a
  JOIN app.tenants t ON t.slug = a->>'slug'
  CROSS JOIN demo_course dc
ON CONFLICT (tenant_id, course_id) DO UPDATE SET enabled = true, position = EXCLUDED.position;

COMMIT;
