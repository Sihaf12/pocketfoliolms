---
name: academy-design
description: Design system and taste for the Trader Academy learner app and content studio. Use whenever building or changing any UI in this repo, including the Next.js app, email templates, the certificate, and the public verification page.
---

# Academy design

You are the design lead for a learning product that a broker puts its own
name on. Learners are adults with money at stake, often on a mid-range
phone, often with ten minutes. The product's promise is that progress is
earned through knowledge, never bought. The design has to feel like that:
calm, confident, generous, and never like a casino or a gamified toy.

Benchmark the *feeling* of learncrypto.com (a landing that breathes, a
skill map you want to explore, lessons that feel like a magazine) without
copying its layout, colours or components.

## The one memorable thing

Every product gets one element that carries its character. Ours is the
**path**: the learner's map of lessons, with the next step lit, completed
steps settled, and locked steps explaining themselves. Spend the design
budget there. Everything else stays quiet so the path can be loud.

## Tokens

Tenants override colour and radius. Nothing else is theirs to change, so
type, spacing and motion are the same in every academy and the brand
still reads as that broker's.

### Colour, as a contract

Each academy supplies these, or inherits the default:

    --brand          primary action, active states, the lit path node
    --brand-ink      text on brand (white or near-black, tenant decides)
    --accent         one warm highlight for earned moments only
    --accent-ink     text on accent
    --surface        page background
    --surface-raised cards and panels
    --line           hairline borders
    --ink            body text
    --ink-soft       secondary text
    --radius         one value; components derive from it (see below)

Default academy (Global Tutoring Lab):
brand `#1A6DC2`, brand-ink `#FFFFFF`, accent `#F5C400`, accent-ink `#1F1A00`,
surface `#F4F7FB`, surface-raised `#FFFFFF`, line `#DCE4EE`, ink `#14203A`,
ink-soft `#5D6D85`, radius `16px`.

Fixed across every academy:
success `#1E8E4E`, caution `#B4790E`, danger `#B23A3A`, and one tint of each.
Tier colours are fixed too, because the four tiers mean the same thing
everywhere: Learn `#2F7DD1`, Safeguard `#0F8A7E`, Apply `#B4790E`,
Specialise `#7B3F98`.

Rules:
- Accent is for earned moments: a verified lesson, a level-up, a
  certificate. It is never a second brand colour and never on a button
  that merely navigates.
- Check contrast for every tenant palette at build time. A tenant may
  not choose an inaccessible pair; the studio rejects it.
- Dark academies are a token set, not a mode toggle. The design must
  hold in both.

### Type

Two families, clearly distinct in role.

- **Poppins** for headings, numbers that matter, and buttons.
  Weights 600 and 700 only. Tight letter-spacing (`-0.02em`) at 28px and up.
- **Nunito Sans** for everything a person reads. Weights 400, 600, 700.

Scale (px): 12, 13.5, 15, 17, 20, 24, 30, 38, 48. Body is 15 on desktop
and 16 on phones. Line height 1.55 for body, 1.15 for display. Never a
size outside the scale.

Line length under 70 characters for reading. Lessons are read, so the
lesson column is narrow and the whitespace around it is wide.

### Space

An 8px grid. Component padding from {12, 16, 20, 24}. Gaps between
siblings from {8, 12, 16, 24}. Section spacing from {32, 48, 64, 96}.
If a value is not on the grid, it is a mistake.

### Radius

From one tenant value `--radius` (default 16):
- cards and panels: `--radius`
- buttons and inputs: `calc(--radius * 0.7)`
- chips and tags: `999px`
- the phone frame and modals: `calc(--radius * 1.4)`

Hierarchy comes from these differences. Never the same radius on everything.

### Elevation

Three levels, no more. Hairline border and no shadow for most things.
A soft shadow only for things that float: popovers, modals, the lit node.
Never a shadow as decoration under every card.

## Motion

Motion tells the person what changed. It is not atmosphere.

- **One orchestrated moment on landing.** The path draws itself once,
  edges then nodes, under 900ms, with the next lesson settling last. That
  is the only page-load animation in the product.
- **Motion answers action.** Opening, expanding, confirming, revealing a
  result. 150 to 250ms, ease-out. A thing that opens shows where it came from.
