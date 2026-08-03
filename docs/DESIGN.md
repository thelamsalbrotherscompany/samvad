# Samvad — Design Direction

The brief was "feels like a designer made it." That is a real requirement, so it gets a
real document. Design decisions here are as binding as the architectural ones.

---

## The idea

**संवाद** means *dialogue* — not "meeting", not "conference". Meetings are things you
attend; dialogue is something you take part in. That distinction is the whole design.

Zoom feels like enterprise software: cold blue, dense chrome, a wall of controls. Meet
feels like a Google product: primary colors, utilitarian, slightly clinical. Both are
designed to look like *tools*.

Samvad should feel like **a well-lit room**. Warm, calm, quiet. The interface recedes and
the people are the content. Confidence expressed through restraint rather than through
features on display.

---

## Principles

1. **The video is the interface.** Chrome fades after 3s of idle and returns on any
   input. Maximum pixels for faces, minimum for buttons
2. **Calm over responsive.** Everything eases; nothing snaps. Tiles *settle* into
   position. 200–300ms, `cubic-bezier(0.32, 0.72, 0, 1)`
3. **One accent, used sparingly.** A single warm accent earns attention precisely because
   it is rare. If everything is highlighted, nothing is
4. **Privacy is visible, not buried.** Encryption state, participant count, and recording
   status are always on screen — quiet when normal, unmissable when not
5. **Nothing loads from the internet.** Self-hosted fonts, inlined icons, zero CDN. A
   privacy constraint that happens to produce a faster, more consistent product

---

## Color

Dark-first — video looks better against dark surfaces, and it's what people use for
calls. Light theme is fully supported, not an afterthought.

```
Base        #14110F   warm charcoal — brown-tinted, never blue-grey, never pure black
Surface     #1E1A17   raised panels
Surface-2   #2A2521   controls, hover states
Border      #3A332D   hairlines, 1px
Text        #F5F0EA   warm off-white — pure #FFF is harsh on dark
Text-muted  #A69B90
Accent      #E8A33D   marigold — culturally rooted, warm, restrained
Accent-2    #4A9E8F   muted teal — secondary actions, links
Danger      #D96A5B   leave call, errors — desaturated, not alarming red
Live        #6BBF8A   encryption OK, connection good
```

The accent is **marigold**, not saffron-orange and not corporate blue — warm, distinctive,
and rooted in the cultural context the name comes from without being costume. It appears
on the primary action and essentially nowhere else.

---

## Typography

**IBM Plex Sans** + **IBM Plex Sans Devanagari**. Open source, self-hosted, and it has
genuine character — Inter is safe but anonymous, and the Devanagari companion means
संवाद renders as a first-class citizen rather than a fallback.

```
Display   32/1.2   600   room names, landing
Title     20/1.3   600   panel headers
Body      15/1.5   400   the default
Label     13/1.4   500   buttons, participant names
Caption   12/1.4   400   timestamps, status
Mono      13/1.5   400   IBM Plex Mono — room codes, keys
```

Room codes and passphrases are always monospace with unambiguous glyphs. People read
these aloud over the phone.

---

## Reference points

Not Zoom, not Meet. Their defaults are inherited from a webinar-and-conference-room past,
and copying them imports their mistakes. The clearest example: both default to an
**equal-tile gallery**, which on a phone renders thirty unreadable slivers and on any
screen optimizes for "see everyone at once" — a goal no one in a conversation actually
has. We design from what a person in a call is *doing*, not from what the incumbents ship.

When a competitor does something well, borrow the reasoning, never the layout on faith.

## Layout: attention over coverage

**Samvad defaults to speaker-focus, not a grid.** संवाद means *dialogue*; attention
follows whoever is speaking, so the interface should too. This is a decision, enforced in
code (`features/stage/`), not a toggle default.

- **Speaker view (default).** The active speaker — later, a screen-share — is large.
  Everyone else is a rail of smaller tiles; your own camera is a small self-view PiP,
  never competing with the people you're talking to. The rail adapts to the screen: a
  **vertical rail down the right on desktop** (the speaker keeps the whole left — right for
  a 3-person call as much as a 30-person one), a **horizontal filmstrip along the bottom on
  a phone** (a side rail would eat too much of a portrait width).
- **Grid (the exception).** Equal tiles, auto-used only for **solo (1) and 1:1 (2)** on a
  wide screen — sizes with no single speaker to feature, where peers read better side by
  side. From **three people up, speaker view leads**. Grid remains one tap away at any size
  via the toggle, and is **capped** so tiles can never shrink into slivers — past the cap
  the last cell is a `+N`.
- **Phones are always speaker view.** A face grid is useless at that width. This isn't a
  fallback; it's the correct layout for the device.
- **Classroom** (a named use case): the presenter is large, participants are audio-first
  in the filmstrip/roster, and a raised hand is what promotes someone — not an equal tile
  they never asked for.

Layout selection is automatic (device + participant count), with a manual grid/speaker
toggle in the controls. The UI never asks the user to think about layout to get a good one.

