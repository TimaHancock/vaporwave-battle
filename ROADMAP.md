# Roadmap and Claude Code prompts

Drop this in the repo root. It supersedes the phase list in `README.md`.

## Where this stands

Phase 0 is complete and verified: build pipeline, three verification channels,
seeded RNG, damage formula, sprite billboard layer with contact shadows, brand
palette sampled from the site design, CI with gates, Azure deploy.

48 unit tests. Zero gameplay.

The order below is the council's restructure, not the original plan. The
original sequenced the cheap, certain work first and the expensive, uncertain
work last. This inverts that: the highest-uncertainty question gets answered
in the first session.

## Two decisions, now defaulted

Both were being treated as gates. Neither is worth blocking on, and both are
reversible. Written down here so they stop being open:

**Turn order: discrete turn queue, not ATB.** Everyone acts once per round in
speed order. A queue still renders a turn-order preview bar exactly like the
reference art — arguably better, since the upcoming order is knowable rather
than a moving prediction. ATB's real cost is that HASTE applied mid-battle
reorders a queue that is already on screen, which is a whole class of
edge cases for a visual effect you get either way. Revisit after Phase 4 if
the combat feels too static.

**UI: vanilla DOM, revisit at Phase 4.** The HUD is already a pure render
function taking a model, so swapping in Preact later is mechanical. Five party
cards each reacting to HP, MP, and status will make vanilla tedious — but that
pain arrives at Phase 4, and by then you will know whether it is worth 4 kB.

## The phases

| # | Phase | Answers | Verified by | Sessions |
|---|---|---|---|---|
| 1 | Visual validation | Does this look like the reference? | Screenshots | 1 |
| 2 | Battle logic | Do the numbers work? | Vitest | 1 |
| 3 | Playable spike | Is one turn satisfying? | Playwright DOM | 1–2 |
| 4 | Cast and boss | Does it read as a fight? | Screenshots | 2 |
| 5 | Real HUD | Does it look like the reference image? | Playwright DOM | 2 |
| 6 | Juice | Does it feel good? | Screenshots | 1–2 |
| 7 | Ship | Does it work on a phone? | Both | 1 |

**Set a kill date now.** End of September is defensible with WGU finishing in
December. If Phase 5 is not done by then, this parks until January. Write the
date at the top of `CLAUDE.md` so it is in front of you every session.

---

# Phase 1 — Visual validation

**The point of this phase is to find out if the project is worth continuing.**
Everything else is downstream of whether AI-generated flat art sits
convincingly in this 3D scene once bloom is on. That is one session, and it
should happen before any more logic is written.

Do the art step first, by hand, outside Claude Code:

1. Generate one character with the prompt from
   `public/characters/README.md`.
2. Check the silhouette edge at 400% zoom, especially the sword blade.
3. Confirm the light lands on the **left**. If reversed, regenerate — do not
   mirror, it swaps the weapon hand.
4. Save as `public/characters/kira.png`.

Then:

### 1a — Post-processing

> Plan mode. Add a bloom post-processing pass to the scene.
>
> Use `EffectComposer`, `RenderPass`, `UnrealBloomPass`, and `OutputPass` from
> `three/examples/jsm/postprocessing/`. Note that `OutputPass` must be last and
> that adding it means `renderer.outputColorSpace` and tone mapping are handled
> by the pass, not the renderer — check whether `main.ts` needs changing so
> colours do not get double-corrected.
>
> Put the composer in a new `src/scene/post.ts` with a `createPostProcessing()`
> factory that takes the renderer, scene, and camera and returns
> `{ composer, setSize, setBloom, params, dispose }`. Register everything
> disposable with the existing `DisposalRegistry` pattern.
>
> Expose bloom strength, radius, and threshold in `__debugState` under a new
> `post` key so the values are assertable, and support reading overrides from
> URL params (`?bloom=1.2&bloomRadius=0.4&bloomThreshold=0.85`) so I can tune
> by reloading rather than by editing code.
>
> Starting values: strength 1.1, radius 0.4, threshold 0.85. The scene is
> mostly dark plum with hot magenta and cyan emissive edges — threshold should
> be high enough that the platform and columns do not bloom, only the neon.
>
> Add two entries to `scripts/shots.config.mjs`: `bloom_off` (`?bloom=0`) and
> `bloom_on`, both at seed 1337, time 4.0.
>
> Do not change the camera, the light rig, or the palette. Do not touch
> `src/battle/`.
>
> When done: run `npm run typecheck`, then `npm run shots`, then read
> `shots/bloom_on.png` and `shots/bloom_off.png` and tell me what actually
> changed between them.

