# Stillwater

A self-contained, fishing-first 3D browser escape: a golden-hour wilderness lake,
a small wooden boat, and a journal waiting to be filled. Original procedural art,
animated water, rod-focused casting, fish runs and a legendary northern catch.
This is a compact naturalistic-stylized vertical slice, not a photorealistic or
AAA-scale game.

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

1. Start at the dock. Drag the view to aim; hold **Space / Cast** to charge,
   release to cast. The target preview indicates legal water.
2. Watch the float. Nibbles are not bites: wait for the **set hook** prompt and
   press Space / Hook within the bite window.
3. Hold Space / Reel during rests. Release it or use **R / Give line** during
   surges; watch tension, stamina and distance. A/D steer the rod during a fight.
   Assist is enabled initially and can be changed in Settings.
4. Inspect your catch, then explicitly **keep** or **release** it. Keeping fills
   a finite hold; release builds stewardship progress rather than giving cash.
5. Visit the dock menu for the market, accepted fishing quests, tackle upgrades,
   owned boat colors, boat name, journal and settings. Selling never erases records.

**Explore:** WASD / arrow keys move the boat relative to your aim. Tap/click water
to set a straight course; land blocks travel, so steer around obstacles. Drag to
look, **C** to reset the camera. Touch controls provide movement, casting, reeling
and line release without needing simultaneous finger holds. Fishing stops travel.
Use the dock shortcut after retrieving/finishing your cast to skip the return trip.

**Pause:** Escape opens/closes the menu. Menus, window blur and a hidden tab freeze
fishing timers. Buttons and dialogs are keyboard accessible; game shortcuts are
ignored while using form controls. Settings include quality, reduced motion,
assisted fights, and opt-in sound with volume.

Different water and lures attract different species. The journal provides habitat
hints. Discover the four ordinary species to unlock the Gilded King; use a minnow
in the far northern water. Its three-stage fight is retryable without spending
the unlock. Give line during surges and gain distance during recovery.

## Saves and safety

Progress and settings use a validated, versioned `stillwater-v2` localStorage
save. Storage failures leave the session playable and display a warning: export
your save in Settings before leaving. Export/import uses JSON; import is validated
and requires confirmation before replacing progress. Reset also requires confirmation.
In-progress casts/fights are not saved; a reload returns to the dock.

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
Water uses stylized reflection cues, not physically traced reflections. Boat
navigation uses collision-safe direct steering rather than automatic pathfinding.
There is one biome, no walking RPG, multiplayer, backend, or licensed realism
assets. Audio is synthesized ambient water/wind and fishing feedback.

Validation results and any environment-specific limits are recorded in the pull
request; no frame-rate or universal device-compatibility claims are made.