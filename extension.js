const Meta = imports.gi.Meta;
const Gio  = imports.gi.Gio;
const GLib = imports.gi.GLib;

let dedicated, names, conns, ids, gsettings, baseNames, scheduled, pend;

function init() {}

function enable() {
    dedicated = new Map(); names = new Map(); conns = new Map();
    ids = []; scheduled = false;
    pend = new Map();      // Meta.Window -> { id: timer id, kind: 'claim'|'release' }
    gsettings = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.wm.preferences' });
    baseNames = gsettings.get_strv('workspace-names');
    ids.push(global.screen.connect('window-added', (s, w) => _track(w)));
    const actors = global.get_window_actors();
    actors.forEach(a => _track(a.meta_window));
    _restore(actors);     // re-adopt fullscreen windows that survived a restart
    _flush();
}

function disable() {
    ids.forEach(id => global.screen.disconnect(id)); ids = [];
    for (const [w, list] of conns)
        list.forEach(id => { try { w.disconnect(id); } catch (e) {} });
    conns.clear();
    for (const [, p] of pend)
        try { GLib.source_remove(p.id); } catch (e) {}
    pend.clear(); dedicated.clear(); names.clear();
    gsettings.reset('workspace-names'); gsettings = null;
}

function _restore(actors) { // FIX 1: rebuild dedicated map from names after a restart
    const n = global.screen.get_n_workspaces();
    for (let i = 0; i < n; i++) {
        const ws = global.screen.get_workspace_by_index(i), nm = baseNames[i];
        const hit = nm && actors.find(a => {
            const w = a.meta_window;
            return _isFull(w) && !dedicated.has(w) &&
                   (w.get_wm_class() === nm || w.get_title() === nm);
        });
        if (hit) { names.set(ws, nm); dedicated.set(hit.meta_window, { ws: ws, name: nm }); }
    }
}

function _sched() {
    if (scheduled) return;
    scheduled = true;
    Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => { scheduled = false; _flush(); return false; });
}

function _flush() {
    for (const [w, rec] of Array.from(dedicated)) {
        if (w.get_compositor_priv && !w.get_compositor_priv()) {
            _unpend(w); dedicated.delete(w); names.delete(rec.ws); _dropWs(rec.ws); continue;
        }
        if (!_isFull(w)) _pend(w, 'release');
    }
    for (const [w, rec] of Array.from(dedicated)) {
        if (w.is_on_all_workspaces()) continue;
        if (w.get_workspace() !== rec.ws) w.change_workspace(rec.ws);
    }
    for (const a of global.get_window_actors()) {
        const w = a.meta_window;
        if (dedicated.has(w)) continue;
        if (conns.has(w) && _isFull(w)) _pend(w, 'claim');
        else { const ws = w.get_workspace(); if (ws && names.has(ws)) _evict(ws, null); }
    }
    _pushNames();
}

function _pushNames() {
    const arr = [], n = global.screen.get_n_workspaces();
    for (let i = 0; i < n; i++)
        arr.push(_name(global.screen.get_workspace_by_index(i)) || baseNames[i] || '');
    gsettings.set_strv('workspace-names', arr);
}

function _name(ws) {
    for (const rec of dedicated.values())
        if (rec.ws === ws) return rec.name;
    return null;
}

function _track(w) {
    if (conns.has(w) || w.get_window_type() !== Meta.WindowType.NORMAL) return;
    conns.set(w, ['size-changed', 'position-changed', 'workspace-changed'].map(
        sig => w.connect(sig, () => _sched())));
    conns.get(w).push(w.connect('unmanaged', () => {
        conns.delete(w); _unpend(w);
        const rec = dedicated.get(w);
        if (rec) { dedicated.delete(w); names.delete(rec.ws); _dropWs(rec.ws, true); } // delayed teardown
        _sched();
    }));
    if (_isFull(w)) _sched();
}

function _geom(w) {
    if (typeof w.get_frame_rect === 'function') return w.get_frame_rect();
    if (typeof w.get_outer_rect === 'function') return w.get_outer_rect();
    return w.get_rect();
}

function _isFull(w) {
    if (typeof w.is_fullscreen === 'function' && w.is_fullscreen()) return true;
    const m = global.screen.get_monitor_geometry(w.get_monitor());
    const r = _geom(w);
    return r.x <= m.x && r.y <= m.y &&
           r.x + r.width >= m.x + m.width && r.y + r.height >= m.y + m.height;
}

function _regular(avoid) {
    const n = global.screen.get_n_workspaces();
    for (let i = n - 1; i >= 0; i--) {
        const ws = global.screen.get_workspace_by_index(i);
        if (ws !== avoid && !_name(ws)) return ws;
    }
    return global.screen.append_new_workspace(false, global.get_current_time());
}

function _dropWs(ws, later) {
    if (later) // removing instantly after a window dies can crash Muffin
        return void GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => { _dropWs(ws); return false; });
    if (global.screen.get_n_workspaces() > 1)
        global.screen.remove_workspace(ws, global.get_current_time());
    names.delete(ws);
}

function _claim(w) {
    _unpend(w);
    const name = w.get_wm_class() || w.get_title() || 'fullscreen';
    const stored = gsettings.get_strv('workspace-names'); // FIX 2: reuse an existing workspace
    let ws = null;
    const n = global.screen.get_n_workspaces();
    for (let i = 0; i < n && !ws; i++) {
        const cand = global.screen.get_workspace_by_index(i);
        if ((_name(cand) || stored[i]) === name) ws = cand;
    }
    if (!ws) { ws = global.screen.append_new_workspace(false, global.get_current_time()); names.set(ws, name); }
    dedicated.set(w, { ws: ws, name: name });
    _pushNames();
    w.change_workspace(ws);
    ws.activate(global.get_current_time());
    _evict(ws, w);
}

function _release(w) {
    _unpend(w);
    const rec = dedicated.get(w);
    dedicated.delete(w);
    if (!rec) return;
    if (w.get_workspace() === rec.ws && !w.is_on_all_workspaces())
        w.change_workspace(_regular(rec.ws));
    _dropWs(rec.ws);
}

function _evict(ws, keep) {
    const dst = _regular(ws);
    global.get_window_actors().forEach(a => {
        const w = a.meta_window;
        if (w === keep || w.is_on_all_workspaces()) return;
        const rec = dedicated.get(w);
        if (rec) { if (w.get_workspace() !== rec.ws) w.change_workspace(rec.ws); }
        else if (w.get_workspace() === ws) w.change_workspace(dst);
    });
}

function _pend(w, kind) { // defer a transition until the native animation settles
    if (pend.has(w)) return;      // one pending transition per window
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        pend.delete(w);
        if (kind === 'claim' && conns.has(w) && _isFull(w) && !dedicated.has(w)) _claim(w);
        else if (kind === 'release' && dedicated.has(w) && !_isFull(w)) _release(w);
        return GLib.SOURCE_REMOVE;
    });
    pend.set(w, { id: id, kind: kind });
}

function _unpend(w) {
    const p = pend.get(w);
    if (p) { try { GLib.source_remove(p.id); } catch (e) {} pend.delete(w); }
}