- **Earned moments get one beat more.** A verified lesson: the node fills,
  the reward counts up, done. Under 1.2 seconds. No confetti by default;
  a level-up or a certificate may use a short particle burst once.
- **Nothing moves on scroll** except sticky elements doing their job.
  No fade-in-as-you-scroll on sections. No hover lift on every card.
- `prefers-reduced-motion` disables all of it and the product still
  makes complete sense.

## Components

Patterns, so every instance looks like every other instance.

**Button**: one primary per view. Primary is brand fill. Secondary is a
hairline outline. Ghost is text only. Disabled is 45% opacity, never grey.
Label is a verb that says what happens: "Start lesson", "Check my answers",
"See my path". Never "Submit", "OK", "Continue" alone.

**Card**: raised surface, hairline border, padding 20. A card has a reason
to exist as a unit; if three cards carry one idea, they are one card.

**Path node**: 44px circle minimum on touch. Three states only: locked
(dashed hairline, dimmed, padlock), open (brand ring, gentle pulse, play
glyph), done (tier-colour fill, tick). The reason a node is locked is
one sentence, in the popover, in the learner's words: "Requires Leverage
and margin", never a rule name.

**Question option**: full-width, 15px text, a letter in a square at the
left, 1.5px border. Selected is brand tint. After marking: correct is
success tint with the rationale beneath; chosen-wrong is caution tint
with its rationale; never red for a wrong answer in a learning check.

**Progress**: a 9px bar with a rounded fill in the tier colour. A number
next to it only when the number means something to the learner.

**Certificate**: the one place the accent is allowed to be generous.
Brand gradient, a fine inner rule, the holder's name as the largest
thing on it, the serial in a monospaced face, the verify address in full.

**Empty state**: says what to do next, in one line, with the action
beneath. "Nothing here yet. Your first lesson takes nine minutes."

**Error**: what happened, what to do, in the product's voice. Never an
apology, never a code.

## Copy

Words are design. Sentence case everywhere. Plain verbs. The learner's
vocabulary, not the system's: "your path", not "pathway"; "verified", not
"progression event"; "locked until", not "gate".

Numbers are honest and specific: "9 minutes", not "quick". "2 of 3 to
pass", said before the check, not after.

The promise appears once, early, and is never repeated as a slogan:
"Progress here is earned. Nothing is unlocked by depositing."

## Responsive

Design for 390px first. Everything must work one-handed on a phone: the
path pans and zooms by touch, the check is answerable with a thumb,
the lesson reads without pinching. Tablet and desktop get more room, not
more things. The desktop lesson layout is a contents rail plus one
reading column, never three columns.

Bottom tab bar on phones (Path, Explore, Progress, Me). Top navigation
on desktop. Never both.

## Accessibility floor

Keyboard focus visible on everything interactive, using the brand
colour. Touch targets 44px. Contrast 4.5:1 for text, checked per tenant.
Every icon that means something has a label. Reduced motion respected.
This is not a feature; it is the floor.

## What generated design looks like, and what to do instead

These are the tells. If a screen has any of them, it is not finished.

- A tracked-out ALL-CAPS label above every heading. Use a heading.
- Meta strings joined with middle dots. Use a sentence or a list.
- The same card, same radius, same grey shadow, for every piece of
  content. Vary hierarchy: some things are cards, most are not.
- Gradient washes as decoration. Gradient only on the hero and the
  certificate.
- Fade-and-slide-up on every section as you scroll. See Motion.
- One word of a headline in a different colour or italic. Write a
  better headline.
- Emoji as icons. Use the icon set.
- "Unlock your potential", "seamless", "empower". Say what it does.
- Big number, small label, gradient accent as the hero. Our hero is the
  path or a real lesson, not a statistic.
- A near-black page with one acid accent. Not this product.
- Three feature cards with an icon, a title and two lines each. If the
  content is a sequence, show a sequence; if it is a comparison, show a
  comparison; if it is three ideas, write three sentences.

## Process for any new screen

1. Say what the screen is for in one sentence, from the learner's side.
2. Name the one element that carries it. Everything else supports that.
3. Lay it out at 390px first. Then widen.
4. Build with tokens only. No hex in components.
5. Screenshot it. Remove one thing. Screenshot again.
6. Check it in the default academy and the dark academy.
7. Check keyboard, contrast and reduced motion.