### 1b — Real art in the scene

> Replace the placeholder sprite for the first party member with the real
> texture at `public/characters/kira.png`.
>
> `loadCharacterTexture` is async and rejects on failure. Restructure the
> bootstrap in `main.ts` so the cast is spawned after textures resolve, without
> breaking the `?time=` deterministic step mode — the harness waits on
> `__debugState.ready`, so `ready` must stay false until the sprites exist.
> Keep placeholders for the other four.
>
> Add a shot `first_art` at seed 1337, time 1.0.
>
> Then run `npm run shots` and look at `shots/first_art.png`. Tell me
> specifically: is there a visible halo or fringe along the character's
> silhouette, does the contact shadow read as touching the floor, and does the
> character's baked lighting agree with the scene's key light coming from the
> upper front-left?

**Stop here and look at it.** If the answer is no, that is the cheapest
possible place to have learned it. Tune `alphaTest`, bloom threshold, or
regenerate the art before continuing.

> **Done, and since superseded.** All five characters now have real art and
> the placeholders are gone, so `first_art` and `cast_grounded` were replaced
> by `full_cast` and `boss_closeup`. The cast lives in `src/scene/cast.ts`.

---

# Phase 2 — Battle logic, no pixels

Pure functions and Vitest. No rendering, no DOM. A full battle should be
simulable in a test.

> Plan mode. Implement turn-based battle logic in `src/battle/`. No UI, no
> three.js, no DOM — this phase must be fully testable with Vitest.
>
> Build on the existing `types.ts` and `damage.ts`. Add:
>
> - `turnOrder.ts` — a discrete turn queue. Everyone acts once per round in
>   descending speed order; ties broken deterministically by actor id so the
>   order never depends on array insertion. Expose `buildRound(actors)` and a
>   `previewUpcoming(state, n)` for the turn-order bar.
> - `status.ts` — apply, tick, and expire `ATK_UP`, `DEF_UP`, `HASTE`.
>   Durations decrement at the end of the bearer's turn. Define stacking rules
>   explicitly and document them.
> - `actions.ts` — `takeAction(state, action, rng)` returning a new state plus
>   a list of resolved events (`damage`, `heal`, `statusApplied`, `defeated`,
>   `battleEnded`). Actions: attack, skill (MP cost), defend. Reject invalid
>   actions with a clear error rather than silently no-oping.
> - `battle.ts` — `createBattle(seed, actors)`, `advance(state)`, victory and
>   defeat detection.
>
> All state transitions must be pure: take state, return new state. No
> mutation in place. All randomness through `createRng` from `src/rng.ts`.
>
> Write tests first for each module, then implement. Include a test that
> simulates a complete battle end to end at a fixed seed and asserts the boss
> is defeated and the round count is what you expect.
>
> Follow the constraint pattern in `spriteLayout.ts`: if a rule can be violated
> by a caller, enforce it in the function rather than documenting it.
>
> Run `npm run test` until green.

---

# Phase 3 — Playable spike

Ugly on purpose. The goal is one complete turn you can actually play.

