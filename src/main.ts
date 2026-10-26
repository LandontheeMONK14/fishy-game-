import './style.css';
import { Game } from './simulation';
import { createSave, exportSave, importSave, loadSave, persistSave } from './persistence';
import { LakeScene } from './scene';
import { GameUI } from './ui';
import { GameInput } from './input';
import { LakeAudio } from './audio';
import type { Lure, Quality, SpeciesId } from './contracts';

const app = document.querySelector<HTMLDivElement>('#app')!;
const viewport = document.createElement('div');
viewport.id = 'viewport';
viewport.tabIndex = -1;
viewport.setAttribute('aria-label', 'Three-dimensional Stillwater lake. Drag to look; tap water to steer.');
const overlay = document.createElement('div');
overlay.id = 'interface';
app.append(viewport, overlay);
const loaded = loadSave();
let game = new Game(loaded.save);
let scene: LakeScene | null = null;
let input: GameInput | null = null;
let manualPause = false;
let contextLost = false;
let blurred = false;
let stopped = false;
let frame = 0;
let previousTime = performance.now();
let saveTimer = 0;
let storageWarned = false;
let canPersist = loaded.canPersist;
const audio = new LakeAudio();

function syncPause() {
  const paused = manualPause || document.hidden || blurred || contextLost || ui.isModalOpen();
  game.setPaused(paused);
  if (paused) input?.clear();
  previousTime = performance.now();
  void audio.configure(game.save.settings, paused);
}

function save() {
  if (!canPersist) return;
  if (!persistSave(game.save) && !storageWarned) {
    storageWarned = true;
    ui.setStatus('Browser storage unavailable. Export your save from Settings before leaving.');
  }
}

function focusPlay() {
  if (!ui.isModalOpen()) viewport.focus({ preventScroll: true });
}

