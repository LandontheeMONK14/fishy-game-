import { SPECIES } from './contracts';
import type { Save, Snapshot } from './contracts';
import { QUESTS, UPGRADE_COSTS, bossUnlocked, questProgress } from './simulation';

export interface UICallbacks {
  onAction(action: string, value?: string): void;
  onModal(open: boolean): void;
}

type Modal = 'welcome' | 'menu' | 'catch' | 'error' | null;
const TABS = ['Market', 'Tackle', 'Journal', 'Quests', 'Settings'];
const HINTS: Record<Snapshot['phase'], string> = {
  aim: 'Find your water. Hold Space to charge a cast.',
  charge: 'Release Space to cast.',
  cast: 'A small moment, suspended.',
  wait: 'Watch the float. Wait for a bite.',
  bite: 'A bite! Press Space to hook.',
  fight: 'Hold Space to reel · R to give line · A / D to steer',
  land: 'A story for the journal.',
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(label: string, action: string, value?: string, className = ''): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  element.dataset.action = action;
  if (value !== undefined) element.dataset.value = value;
  return element;
}

export class GameUI {
  private readonly abort = new AbortController();
  private readonly header: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly message: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly location: HTMLElement;
  private readonly journalCount: HTMLElement;
  private readonly meters: HTMLElement;
  private readonly touch: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly actionButton: HTMLButtonElement;
  private modal: Modal = null;
  private tab = 'Market';
  private snapshot?: Snapshot;
  private save?: Save;
  private fingerprint = '';
  private catchId = -1;
  private returnFocus: HTMLElement | null = null;
  private wasPaused = false;
  private ready = true;
  private disposed = false;
  private initializing = true;

  constructor(private readonly root: HTMLElement, private readonly callbacks: UICallbacks) {
    root.classList.add('game-ui');
    root.innerHTML = `
      <header class="lake-header">
        <div class="lake-identity"><span class="wordmark">STILLWATER</span><span class="location"></span></div>
        <nav class="lake-toolbar" aria-label="Lake tools">
          <span class="coin-count" data-testid="coins" aria-label="Coins">0</span>
          <button type="button" class="journal-shortcut" data-action="tab" data-value="Journal" aria-label="Open journal"><span aria-hidden="true">▤</span> <span class="journal-count">0 / 4</span></button>
          <button type="button" data-action="dock">Dock <span aria-hidden="true">↗</span></button>
          <button type="button" data-action="pause" class="pause-button" aria-label="Pause game">Ⅱ</button>
          <button type="button" data-action="menu" data-testid="menu" aria-label="Open dock menu">☰</button>
        </nav>
      </header>
      <div class="lake-pause" hidden>PAUSED <span>Escape to return to the water</span></div>
      <section class="fishing-hud" aria-label="Fishing status">
        <div class="phase-label" data-testid="phase"></div>
        <div class="fishing-message" role="status" aria-live="polite"></div>
        <div class="fishing-meters" hidden>
          <div class="meter-item" data-meter="charge" hidden><label for="cast-charge">CAST POWER</label><progress id="cast-charge" max="1" value="0"></progress></div>
          <div class="meter-item" data-meter="bite" hidden><label for="bite-window">HOOK NOW</label><progress id="bite-window" max="1" value="0"></progress></div>
          <div class="meter-item" data-meter="tension" hidden><label for="line-tension">LINE TENSION <span class="tension-word"></span></label><progress id="line-tension" max="1" value="0"></progress></div>
          <div class="meter-item" data-meter="stamina" hidden><label for="fish-stamina">FISH STAMINA</label><progress id="fish-stamina" max="1" value="0"></progress></div>
        </div>
        <p class="context-hint"></p>
        <button type="button" class="retrieve-button" data-action="retrieve" hidden>Retrieve lure</button>
      </section>
      <div class="touch-controls" aria-label="Touch controls">
        <div class="steering-pad" role="group" aria-label="Move and steer">
          <button type="button" data-control="forward" aria-label="Move forward">↑</button>
          <button type="button" data-control="left" aria-label="Steer left">←</button>
          <button type="button" data-control="back" aria-label="Move backward">↓</button>
          <button type="button" data-control="right" aria-label="Steer right">→</button>
        </div>
        <div class="touch-actions"><button type="button" data-control="slack" class="slack-control" hidden>Give line</button><button type="button" data-control="action" class="cast-control">Cast</button></div>
      </div>
      <div class="lake-corner-note">A LITTLE PATIENCE GOES A LONG WAY</div>
      <div class="lake-notice" role="status" hidden></div>
      <div class="modal-overlay" hidden><section class="lake-dialog" role="dialog" aria-modal="true" tabindex="-1"><div class="dialog-body"></div></section></div>`;
    this.header = root.querySelector('.lake-header')!;
    this.overlay = root.querySelector('.modal-overlay')!;
    this.panel = root.querySelector('.lake-dialog')!;
    this.body = root.querySelector('.dialog-body')!;
    this.hint = root.querySelector('.context-hint')!;
    this.message = root.querySelector('.fishing-message')!;
    this.phase = root.querySelector('.phase-label')!;
    this.coins = root.querySelector('.coin-count')!;
    this.location = root.querySelector('.location')!;
    this.journalCount = root.querySelector('.journal-count')!;
    this.meters = root.querySelector('.fishing-meters')!;
    this.touch = root.querySelector('.touch-controls')!;
    this.pauseButton = root.querySelector('.pause-button')!;
    this.actionButton = root.querySelector('[data-control="action"]')!;
    const options = { signal: this.abort.signal };
    root.addEventListener('click', this.onClick, options);
    root.addEventListener('change', this.onChange, options);
    document.addEventListener('keydown', this.onKeyDown, { ...options, capture: true });
    document.addEventListener('keyup', this.onKeyUp, { ...options, capture: true });
    document.addEventListener('focusin', this.onFocus, options);
    this.showWelcome();
    this.initializing = false;
  }

