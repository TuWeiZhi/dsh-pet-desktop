(() => {
  'use strict';
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const pointer = window.__petPointer;
  const scale = Number(new URLSearchParams(location.search).get('scale')) || 1;
  let busy = false, input = { dragging: false, rects: [] }, margins;
  let ignoring = true, offBodyMs = 0, latestBounds = null, moving = false;
  let closingWindow = false;
  const errors = [];
  const callbacks = { flightStates: [], petHit: [], displays: [] };
  function report(error) { errors.push(String(error)); console.error('[Tauri bridge]', error); }
  async function moveWindow() {
    if (moving) return;
    moving = true;
    try {
      while (latestBounds) {
        const bounds = latestBounds;
        latestBounds = null;
        await invoke('set_bounds', { bounds });
      }
    } catch (error) { report(error); }
    finally { moving = false; }
  }
  function setIgnoring(next) {
    if (next === ignoring) return;
    ignoring = next;
    void invoke('set_passthrough', { ignore: next }).catch(report);
  }
  window.petBridge = {
    readNote(key, legacy) { return invoke('read_note', { key, legacy: legacy ?? null }); },
    writeNote(key, text) { return invoke('write_note', { key, text }); },
    queueNote(key, text) { void invoke('write_note', { key, text }).catch(report); },
    flushNotes() { return invoke('flush_notes'); },
    resumeNotes() { return invoke('resume_notes'); },
    setBounds(x, y, width, height, boxX, boxY, size, bottomPad, vx, vy, marginL, marginT) {
      margins = { l: marginL, t: marginT };
      latestBounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
      void moveWindow();
      void invoke('report_flight', { motion: { x: boxX, y: boxY, size, bottomPad, vx, vy } }).catch(report);
    },
    setInteractive(value) { if (!busy) setIgnoring(!value); },
    setInputBusy(value) { busy = value; if (input.dragging) setIgnoring(false); },
    setInputRegions(value) { input = value; if (value.dragging) setIgnoring(false); },
    openDshSite() { void invoke('show_settings').catch(report); },
    reportFlight(motion) { void invoke('report_flight', { motion }).catch(report); },
    onFlightStates(cb) { callbacks.flightStates.push(cb); },
    reportCollide(targetId, vx, vy) { void invoke('report_collision', { targetId, vx, vy }).catch(report); },
    onPetHit(cb) { callbacks.petHit.push(cb); },
    onDisplays(cb) { callbacks.displays.push(cb); },
  };
  window.__petTauri = {
    errors,
    status: () => ({ ignoring, busy, input, margins, moving }),
    flightStates(value) { for (const cb of callbacks.flightStates) cb(value); },
    petHit(value) { for (const cb of callbacks.petHit) cb(value); },
    displays(value) { for (const cb of callbacks.displays) cb(value); },
    async flushForHost(id) {
      try { await window.PetNotes?.flushAll(true); await invoke('notes_flushed', { id, error: null }); }
      catch (error) { await invoke('notes_flushed', { id, error: String(error) }); }
    },
    async closeWindowAfterSaving() {
      if (closingWindow) return;
      closingWindow = true;
      try { await window.PetNotes?.flushAll(true); await invoke('finish_window_close'); }
      catch (error) {
        closingWindow = false;
        report(error);
        window.PetNotes?.resumeEditing();
        alert('便签未能保存，已取消关闭。请先复制便签内容。');
      }
    },
    async closeAfterSaving() {
      try { await window.PetNotes?.flushAll(true); await invoke('finish_close'); }
      catch (error) {
        report(error);
        window.PetNotes?.resumeEditing();
        await invoke('cancel_close');
        alert('便签未能保存，已取消退出。请先复制便签内容。');
      }
    },
  };
  async function pollPointer() {
    try {
      const state = await invoke('pointer_state');
      if (state.bounds.width > 8) {
        const point = { x: state.x, y: state.y };
        const zone = pointer.pointerZone(state.bounds, point, margins);
        offBodyMs = !busy && zone === 'margin' ? offBodyMs + pointer.POINTER_POLL_MS : 0;
        setIgnoring(pointer.decideWindowIgnore(state.bounds, point, ignoring, busy, offBodyMs, input, margins));
        // Tauri has no Electron forward:true; keep the existing hover handling fed while transparent.
        if (!input.dragging) window.dispatchEvent(new MouseEvent('mousemove', {
          clientX: (state.x - state.bounds.x) / scale, clientY: (state.y - state.bounds.y) / scale,
          screenX: state.x / scale, screenY: state.y / scale, bubbles: true,
        }));
      }
    } catch (error) { report(error); }
    setTimeout(pollPointer, pointer.POINTER_POLL_MS);
  }
  window.addEventListener('DOMContentLoaded', pollPointer, { once: true });
})();