const ui = new GameUI(overlay, {
  onModal: () => syncPause(),
  onAction: (action, value) => {
    switch (action) {
      case 'start': case 'resume': manualPause = false; ui.closeMenu(); syncPause(); break;
      case 'pause': manualPause = true; ui.openMenu('settings'); syncPause(); break;
      case 'menu': ui.openMenu(value); break;
      case 'keep': game.resolveCatch(true); input?.clear(); break;
      case 'release': game.resolveCatch(false); input?.clear(); break;
      case 'retrieve': game.action(); input?.clear(); break;
      case 'interact': input?.clear(); game.interact(); break;
      case 'shop':
        if (game.canShop()) ui.openMenu('Tackle');
        else ui.setStatus('Walk to the tackle rack on the dock to shop.');
        break;
      case 'buyRod': game.buyTackle('rod', value!); break;
      case 'buyLure': game.buyTackle('lure', value!); break;
      case 'equipRod': game.equipTackle('rod', value!); break;
      case 'equipLure': game.equipTackle('lure', value!); break;
      case 'lure': game.setLure(value as Lure); break;
      case 'sell': game.sell(value === 'all' ? undefined : value as SpeciesId); break;
      case 'upgrade': game.upgrade(value as 'rod' | 'line'); break;
      case 'acceptQuest': game.acceptQuest(value!); break;
      case 'claimQuest': game.claimQuest(value!); break;
      case 'paint':
        if (!game.equipPaint(value!) && game.buyPaint(value!)) game.equipPaint(value!);
        break;
      case 'name': game.save.name = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Driftwood'; break;
      case 'quality': game.save.settings.quality = value as Quality; scene?.setQuality(value as Quality); break;
      case 'assist': game.save.settings.assist = value === 'true'; break;
      case 'reducedMotion': game.save.settings.reducedMotion = value === 'true'; break;
      case 'muted': game.save.settings.muted = value === 'true'; break;
      case 'volume': game.save.settings.volume = Math.max(0, Math.min(1, Number(value) || 0)); break;
      case 'camera': scene?.resetCamera(); break;
      case 'dock':
        if (game.snapshot.phase === 'aim') { input?.clear(); game.returnToDock(); scene?.resetCamera(); }
        else ui.setStatus('Finish or retrieve your cast before returning to the dock.');
        break;
      case 'export': {
        const url = URL.createObjectURL(new Blob([exportSave(game.save)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'stillwater-save.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        ui.setStatus('Save exported. Keep the downloaded JSON file for backup.');
        break;
      }
      case 'import': {
        const imported = importSave(value ?? '');
        if (!imported) { ui.setStatus('Invalid save. Your current progress is unchanged.'); break; }
        if (!window.confirm('Replace current progress with this imported save?')) break;
        input?.clear(); game = new Game(imported);
        canPersist = true;
        scene?.setQuality(game.save.settings.quality);
        ui.setStatus('Save imported.'); break;
      }
      case 'reset':
        if (window.confirm('Permanently reset Stillwater progress? Export a backup first. Older golden-hour saves will not be touched.')) {
          input?.clear();
          game = new Game(createSave());
          canPersist = true;
          scene?.setQuality(game.save.settings.quality);
          ui.setStatus('New fishing journal started.');
        }
        break;
    }
    save();
    syncPause();
    ui.update(game.snapshot, game.save);
    if (['start', 'resume', 'keep', 'release', 'retrieve', 'interact', 'dock', 'camera'].includes(action)) focusPlay();
  },
});

// Initialization occurs after the UI exists so renderer failures always have an accessible fallback.
async function boot() {
  try {
    ui.setStatus('Preparing the lake…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (stopped) return;
    scene = new LakeScene(viewport, () => {
      contextLost = true; syncPause();
      ui.setStatus('Graphics context lost. The game is paused; waiting for your browser to restore it.');
    }, () => {
      contextLost = false; manualPause = true; syncPause();
      ui.openMenu('settings');
      ui.setStatus('Graphics restored. Close the menu to continue.');
    });
    scene.setQuality(game.save.settings.quality);
    input = new GameInput(scene.canvas, {
      charge: () => game.startCharge(),
      release: () => game.releaseCast(),
      action: () => game.action(),
      cancel: () => game.cancelInput(),
      orbit: (yaw, pitch) => scene?.orbit(yaw, pitch),
      aim: (yaw) => game.aim(yaw),
      course: (point) => game.setCourse(point),
      pick: (x, y) => scene?.pickWater(x, y) ?? null,
      pause: () => {
        if (ui.isModalOpen()) { manualPause = false; ui.closeMenu(); }
        else { manualPause = true; ui.openMenu('settings'); }
        syncPause();
      },
      camera: () => scene?.resetCamera(),
      interact: () => { game.interact(); save(); },
      intent: () => game.beginInput(),
      phase: () => game.snapshot.phase,
      blocked: () => game.snapshot.paused || ui.isModalOpen(),
    });
    ui.setStatus(loaded.warning || 'Your free starter rod and spinner are ready. Walk toward the boat and use E / Board.');
    syncPause();
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  } catch (error) {
    ui.showError(`The lake could not start. ${error instanceof Error ? error.message : String(error)} Try enabling hardware acceleration or another WebGL 2 browser, then reload.`);
  }
}

function tick(now: number) {
  if (stopped) return;
  const dt = Math.min(.05, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  try {
    const phase = game.snapshot.phase;
    game.update(dt, input!.controls);
    if (game.snapshot.phase !== phase) {
      if (['bite', 'fight', 'land', 'aim'].includes(game.snapshot.phase)) input?.clear();
      save();
    }
    scene!.update(game.snapshot, game.save, game.snapshot.paused ? 0 : dt);
    ui.update(game.snapshot, game.save);
    audio.update(game.snapshot);
    saveTimer += dt;
    if (saveTimer > 10) { save(); saveTimer = 0; }
    frame = requestAnimationFrame(tick);
  } catch (error) {
    input?.clear(); game.setPaused(true);
    ui.showError(`Play stopped safely: ${error instanceof Error ? error.message : String(error)}. Reload to restore your last saved progress.`);
  }
}

const lifetime = new AbortController();
window.addEventListener('resize', () => scene?.resize(), { signal: lifetime.signal });
window.addEventListener('blur', () => { blurred = true; syncPause(); }, { signal: lifetime.signal });
window.addEventListener('focus', () => { blurred = false; syncPause(); }, { signal: lifetime.signal });
document.addEventListener('visibilitychange', syncPause, { signal: lifetime.signal });
window.addEventListener('pagehide', (event) => {
  save();
  if (event.persisted) { blurred = true; syncPause(); return; }
  stopped = true; cancelAnimationFrame(frame); input?.dispose(); scene?.dispose(); audio.dispose(); ui.dispose(); lifetime.abort();
}, { signal: lifetime.signal });
window.addEventListener('pageshow', () => { blurred = false; syncPause(); }, { signal: lifetime.signal });
void boot();