  update(snapshot: Snapshot, save: Save): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.save = save;
    this.text(this.coins, `${save.coins.toLocaleString()} ◈`);
    this.text(this.location, snapshot.habitat || 'Stillwater Lake');
    this.text(this.journalCount, `${SPECIES.filter(s => s.id !== 'king' && save.journal[s.id]).length} / 4`);
    this.text(this.phase, snapshot.phase === 'fight' ? `${snapshot.behavior === 'run' ? 'THE RUN' : snapshot.behavior === 'jump' ? 'THE LEAP' : 'THE FIGHT'} · ${snapshot.distance.toFixed(1)} m` : snapshot.phase === 'aim' ? 'THE QUIET WATER' : snapshot.phase.toUpperCase());
    this.text(this.hint, HINTS[snapshot.phase]);
    this.text(this.message, snapshot.message);
    const fight = snapshot.phase === 'fight';
    this.meters.hidden = !fight && snapshot.phase !== 'charge' && snapshot.phase !== 'bite';
    this.meter('charge', snapshot.phase === 'charge', snapshot.charge);
    this.meter('bite', snapshot.phase === 'bite', Math.min(1, snapshot.biteRemaining / 2.5));
    this.meter('tension', fight, snapshot.tension);
    this.meter('stamina', fight, snapshot.stamina);
    this.meters.classList.toggle('danger', snapshot.tension > .76);
    this.text(this.root.querySelector('.tension-word')!, snapshot.tension > .76 ? 'GIVE LINE' : 'STEADY');
    this.text(this.actionButton, fight ? 'Reel' : snapshot.phase === 'bite' ? 'Hook!' : snapshot.phase === 'charge' ? 'Charging…' : 'Cast');
    this.actionButton.disabled = !['aim', 'charge', 'bite', 'fight'].includes(snapshot.phase);
    (this.root.querySelector('.retrieve-button') as HTMLElement).hidden = snapshot.phase !== 'cast' && snapshot.phase !== 'wait';
    (this.root.querySelector('[data-control="slack"]') as HTMLElement).hidden = !fight;
    this.touch.classList.toggle('is-fighting', fight);
    (this.root.querySelector('.lake-pause') as HTMLElement).hidden = !snapshot.paused || this.modal !== null;
    if (snapshot.paused !== this.wasPaused) {
      this.wasPaused = snapshot.paused;
      this.pauseButton.dataset.action = snapshot.paused ? 'resume' : 'pause';
      this.pauseButton.setAttribute('aria-label', snapshot.paused ? 'Resume game' : 'Pause game');
      this.pauseButton.textContent = snapshot.paused ? '▷' : 'Ⅱ';
    }
    if (snapshot.phase === 'land' && snapshot.catch && snapshot.catch.id !== this.catchId && this.modal !== 'welcome' && this.modal !== 'error') {
      this.catchId = snapshot.catch.id;
      this.showCatch();
    } else if (snapshot.phase !== 'land') {
      this.catchId = -1;
      if (this.modal === 'catch') this.hideModal();
    }
    this.root.classList.toggle('reduce-motion', save.settings.reducedMotion);
    if (this.modal === 'menu') {
      const fingerprint = JSON.stringify(save);
      if (fingerprint !== this.fingerprint) {
        this.fingerprint = fingerprint;
        this.refreshMenu();
      }
    }
  }

  setStatus(text: string): void {
    this.ready = !/^(preparing|loading)\b/i.test(text.trim());
    const status = this.root.querySelector('.loading-status');
    if (status) this.text(status, text || 'Your quiet corner of the world.');
    const notice = this.root.querySelector<HTMLElement>('.lake-notice')!;
    notice.hidden = !text || this.modal === 'welcome' || this.modal === 'menu' || this.modal === 'error';
    this.text(notice, text);
    const menuNotice = this.root.querySelector<HTMLElement>('.menu-notice');
    if (menuNotice) {
      menuNotice.hidden = !text;
      this.text(menuNotice, text);
    }
    const play = this.root.querySelector<HTMLButtonElement>('[data-action="start"]');
    if (play) {
      play.disabled = !this.ready;
      play.textContent = this.ready ? 'Play' : 'Preparing the lake…';
    }
    this.panel.setAttribute('aria-busy', String(!this.ready));
  }

  showError(message: string): void {
    this.beginModal('error', 'A ripple in the water');
    this.body.append(node('p', 'eyebrow', 'UNABLE TO LAUNCH'), node('h1', '', 'A ripple in the water'), node('p', 'error-message', message), node('p', 'muted-copy', 'Please reload the page to try again.'));
    this.focusModal();
  }

  // Catch decisions trap focus, but must not pause the land-phase simulation.
  isModalOpen(): boolean { return this.modal !== null && this.modal !== 'catch'; }

  openMenu(tab = 'Market'): void {
    if (this.modal === 'catch' || this.modal === 'error' || this.modal === 'welcome') return;
    this.tab = TABS.find(t => t.toLowerCase() === tab.toLowerCase()) || 'Market';
    this.beginModal('menu', 'The dock');
    const heading = node('div', 'dialog-heading');
    const title = node('div');
    title.append(node('p', 'eyebrow', 'A MOMENT ASHORE'), node('h1', '', 'The dock'));
    heading.append(title, button('×', 'close', undefined, 'close-button'));
    heading.lastElementChild!.setAttribute('aria-label', 'Return to the lake');
    const tabs = node('div', 'dock-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Dock');
    for (const name of TABS) {
      const item = button(name, 'tab', name);
      item.id = `dock-tab-${name.toLowerCase()}`;
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-controls', 'dock-content');
      item.setAttribute('aria-selected', String(name === this.tab));
      item.tabIndex = name === this.tab ? 0 : -1;
      tabs.append(item);
    }
    const content = node('div', 'dock-content');
    content.id = 'dock-content';
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', `dock-tab-${this.tab.toLowerCase()}`);
    const notice = node('p', 'menu-notice');
    notice.hidden = true;
    notice.setAttribute('role', 'status');
    this.body.append(heading, tabs, notice, content);
    this.buildTab(content);
    this.fingerprint = '';
    this.refreshMenu();
    this.focusModal();
  }

  closeMenu(): void {
    if (this.modal === 'menu') this.hideModal();
  }

  dispose(): void {
    this.abort.abort();
    if (this.modal === 'welcome' || this.modal === 'menu' || this.modal === 'error') this.callbacks.onModal(false);
    this.disposed = true;
    this.root.replaceChildren();
  }

  private text(element: Element, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }

  private meter(name: string, visible: boolean, value: number): void {
    const item = this.meters.querySelector<HTMLElement>(`[data-meter="${name}"]`)!;
    item.hidden = !visible;
    item.querySelector('progress')!.value = Math.max(0, Math.min(1, value));
  }

  private beginModal(modal: Modal, title: string): void {
    const oldBlocking = this.modal === 'welcome' || this.modal === 'menu' || this.modal === 'error';
    if (!this.modal) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modal = modal;
    this.overlay.hidden = false;
    this.panel.className = `lake-dialog ${modal}-dialog`;
    delete this.panel.dataset.testid;
    this.panel.setAttribute('aria-label', title);
    this.panel.removeAttribute('aria-busy');
    this.body.replaceChildren();
    (this.root.querySelector('.lake-notice') as HTMLElement).hidden = true;
    this.header.inert = true;
    this.touch.inert = true;
    const blocking = modal === 'welcome' || modal === 'menu' || modal === 'error';
    if (blocking !== oldBlocking) {
      if (this.initializing) queueMicrotask(() => { if (!this.disposed && this.modal === 'welcome') this.callbacks.onModal(true); });
      else this.callbacks.onModal(blocking);
    }
  }

  private hideModal(): void {
    const blocking = this.modal === 'welcome' || this.modal === 'menu' || this.modal === 'error';
    this.modal = null;
    this.overlay.hidden = true;
    this.header.inert = false;
    this.touch.inert = false;
    const notice = this.root.querySelector<HTMLElement>('.lake-notice')!;
    notice.hidden = !notice.textContent || !this.ready;
    if (blocking) this.callbacks.onModal(false);
    if (this.returnFocus?.isConnected && !this.returnFocus.closest('[inert]')) this.returnFocus.focus();
    this.returnFocus = null;
  }

  private focusModal(): void {
    (this.panel.querySelector<HTMLElement>('button:not(:disabled), input, select, textarea') || this.panel).focus();
  }

  private showWelcome(): void {
    this.beginModal('welcome', 'Welcome to Stillwater');
    this.panel.dataset.testid = 'welcome';
    this.body.innerHTML = `
      <div class="welcome-mark" aria-hidden="true">≋</div>
      <p class="eyebrow">A SLOWER KIND OF ADVENTURE</p>
      <h1 class="welcome-title">STILLWATER</h1>
      <p class="welcome-tagline">Cast into the quiet.</p>
      <p class="loading-status" role="status">Your quiet corner of the world.</p>
      <button type="button" class="primary play-button" data-action="start" data-testid="start">Play <span aria-hidden="true">↗</span></button>
      <div class="welcome-controls"><span><kbd>W A S D</kbd> / arrows · move</span><span><kbd>Space</kbd> · cast, hook & reel</span><span><kbd>R</kbd> · give line <kbd>Esc</kbd> · pause</span><span>Drag to look · touch controls available</span></div>
      <p class="welcome-footnote">No rush. No noise. Just one more cast.</p>`;
    this.focusModal();
  }

  private showCatch(): void {
    const caught = this.snapshot?.catch;
    if (!caught) return;
    const species = SPECIES.find(s => s.id === caught.species)!;
    this.beginModal('catch', `${species.name} caught`);
    this.panel.dataset.testid = 'catch';
    this.body.append(node('p', 'eyebrow', 'A MOMENT TO REMEMBER'), node('div', 'catch-emblem', '◈'), node('p', 'catch-rarity', species.rarity), node('h1', '', species.name));
    const stats = node('p', 'catch-weight', `${caught.weight.toFixed(2)} kg`);
    this.body.append(stats, node('p', 'muted-copy', caught.record ? 'A new personal best. Recorded in your journal.' : 'Recorded in your journal. A good story, either way.'));
    const choices = node('div', 'catch-choices');
    const keep = button(`Keep · ${caught.value} ◈`, 'keep', undefined, 'primary');
    if ((this.save?.inventory.length ?? 0) >= 30) {
      keep.disabled = true;
      keep.textContent = 'Hold full · release this catch';
    }
    choices.append(keep, button('Release to the lake', 'release'));
    this.body.append(choices, node('p', 'small-copy', 'Keep to sell at the dock. Release to let the story continue.'));
    this.focusModal();
  }

  private buildTab(content: HTMLElement): void {
    if (this.tab === 'Market') {
      content.append(node('h2', '', 'The day’s catch'), node('p', 'muted-copy', 'Sell what you keep. Your discoveries and records are yours forever.'));
      for (const species of SPECIES) {
        const row = this.row(content, species.name, species.rarity);
        row.dataset.species = species.id;
        row.append(node('span', 'inventory-value'), button('Sell', 'sell', species.id));
      }
      content.append(button('Sell all catches', 'sell', 'all', 'primary full-button'));
    } else if (this.tab === 'Tackle') {
      content.append(node('h2', '', 'A little better equipped'));
      for (const kind of ['rod', 'line']) {
        const row = this.row(content, kind === 'rod' ? 'Reel & rod' : 'Fishing line', '');
        row.dataset.upgrade = kind;
        row.append(button('Upgrade', 'upgrade', kind));
      }
      content.append(node('h2', 'section-heading', 'Choose your lure'), node('p', 'muted-copy', 'All three are yours. Match your lure to the water.'));
      const lures = node('div', 'lure-options');
      for (const [id, label] of [['spinner', 'Spinner · reeds & open water'], ['fly', 'Fly · cool eastern water'], ['minnow', 'Minnow · deep northern water']]) lures.append(button(label, 'lure', id));
      content.append(lures, node('h2', 'section-heading', 'Make it yours'));
      const paints = node('div', 'paint-options');
      for (const [id, label] of [['teal', 'Tidal teal'], ['ivory', 'Warm ivory'], ['ember', 'Evening ember']]) {
        const paint = button(label, 'paint', id);
        paint.dataset.paint = id;
        paints.append(paint);
      }
      content.append(paints);
      const form = node('div', 'name-form');
      const label = node('label', '', 'Boat name');
      label.htmlFor = 'boat-name';
      const input = node('input');
      input.id = 'boat-name'; input.maxLength = 24; input.placeholder = 'Your little vessel';
      form.append(label, input, button('Rename', 'rename'));
      content.append(form);
    } else if (this.tab === 'Journal') {
      content.append(node('h2', '', 'Stories beneath the surface'), node('p', 'muted-copy', 'Four familiar faces. One old lake legend.'));
      for (const species of SPECIES) {
        const row = this.row(content, species.name, species.hint);
        row.dataset.record = species.id;
        row.classList.add('journal-row');
        row.append(node('span', 'record-info'));
      }
      content.append(node('p', 'legend-hint'));
    } else if (this.tab === 'Quests') {
      content.append(node('h2', '', 'Small reasons to wander'), node('p', 'muted-copy', 'Accept a challenge before setting out. Return here to claim your reward.'));
      this.buildQuests(content);
    } else {
      content.append(node('h2', '', 'Settle into your rhythm'));
      const quality = node('select');
      quality.id = 'setting-quality'; quality.dataset.setting = 'quality';
      for (const value of ['low', 'medium', 'high']) {
        const option = node('option', '', value[0].toUpperCase() + value.slice(1));
        option.value = value; quality.append(option);
      }
      this.setting(content, 'Water & light quality', quality);
      for (const [key, label] of [['assist', 'Gentler fishing (assist)'], ['reducedMotion', 'Reduce motion'], ['muted', 'Mute sound']]) {
        const input = node('input'); input.type = 'checkbox'; input.id = `setting-${key}`; input.dataset.setting = key;
        this.setting(content, label, input);
      }
      const volume = node('input'); volume.type = 'range'; volume.id = 'setting-volume'; volume.min = '0'; volume.max = '1'; volume.step = '.05'; volume.dataset.setting = 'volume';
      this.setting(content, 'Sound volume', volume);
      content.append(node('p', 'small-copy', 'Sound is off by default. Unmute when you’re ready.'));
      const camera = button('Reset camera', 'camera');
      content.append(camera, node('h2', 'section-heading', 'Your time on the lake'), node('p', 'muted-copy', 'Progress saves on this device. Export a copy to take it with you.'));
      const textarea = node('textarea'); textarea.id = 'save-json'; textarea.rows = 4; textarea.placeholder = 'Paste your exported save JSON here'; textarea.spellcheck = false;
      const label = node('label', 'save-label', 'Save data'); label.htmlFor = textarea.id;
      const buttons = node('div', 'save-actions');
      buttons.append(button('Export save', 'export'), button('Import save', 'import-save'));
      content.append(label, textarea, buttons, button('Reset all progress…', 'reset-save', undefined, 'danger-button'));
      content.append(node('h2', 'section-heading', 'On the water'), node('p', 'controls-copy', 'WASD / arrows to move · Hold Space to charge, release to cast · Space to hook or reel · R to give line · A / D to steer a fish · Escape to pause · Drag to look around. On touch, use the steering pad and Cast / Reel buttons. Alternate Reel and Give line; no simultaneous press needed.'));
    }
  }

  private row(content: HTMLElement, title: string, detail: string): HTMLElement {
    const row = node('div', 'dock-row');
    const copy = node('div', 'row-copy');
    copy.append(node('h3', '', title), node('p', '', detail));
    row.append(copy); content.append(row); return row;
  }

  private setting(content: HTMLElement, title: string, input: HTMLElement): void {
    const row = node('div', 'setting-row');
    const label = node('label', '', title); label.htmlFor = input.id;
    row.append(label, input); content.append(row);
  }

  private buildQuests(content: HTMLElement): void {
    for (const quest of QUESTS) {
      const row = this.row(content, quest.title, quest.description);
      row.dataset.quest = quest.id;
      row.append(node('span', 'quest-progress'), button('Accept', 'acceptQuest', quest.id));
    }
  }

  private refreshMenu(): void {
    const save = this.save;
    if (!save || this.modal !== 'menu') return;
    const content = this.body.querySelector('.dock-content')!;
    if (this.tab === 'Market') {
      for (const row of content.querySelectorAll<HTMLElement>('[data-species]')) {
        const catches = save.inventory.filter(c => c.species === row.dataset.species);
        const total = catches.reduce((sum, c) => sum + c.value, 0);
        this.text(row.querySelector('.inventory-value')!, `${catches.length} kept · ${total} ◈`);
        row.querySelector('button')!.disabled = catches.length === 0;
      }
      const sellAll = content.querySelector<HTMLButtonElement>('[data-value="all"]')!;
      sellAll.disabled = !save.inventory.length;
      this.text(sellAll, `Sell all · ${save.inventory.reduce((sum, c) => sum + c.value, 0)} ◈`);
    } else if (this.tab === 'Tackle') {
      for (const kind of ['rod', 'line'] as const) {
        const row = content.querySelector(`[data-upgrade="${kind}"]`)!;
        const level = save[kind];
        const cost = UPGRADE_COSTS[level] ?? 0;
        this.text(row.querySelector('p')!, `Level ${level} / 3`);
        const upgrade = row.querySelector('button')!;
        upgrade.disabled = level >= 3 || save.coins < cost;
        this.text(upgrade, level >= 3 ? 'Fully upgraded' : `Upgrade · ${cost} ◈`);
      }
      for (const lure of content.querySelectorAll<HTMLButtonElement>('[data-action="lure"]')) lure.setAttribute('aria-pressed', String(lure.dataset.value === this.snapshot?.lure));
      for (const paint of content.querySelectorAll<HTMLButtonElement>('[data-paint]')) {
        const id = paint.dataset.paint!;
        const owned = save.paints.includes(id) || save.paint === id;
        paint.disabled = !owned && save.coins < 70;
        paint.setAttribute('aria-pressed', String(save.paint === id));
        const title = id === 'teal' ? 'Tidal teal' : id === 'ivory' ? 'Warm ivory' : 'Evening ember';
        this.text(paint, `${title} · ${save.paint === id ? 'Equipped' : owned ? 'Equip' : '70 ◈'}`);
      }
      const name = content.querySelector<HTMLInputElement>('#boat-name')!;
      if (document.activeElement !== name) name.value = save.name;
    } else if (this.tab === 'Journal') {
      for (const row of content.querySelectorAll<HTMLElement>('[data-record]')) {
        const id = row.dataset.record as keyof Save['journal'];
        const record = save.journal[id];
        row.classList.toggle('undiscovered', !record);
        this.text(row.querySelector('.record-info')!, record ? `${record.count} caught · Best ${record.record.toFixed(2)} kg` : 'Not yet discovered');
      }
      this.text(content.querySelector('.legend-hint')!, bossUnlocked(save) ? 'The northern water glimmers. The Gilded King is waiting. Try a minnow in the far north.' : 'Discover perch, trout, bass and pike to awaken the legend of the far north.');
    } else if (this.tab === 'Quests') {
      this.refreshQuests(content, save);
    } else {
      for (const input of content.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
        const key = input.dataset.setting as keyof Save['settings'];
        if (document.activeElement === input) continue;
        if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(save.settings[key]);
        else input.value = String(save.settings[key]);
      }
    }
  }

  private refreshQuests(content: Element, save: Save): void {
    for (const quest of QUESTS) {
      const row = content.querySelector(`[data-quest="${quest.id}"]`)!;
      const status = save.quests[quest.id];
      const progress = status?.accepted ? Math.max(0, questProgress(save, quest.id) - status.base) : 0;
      const ready = progress >= quest.goal;
      this.text(row.querySelector('.quest-progress')!, `${Math.min(progress, quest.goal)} / ${quest.goal} · ${quest.reward} ◈`);
      const action = row.querySelector('button')!;
      action.dataset.action = status?.accepted ? 'claimQuest' : 'acceptQuest';
      action.disabled = Boolean(status?.claimed) || Boolean(status?.accepted && !ready);
      this.text(action, status?.claimed ? 'Claimed' : !status?.accepted ? 'Accept' : ready ? 'Claim reward' : 'In progress');
    }
  }

  private onClick = (event: MouseEvent): void => {
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action!;
    const value = target.dataset.value;
    if (action === 'start') { this.hideModal(); this.callbacks.onAction('start'); }
    else if (action === 'close') { this.closeMenu(); this.callbacks.onAction('resume'); }
    else if (action === 'menu') { this.callbacks.onAction('menu'); if (this.modal !== 'menu') this.openMenu(); }
    else if (action === 'tab') {
      if (this.modal === 'menu') {
        this.tab = value!;
        for (const tab of this.body.querySelectorAll<HTMLElement>('[role="tab"]')) {
          const selected = tab.dataset.value === value;
          tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
        }
        const content = this.body.querySelector<HTMLElement>('.dock-content')!;
        content.setAttribute('aria-labelledby', target.id);
        content.replaceChildren(); this.buildTab(content); this.refreshMenu();
      } else this.openMenu(value);
    } else if (action === 'rename') {
      this.callbacks.onAction('name', this.body.querySelector<HTMLInputElement>('#boat-name')!.value.trim().slice(0, 24));
    } else if (action === 'import-save') {
      const json = this.body.querySelector<HTMLTextAreaElement>('#save-json')!.value.trim();
      if (!json) return;
      if (window.confirm('Replace current progress with this imported save?')) this.callbacks.onAction('import', json);
    } else if (action === 'reset-save') {
      if (window.confirm('Reset all Stillwater progress? This permanently removes your coins, catches, journal and upgrades.')) this.callbacks.onAction('reset');
    } else {
      this.callbacks.onAction(action, value);
      if (action === 'lure') this.refreshMenu();
    }
  };

  private onChange = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const setting = input.dataset.setting;
    if (setting) this.callbacks.onAction(setting, input.type === 'checkbox' ? String(input.checked) : input.value);
  };

  private onFocus = (event: FocusEvent): void => {
    if (this.modal && !this.panel.contains(event.target as Node)) this.focusModal();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.modal || (event.target instanceof Element && event.target.matches('input, textarea, select'))) event.stopImmediatePropagation();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.modal) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.modal === 'menu') { this.closeMenu(); this.callbacks.onAction('resume'); }
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => !el.hidden && el.offsetParent !== null);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); this.panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && (event.target as HTMLElement).getAttribute('role') === 'tab') {
      event.preventDefault();
      const index = TABS.indexOf(this.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      const target = this.body.querySelector<HTMLButtonElement>(`[role="tab"][data-value="${TABS[next]}"]`)!;
      target.click(); target.focus();
    }
  };
}