### Attention has a precedence order

The featured area shows whatever the room's attention is genuinely on, in this order:

1. **A shared screen.** Presentation outranks everyone, so a screen-share forces speaker
   view and takes the feature — *even in a 2-person call*, which otherwise shows equal
   tiles. When you're looking at a screen, faces are secondary by definition.
2. **The active speaker**, otherwise.

### Mirroring: match Google Meet, self-view only

You see yourself like a mirror: raise your right hand and it appears on your right. This
is on by default and it is a **must** — a non-mirrored self-view (right hand on the left)
is disorienting enough that people abandon the call, and every major client defaults it on.

**Everyone else is shown in true, un-mirrored orientation — exactly like Google Meet.**
This is the tested default: it keeps any text a remote holds up readable, and it's what
users coming from other apps expect. The honest cost is that a remote's raised right hand
appears on *your* left (they're shown as if sitting across from you); Meet accepts this,
and so do we.

An opt-in **"mirror everyone"** setting flips remotes too, for viewers who prefer
consistent hand-sides over readable held-up text. It's off by default, per-viewer, and
changes nothing for anyone else in the call.

Two rules hold regardless:

1. **Mirroring is a video-frame operation, never a text one.** It flips the `<video>`,
   never a label, overlay, or placeholder. Flipping text just reverses letters — that's a
   bug, not a mirror.
2. **Screen shares are never mirrored**, even with "mirror everyone" on. A shared
   document, slide, or whiteboard must stay readable.

### A raised hand is a request the room can't miss

Raising a hand asks for attention, so it's surfaced at attention-scale, not as a stamp on
one tile among thirty:

- A bright marigold **"N hands raised"** indicator sits top-centre, seen regardless of how
  many tiles are on the stage.
- Raised hands **float to the front of the rail**, so they're where the eye lands first.
- The tile badge itself pulses. Colour is never the only signal — there's an icon and
  motion too (accessibility).

This is the seed of the classroom **speaking queue** (ROADMAP Phase 5): an ordered,
first-raised-first list is the natural next step from "float to the front."

**Stage** — fills the viewport. Reflow is animated with FLIP so tiles glide rather than
teleport when someone joins or the featured speaker changes.

**Tiles** — 12px radius, 16:9, `object-fit: cover`. The active speaker gets a 2px accent
ring that fades in over 400ms — no jarring pop, no border-flicker when two people talk
over each other (200ms debounce).

**Controls** — floating capsule, bottom center, `backdrop-filter: blur(24px)`. Mic and
camera are large and unmissable. Leave is separated by a gap and colored `danger`; you
should never hit it by accident.

**Roster / chat** — right sidebar, slides in at 240ms, overlays on narrow viewports rather
than squeezing the stage.

### Motion budget

| Element | Duration | Curve |
|---|---|---|
| Tile reflow | 300ms | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Panel slide | 240ms | same |
| Control fade | 200ms | `ease-out` |
| Speaker ring | 400ms in / 600ms out | `ease-in-out` |
| Chrome auto-hide | after 3000ms idle | — |

All of it collapses to 0ms under `prefers-reduced-motion`. Not negotiable.

---

## The moments that decide whether it feels designed

Anyone can style a video grid. These are the screens that separate a product from a demo,
and they are where the design time should actually go:

1. **Pre-join.** The first impression, and the highest-anxiety moment in any call app.
   Live camera preview, a mic level meter that actually moves, device pickers that
   remember. *"You look and sound good"* before anyone sees you
2. **Empty room.** You're first, waiting alone. Most products show a void. Show the room
   name, a copyable link, a calm "waiting for others" state — never a dead grey box
3. **Someone joins.** A gentle presence animation, not a popup. The grid rebalances smoothly
4. **Connection degrades.** Honest, specific, non-panicky: *"Your connection is unstable —
   video paused to keep audio clear."* Explain what's happening and what you're doing
5. **Call ends.** Not an abrupt teleport to a blank page. A brief, warm summary — duration,
   participants — and an obvious way back in if leaving was a misclick

---

## Accessibility

Non-negotiable, and cheaper to build in than to retrofit:

- Every control reachable and operable by keyboard; visible focus rings throughout
- All text meets WCAG AA against its actual background (verify against video, not just tokens)
- Participant tiles carry proper `aria-label`s; join/leave announce via a live region
- Captions plugin renders at user-controlled size with a solid backing plate
- `prefers-reduced-motion` and `prefers-contrast` both honored
- Never encode state in color alone — mute is an icon *and* a color, always

---

## Identity

- **Wordmark:** "Samvad" in Plex Sans 600, with **संवाद** set smaller beneath it. Both
  scripts, always together — the name means something, and hiding half of it wastes that
- **Mark:** two overlapping rounded forms — a dialogue, two voices in the same space.
  Must survive being rendered at 16px as a favicon
- **Voice:** plain, warm, technically honest. Never markety, never fear-based. Samvad
  doesn't sell privacy by frightening people; it just doesn't collect anything and says so