> Wire the Phase 2 battle logic to the existing DOM HUD so I can play one
> complete turn. Deliberately unstyled — I am testing whether it works, not
> how it looks.
>
> In `src/ui/hud.ts`, extend the existing render function to show: turn order
> preview, every actor's HP and MP as text, and the command menu driven by
> real state. Keyboard input: arrow keys move the cursor, Enter confirms,
> Escape backs out.
>
> Add `src/battle/sequencer.ts` — an explicit queue of awaited steps, not
> nested `setTimeout`. A player action plays out as: lock input, show
> narration, pause, resolve damage, update HP, pause, check for defeat, advance
> turn, unlock input. Input must be locked for the whole sequence — mashing
> Enter must not queue three attacks. Expose `isLocked` in `__debugState`.
>
> Every interactive element needs a `data-testid`. These are a contract with
> the test suite.
>
> Add Playwright tests to `e2e/`: selecting ATTACK reduces boss HP by exactly
> the amount in the event log; pressing Enter three times rapidly produces
> exactly one action; the battle reaches a victory state.
>
> Do not touch `src/scene/`. Do not add styling.
>
> Run `npm run test` and `npm run e2e` until green.

**Play it.** This is the go/no-go on whether the combat is worth building out.

---

# Phase 4 — Cast and boss

Generate the remaining four party members and the boss, all in one sitting,
same prompt skeleton with only the character block changed.

