# Stillwater

A self-contained, fishing-first 3D browser escape: a golden-hour wilderness lake,
a small wooden boat, and a journal waiting to be filled. Original procedural art,
animated water, rod-focused casting, fish runs and a legendary northern catch.
Explore six connected regions in an expanded naturalistic-stylized wilderness.
This is a browser fishing game, not a photorealistic or AAA-scale world.

## Play locally

Install **Node.js 22.12+** (Node 22 LTS recommended), then:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No accounts, API keys, backend, or downloaded
art packs are needed. Dependency installation needs npm access; gameplay does not
use remote services.

```sh
npm run build     # TypeScript check and optimized production build
npm run preview   # serve dist locally; do not open index.html via file://
npm run typecheck
npm test
```

Vite uses relative production asset paths so `dist/` can be served under a
repository subpath. A static web server is required. No deployment or repository
settings are enabled by this project.

## A quiet first cast

1. Start on the walkable dock with a **free Willow rod and Copper spinner**
   already equipped. W/S or the touch arrows walk along the dock; A/D moves
   sideways within its rails. Walk toward the boat at the dock tip and use
   **E / Interact** to board. On deck, walk forward and interact to take the helm;
   interact again to leave it. Fish from the stationary deck, not the helm.
   Drag the view to aim; hold **Space / Cast** to charge,
   release to cast. Aim into the nearby **Emerald pool** surface rings with a
   spinner. A gold precision target means the habitat and lure match: faster
   bites and a size bonus. Ordinary legal-water casts still catch fish.
2. Watch the float. Nibbles are not bites: wait for the **set hook** prompt and
   press Space / Hook within the bite window.
3. Hold Space / Reel during rests and the **building** tell. The countdown warns
   before a run or leap: release Reel or use **R / Give line** when it starts;
   watch tension, stamina and distance. A/D steer in the indicated fish direction.
   Assist is enabled initially and can be changed in Settings.
4. Inspect your catch, then explicitly **keep** or **release** it. Keeping fills
   a finite hold; release builds stewardship progress rather than giving cash.
5. Return to the dock, leave the helm and walk aft to disembark. Walk to the
   visible tackle rack for rods, lures and upgrades; sell retained catches at
   the dock. The journal, map, accepted quests and settings remain available
   while exploring. Selling never erases records.

**Explore:** W / ↑ gently accelerates forward and S / ↓ reverses; A/D and ←/→ turn
the helm at a bounded rate. Boat travel follows its heading, independently of cast
aim, and coasts to a controlled stop when you release the controls. Tap/click legal
water to set a course; the boat turns and slows as it approaches, and land blocks
travel. Drag to aim and look, **C** smoothly recenters the camera. The camera keeps
a steady height and does not swing toward fish or catches; cosmetic boat bob is
disabled by reduced motion. Aiming does not steer the helm. Touch controls provide
movement, casting, reeling and line release without needing simultaneous finger
holds. Leaving the helm stops the boat; casting requires a stationary fishing
position. Use the dock shortcut after
retrieving/finishing your cast for safe recovery; it does not replace physical
boarding/disembarking. Deck and dock movement is constrained to safe walking areas;
this is not unrestricted swimming or island walking.

**Comfort:** camera translation follows a flat anchor, not cosmetic hull bob/roll.
Manual orbit and reset are smoothed; there is no automatic fish-follow, camera shake
or motion blur. Pause/resume stops residual travel, and long frame gaps do not
fast-forward navigation. Comfort varies by person; reduced motion and low quality
are available, and you should stop playing if the motion feels uncomfortable.

### Tackle and exploration

The dock rack sells the Wayfarer rod (140 coins) and Crownwater rod (320 coins).
Their maximum cast ranges are 48 m and 58 m versus the Willow's 38 m; they also
improve fight power and line control. Existing rod/reel and line upgrades still
contribute independently. The spinner is free; the Silver fly costs 45 coins and
the Golden minnow 75. Owned equipment can be re-equipped without paying again;
buying requires visiting the rack. Lure preferences affect species encounters and
precision bonuses, not just appearance. Equipped tackle is rendered on the boat.

The navigable ellipse is now 510 × 360 world units (nine times the previous water
footprint before subtracting islands), with seven islands, six discoverable regions
and ten feeding grounds. The Map tab shows shorelines, islands, home dock, boat
and destinations with distances. Explore Willow wetlands, Glasswater coast,
Frostmere reach, Crown basin and Sunken orchard beyond the home waters.
Discoveries persist; the four-species journal still gates the Gilded King.
Travel and casts share deterministic land boundaries; direct tap courses cannot
route around islands automatically. Choose clear-water waypoints instead.

