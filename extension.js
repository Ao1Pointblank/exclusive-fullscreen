const Meta = imports.gi.Meta;
const Gio  = imports.gi.Gio;
const GLib = imports.gi.GLib;

let dedicated, names, conns, ids, gsettings, baseNames, scheduled;
let pendingClaims, pendingReleases;

function init() {}

function enable() {
    dedicated = new Map();
    names     = new Map();
    conns     = new Map();
    ids       = [];
    scheduled = false;
    pendingClaims   = new Map();
    pendingReleases = new Map();
    gsettings = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.wm.preferences' });
    baseNames = gsettings.get_strv('workspace-names');
    ids.push(global.screen.connect('window-added', (s, w) => _track(w)));
    global.get_window_actors().forEach(a => _track(a.meta_window));
    _flush();
}

function disable() {
    ids.forEach(id => global.screen.disconnect(id));
    ids = [];
    for (const [w, list] of conns)
        list.forEach(id => { try { w.disconnect(id); } catch (e) {} });
    conns.clear();
    for (const [, id] of pendingClaims)
        try { GLib.source_remove(id); } catch (e) {}
    for (const [, id] of pendingReleases)
        try { GLib.source_remove(id); } catch (e) {}
    pendingClaims.clear();
    pendingReleases.clear();
    dedicated.clear();
    names.clear();
    gsettings.reset('workspace-names');
    gsettings = null;
}

function _sched() {
    if (scheduled) return;
    scheduled = true;
    Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
        scheduled = false;
        _flush();
        return false;
    });
}

function _flush() {
    for (const [w, rec] of Array.from(dedicated)) {
        if (w.get_compositor_priv && !w.get_compositor_priv()) {
            _cancelPending(w);
            dedicated.delete(w); names.delete(rec.ws); _dropWs(rec.ws); continue;
        }
        if (!_isFull(w)) _releaseDeferred(w);
    }
    for (const [w, rec] of Array.from(dedicated)) {
        if (w.is_on_all_workspaces()) continue;
        if (w.get_workspace() !== rec.ws) w.change_workspace(rec.ws);
    }
    for (const a of global.get_window_actors()) {
        const w = a.meta_window;
        if (dedicated.has(w)) continue;
        if (conns.has(w) && _isFull(w)) _claimDeferred(w);
        else {
            const ws = w.get_workspace();
            if (ws && names.has(ws)) _evict(ws, null);
        }
    }
    _pushNames();
}

function _pushNames() {
    const arr = [];
    const n = global.screen.get_n_workspaces();
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
    conns.set(w, [
        w.connect('size-changed',  () => _sched()),
        w.connect('position-changed', () => _sched()),
        w.connect('workspace-changed', () => _sched()),
        w.connect('unmanaged',     () => { conns.delete(w); _cancelPending(w); _sched(); })
    ]);
    if (_isFull(w)) _sched();
}

function _geom(w) {
    if (typeof w.get_frame_rect === 'function') return w.get_frame_rect();
    if (typeof w.get_outer_rect === 'function') return w.get_outer_rect();
    return w.get_rect();
}

function _isFull(w) {
    // Prefer native WM flag if available (more accurate for sandboxed apps)
    if (typeof w.is_fullscreen === 'function' && w.is_fullscreen())
        return true;
    // Fallback to geometry check for older Muffin versions
    const m = global.screen.get_monitor_geometry(w.get_monitor());
    const r = _geom(w);
    return r.x <= m.x && r.y <= m.y &&
           r.x + r.width >= m.x + m.width &&
           r.y + r.height >= m.y + m.height;
}

function _regular(avoid) {
    const n = global.screen.get_n_workspaces();
    for (let i = n - 1; i >= 0; i--) {
        const ws = global.screen.get_workspace_by_index(i);
        if (ws !== avoid && !_name(ws)) return ws;
    }
    return global.screen.append_new_workspace(false, global.get_current_time());
}

function _dropWs(ws) {
    if (global.screen.get_n_workspaces() > 1)
        global.screen.remove_workspace(ws, global.get_current_time());
    names.delete(ws);
}

function _claim(w) {
    _cancelPending(w);
    const name = w.get_wm_class() || w.get_title() || 'fullscreen';
    const ws = global.screen.append_new_workspace(false, global.get_current_time());
    names.set(ws, name);
    dedicated.set(w, { ws: ws, name: name });
    _pushNames();
    w.change_workspace(ws);
    ws.activate(global.get_current_time());
    _evict(ws, w);
}

function _release(w) {
    _cancelPending(w);
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
        if (rec) {
            if (w.get_workspace() !== rec.ws) w.change_workspace(rec.ws);
        } else if (w.get_workspace() === ws) {
            w.change_workspace(dst);
        }
    });
}

function _claimDeferred(w) {
    if (pendingClaims.has(w) || pendingReleases.has(w)) return;
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        pendingClaims.delete(w);
        if (conns.has(w) && _isFull(w) && !dedicated.has(w)) _claim(w);
        return GLib.SOURCE_REMOVE;
    });
    pendingClaims.set(w, id);
}

function _releaseDeferred(w) {
    if (pendingReleases.has(w) || pendingClaims.has(w)) return;
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        pendingReleases.delete(w);
        if (dedicated.has(w) && !_isFull(w)) _release(w);
        return GLib.SOURCE_REMOVE;
    });
    pendingReleases.set(w, id);
}

function _cancelPending(w) {
    const cid = pendingClaims.get(w);
    if (cid !== undefined) {
        try { GLib.source_remove(cid); } catch (e) {}
        pendingClaims.delete(w);
    }
    const rid = pendingReleases.get(w);
    if (rid !== undefined) {
        try { GLib.source_remove(rid); } catch (e) {}
        pendingReleases.delete(w);
    }
}