The boss is the hardest asset. Budget more attempts for it, and consider
generating it larger (it should be roughly twice the party's world height).

> Replace all placeholder sprites with real art from `public/characters/`, and
> add the boss.
>
> The boss stands on the right side of the platform facing the party, at
> roughly twice the party's world height. Add a `layoutBoss()` to
> `spriteLayout.ts` that returns its position, and unit-test that it stays
> inside `PLATFORM_SAFE_RADIUS` and projects to the right half of frame at
> `CANONICAL_ASPECT` — same guards as `layoutParty`.
>
> Boss sprites are large enough that `alphaTest` may need tuning separately
> from the party. Make it configurable per cast entry (it already is) and set
> a value that works.
>
> Add shots `full_cast` and `boss_closeup`.
>
> Run `npm run test`, `npm run e2e`, then `npm run shots`. Read `full_cast.png`
> and tell me whether the five party members read as distinct silhouettes at
> this size, and whether the boss reads as threatening rather than just large.

---

# Phase 5 — The real HUD

This is where it starts looking like your reference image. Most of the work is
CSS and DOM, which is the part Claude is best at and the part with the
strongest verification channel.

Split into three prompts — one per region — rather than one large one.

> Build the party status cards along the bottom of the HUD, matching the
> reference image layout: portrait, name, level, HP bar with numbers, MP bar
> with numbers, and status effect icons.
>
> Use the design tokens in `src/style.css`. The palette is sampled from the
> SideQuest Cyber site — do not introduce new colours. Cyan is a thin line
> accent only, never a fill.
>
> Cards must use tabular numerals so HP counters do not jitter as digits change
> width. Bars animate width over 400 ms, and must respect
> `prefers-reduced-motion`.
>
> Every card needs `data-testid="party-card-<actorId>"` and its bars need
> `role="progressbar"` with accurate `aria-valuenow` and `aria-valuemax` — the
> test suite reads those rather than parsing styles.
>
> Add Playwright tests asserting card count, and that a card's `aria-valuenow`
> matches the actor's HP in `__debugState` after an action resolves.
>
> Do not touch `src/scene/` or `src/battle/`.

Then the turn-order bar, then the command menu with submenus and target
selection. Same shape each time.

Damage numbers are the one piece that spans both layers:

> Add floating damage numbers. Use `sprite.headScreenPosition(camera)` to
> project the target's head to normalised screen coordinates, then position a
> DOM element there as a percentage — crisp text, CSS animation, still readable
> in the DOM.
>
> Numbers rise and fade over 900 ms. Criticals are larger and use the ember
> colour. Add the chain counter from the reference image.
>
> Elements need `data-testid="damage-number"` and must carry their value in
> `textContent` so tests can assert it. Remove them from the DOM after their
> animation ends — do not accumulate orphans.

---

# Phase 6 — Juice

Hit-stop, screen shake, hit flash, particle bursts on impact, audio. Last,
because it is the most likely to perturb the deterministic screenshot baseline
and you want that baseline trustworthy while the mechanics are still moving.

One prompt per effect. These are cheap and individually low-risk.

---

# Phase 7 — Ship

The mobile question, deferred since Phase 0, comes due here.

> The composition is authored for 16:9 and the party clips at narrower
> aspects. Make the game work in portrait on a phone.
>
> Options to evaluate before implementing: reduce the camera fov on narrow
> aspects; use a horizontal fov instead of vertical; or reflow the HUD to a
> vertical stack and accept a tighter formation. Recommend one with reasoning
> before writing code.
>
> Whatever you choose, the existing 16:9 tests must still pass and the platform
> and frustum guards in `spriteLayout.test.ts` must be extended to cover the
> new aspect.

---

# Writing prompts that land first time

## The template

```
[Plan mode if the architecture is open]

GOAL      one sentence, one slice
FILES     create X, modify Y, do not touch Z
CONSTRAINTS  the numbers and rules that are not obvious from the code
ACCEPTANCE   assertions, not adjectives
VERIFY    run <command>, fix failures, repeat until green
```

## Six things that actually reduce iterations

**1. Put the verification command in the prompt.** "Run `npm run test` and fix
failures until green" converts one exchange into a loop Claude closes by
itself. This is the single highest-leverage line you can add.

**2. State acceptance as assertions, not adjectives.** "Make the HP bar look
good" invites an opinion. "`aria-valuenow` must equal the actor's HP in
`__debugState` after the action resolves" is checkable. Adjectives are for the
screenshot phase; everywhere else, name the assertion.

**3. Give constraints, not just goals.** The CI failure happened because the
sprite prompt said "put five characters on the platform" and never said the
platform has radius 6. Claude cannot infer a number that exists only in a
`CylinderGeometry` call three files away. Any bound, limit, or magic number
that matters goes in the prompt.

**4. Say what not to touch.** Scope creep is the main failure mode when every
edit is a reviewable diff — you approve twelve good diffs and one that quietly
changed the camera. An explicit "do not touch `src/scene/`" costs one line.

**5. Name the file paths.** Otherwise Claude picks, and it picks differently
each session. "Put this in `src/battle/turnOrder.ts`" keeps the tree
predictable and keeps future prompts able to reference it.

**6. For visual work, ask it to look and report.** Claude can read the PNGs
`npm run shots` produces. "Run `npm run shots`, read `bloom_on.png`, and tell
me what changed" gets you an actual observation instead of an assumption that
the code worked.

## Anti-patterns

| Don't | Why |
|---|---|
| "Build the battle system" | Too large. One slice per prompt or the diff becomes unreviewable. |
| "Make it look better" | No acceptance criterion. Claude will guess and you will iterate. |
| Repeating `CLAUDE.md` in the prompt | Wastes context and the two drift apart. Reference it. |
| Deciding architecture in normal mode | Use plan mode. Reversing a committed structure costs far more than reading a plan. |
| Asking for tests after the code | For pure logic, tests first is faster — it forces the interface to be stated before it is implemented. |

## When the first output is wrong

Do not re-prompt from scratch. Correct with the *specific missing constraint*:

> The formation puts a sprite at x=-6.1, which is off the platform. Platform
> top radius is 6, usable radius 5.2. Fix and add a unit test that would have
> caught this.

That last clause matters. It converts a one-time correction into a permanent
guard.

**And the rule that compounds: any correction you make twice belongs in
`CLAUDE.md`.** That file is not documentation — it is an accumulating record
of constraints this project has learned the hard way. Every entry currently in
its "Known traps" section came from something that actually broke. It should
keep growing.

## Where each verification channel belongs

The CI failure was a clean demonstration: an assertion that is pure arithmetic
was being checked by an end-to-end test, so a five-minute round trip taught
something a 38 ms unit test could have. When you write a prompt, name the
channel:

| Kind of claim | Channel | Feedback |
|---|---|---|
| Numbers, bounds, formulas, state transitions | Vitest | ~40 ms |
| Interface behaviour, exact values on screen | Playwright DOM | ~5 s |
| Does it look right | `npm run shots` + read the PNG | ~10 s + judgement |

If a claim can be checked by a faster channel than the one you reached for,
use the faster one. Screenshots are for questions that genuinely need eyes,
and nothing else.