**Pause:** Escape opens/closes the menu. Menus, window blur and a hidden tab freeze
fishing timers. Buttons and dialogs are keyboard accessible; game shortcuts are
ignored while using form controls. Settings include quality, reduced motion,
assisted fights, and opt-in sound with volume.

### Read the water, build a fishing story

Ten named feeding grounds have surface rings, baitfish activity and lure hints.
Emerald pool and Sunset reeds favor spinners; Silverfin spring favors flies;
Northern channel and the Gilded crown favor minnows. The journal lists grounds,
discovery goals, records and mastery progress. Perch have gentle short runs, bass
burst and leap, trout favor acrobatics, and pike make longer surges. Every attack
has a safe building tell; keep reeling during the tell, then ease when it ends.

Size is relative to each species: **Trophy** begins at 1.25× its reference weight,
**Legendary** at 1.6×. Precision casts add 0.25× reference weight. Trophy/Legendary
catches earn 35%/80% extra market value; personal bests add a further 15%.
Existing inventory retains its original sale values. Both keep and release
record discoveries and personal bests exactly once. Each catch earns one mastery
point; release earns another. Every five points grants a rank, up to five ranks,
each adding 3% passive fight power. Release also retains its slack-tolerance benefit.

Discover the four ordinary species to unlock the Gilded King; use a minnow in the
far northern water. The journal shows every prerequisite. Its crown-shaped fins,
golden feeding ground and restrained encounter framing distinguish the encounter.
The three phases move from long runs to direction-changing leaps to quick bursts;
each transition starts with recovery. Losing never spends the unlock or costs
coins, and base tackle can win with attentive line control. Landing reveals the
fish beside the boat while the catch card records its size and personal best.

## Saves and safety

Progress and settings use a validated, versioned `stillwater-v2` localStorage
save. Storage failures leave the session playable and display a warning: export
your save in Settings before leaving. Export/import uses JSON; import is validated
and requires confirmation before replacing progress. Reset also requires confirmation.
In-progress casts/fights are not saved; a reload returns to the dock. This upgrade
extends version 2 with validated owned/equipped tackle and regional discoveries.
Earlier `stillwater-v2` exports remain importable: they receive a starter rod and
all three previously available lures without charging coins. Inventory sale values,
upgrades, coins, journal, quests and settings are preserved. Mastery and size tiers
remain derived from existing fields. Unknown fields and malformed progress are
rejected rather than trusted.
If stored data is invalid, it is left untouched and autosaving is blocked.
Export the playable session or explicitly confirm an import/reset before replacing
the stored data; the warning is not permission to discard it.

The previous chat demo's `golden-hour-3d-v1` save is **not migrated or deleted**.
Its schema and rewards cannot be reliably reconciled with this game. Back up that
key separately if you have used the older demo. New progress starts independently.
Browser storage is local to the origin/browser, not cloud-synced.

## Implementation

- `src/simulation.ts`: deterministic fishing, boat/cast legality and transactions.
- `src/persistence.ts`: bounded save validation and storage boundary.
- `src/scene.ts`: Three.js scene, procedural models, water and effects.
- `src/input.ts`, `src/audio.ts`: cancellable input and optional synthesized sound.
- `src/ui.ts`, `src/style.css`: accessible HTML interface and responsive layout.
- `src/main.ts`: lifecycle, pause reasons, rendering and persistence integration.
- `tests/`: deterministic simulation and persistence regression coverage.

All art is original procedural work; see [ASSET-CREDITS.txt](ASSET-CREDITS.txt).
The original [Apache-2.0 license](LICENSE) is preserved.

## Scope and limitations

WebGL 2 and a modern browser are required. If graphics initialization fails, an
HTML error replaces a blank canvas; context loss pauses play. Quality settings
reduce resolution, shadows and effects, but performance depends on your device.
Layered ridgelines, procedural clouds, shoreline detail, feeding-ground activity,
water highlights and wakes build an AAA-inspired art direction, not AAA asset
fidelity. Water uses stylized reflection cues, not physically traced reflections. Boat
navigation uses collision-safe direct steering rather than automatic pathfinding.
Regional scenery uses shared instanced vegetation and rocks, distance-culling and
quality-scaled detail. Walking is limited to the dock and boat deck; there is no
land-exploration RPG, multiplayer, backend, or licensed realism assets. The species
roster remains four ordinary fish and the unlockable King. Audio is synthesized
ambient water/wind and fishing feedback.

Validation results and any environment-specific limits are recorded in the pull
request; no frame-rate or universal device-compatibility claims are made.