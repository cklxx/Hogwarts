// The launcher: servers found on the LAN, servers used before, or an address typed by hand (src-tauri/src/lib.rs).
const { invoke } = window.__TAURI__.core;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const status = (text, err = false) => { const el = $('#status'); el.textContent = text; el.classList.toggle('err', err); };
let busy = false;

async function enter(url) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  status(`正在连接 ${url} …`);
  try {
    await invoke('connect', { url }); // opens the game window and closes this one
  } catch (e) {
    status(String(e), true);
    busy = false;
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}

function row(s, extra = '') {
  const li = document.createElement('li');
  li.innerHTML = `<div class="grow"><span class="name">${esc(s.name)}</span><span class="meta">${esc(s.url)} · ${s.players} 人在线 · v${esc(s.version)}</span></div>${extra}<button type="button" class="primary">进入</button>`;
  li.querySelector('.primary').onclick = () => enter(s.url);
  return li;
}

async function scan() {
  const list = $('#found');
  list.innerHTML = '<li class="empty">正在查找…</li>';
  const found = await invoke('discover', {});
  list.innerHTML = '';
  if (!found.length) list.innerHTML = '<li class="empty">没有找到。服务器要用默认设置启动（HOST=0.0.0.0），并且防火墙要放行 UDP 7777；也可以在下面手动输入地址。</li>';
  for (const s of found) list.appendChild(row(s));
  return found;
}

async function known(cfg) {
  const list = $('#known');
  list.innerHTML = '';
  $('#known-box').hidden = !cfg.known.length;
  for (const url of cfg.known) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="grow"><span class="name">${esc(url)}</span><span class="meta">查询中…</span></div><button type="button" class="quiet" title="忘记这个服务器和它的密钥">忘记</button><button type="button" class="primary">进入</button>`;
    li.querySelector('.primary').onclick = () => enter(url);
    li.querySelector('.quiet').onclick = async () => known(await invoke('forget', { url }));
    list.appendChild(li);
    invoke('probe', { url }).then(
      (v) => { li.querySelector('.name').textContent = v.name; li.querySelector('.meta').textContent = `${url} · ${v.players} 人在线 · v${v.version}`; },
      () => { li.querySelector('.meta').textContent = `${url} · 现在连不上`; },
    );
  }
}

$('#rescan').onclick = () => scan();
$('#manual').onsubmit = (e) => { e.preventDefault(); const v = $('#addr').value.trim(); if (v) enter(v); };

(async () => {
  const cfg = await invoke('saved');
  known(cfg);
  const pick = new URLSearchParams(location.search).has('pick');
  // straight back into the last castle, unless we came here to switch (Ctrl+Shift+S)
  if (cfg.last && !pick) {
    try { await invoke("probe", { url: cfg.last }); await enter(cfg.last); if (busy) return; } catch { /* not up: show the list */ }
  }
  scan();
})();
