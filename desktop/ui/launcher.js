// The launcher: servers found on the LAN, servers used before, or an address typed by hand (src-tauri/src/lib.rs).
const { invoke } = window.__TAURI__.core;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const status = (text, err = false) => { const el = $('#status'); el.textContent = text; el.classList.toggle('err', err); };
let busy = false;
const MAC = /Mac/.test(navigator.platform);
// the shell's shortcuts on this platform (macOS: the menu's ⌃⌘F / ⇧⌘S, since F11 is Show Desktop there)
invoke('keys').then((k) => { $('#keys').textContent = `进入游戏后：${k.full} 全屏，${k.switch} 回到这里换服务器。密钥保存在系统钥匙串里。`; }).catch(() => {});

async function enter(url) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  status(`正在连接 ${url} …`);
  // unsigned builds: after an update macOS asks whether this (new) program may read the key it stored, and the
  // connection waits for that answer
  const slow = MAC && setTimeout(() => status(`正在连接 ${url} …如果系统询问能否使用钥匙串里的「hogwarts-desktop」，请点「始终允许」。`), 2000);
  try {
    await invoke('connect', { url }); // opens the game window and closes this one
  } catch (e) {
    clearTimeout(slow);
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

// 连接我的 Agent: this program as the `hogwarts` MCP server (--mcp-stdio), wired into Claude Desktop or Claude Code
async function agentSection(cfg) {
  const info = await invoke('agent_info');
  $('#code-cmd').textContent = info.claude_code;
  const say = (t, err = false) => { const el = $('#agent-status'); el.textContent = t; el.classList.toggle('err', err); };
  if (!cfg.last) say('先进入一次服务器，Agent 会连到那一个。');
  const desk = $('#to-desktop'), code = $('#to-code');
  if (!info.claude_desktop) { desk.disabled = true; desk.title = '没有检测到 Claude Desktop'; }
  if (!info.has_claude_cli) { code.disabled = true; code.title = '没有找到 claude 命令：把下面的命令复制到终端里执行'; }
  const run = async (target) => { try { say(await invoke('agent_setup', { target })); } catch (e) { say(String(e), true); } };
  desk.onclick = () => run('claude-desktop');
  code.onclick = () => run('claude-code');
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(info.claude_code); say('已复制。粘贴到终端里执行。'); } catch { say('复制失败：请手动选中命令复制。', true); } };
}

$('#rescan').onclick = () => scan();
$('#manual').onsubmit = (e) => { e.preventDefault(); const v = $('#addr').value.trim(); if (v) enter(v); };

(async () => {
  const cfg = await invoke('saved');
  known(cfg);
  agentSection(cfg).catch(() => { $('#agent').hidden = true; });
  const pick = new URLSearchParams(location.search).has('pick');
  // straight back into the last castle, unless we came here to switch (Ctrl+Shift+S)
  if (cfg.last && !pick) {
    try { await invoke("probe", { url: cfg.last }); await enter(cfg.last); if (busy) return; } catch { /* not up: show the list */ }
  }
  scan();
})();
