/** 手机上看到的几个小页面，样式内联，不依赖任何外部资源。 */

const shell = (title: string, body: string, script = '') => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0c110f">
<title>${title}</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body {
  min-height: 100dvh; display: grid; place-items: center; padding: 32px 28px calc(32px + env(safe-area-inset-bottom));
  background: radial-gradient(120% 70% at 50% -10%, #23301f 0%, #10160f 46%, #0c110f 100%); color: #e6ebe3;
  font: 16px/1.6 system-ui, -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
}
main { width: min(340px, 100%); text-align: center; }
svg { width: 44px; height: 44px; margin-bottom: 22px; }
h1 { font: 600 26px/1.3 "Songti SC", "Noto Serif SC", serif; letter-spacing: .02em; }
p { margin-top: 10px; color: #a3aea2; font-size: 15px; }
p.bad { color: #e79b86; }
form { margin-top: 26px; display: grid; gap: 14px; }
input {
  width: 100%; height: 64px; border: 1px solid #35422f; border-radius: 14px; background: #0a0f0c; color: #f3e7cf; text-align: center;
  font: 500 30px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .32em; text-indent: .32em; outline: none;
}
input:focus { border-color: #e0a04b; }
button {
  height: 52px; border: 0; border-radius: 14px; width: 100%; font-family: inherit; font-size: 16px; font-weight: 600; color: #241603;
  background: linear-gradient(#f0b765, #dd9a41); box-shadow: inset 0 1px 0 #ffe1ad80;
}
button:disabled { opacity: .55; }
.note { margin-top: 26px; font-size: 13px; color: #7d897d; }
</style>
</head>
<body>
<main>
<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 44V22a16 16 0 0 1 32 0v22" stroke="#d9cfb8" stroke-width="2.4"/><path d="M15 44V23a9 9 0 0 1 18 0v21M24 14v30" stroke="#e0a04b" stroke-width="2"/><path d="M4 44h40" stroke="#d9cfb8" stroke-width="2.4" stroke-linecap="round"/></svg>
${body}
</main>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;

export const codePage = (error = '') =>
  shell(
    '连接酒馆',
    `<h1>连接酒馆</h1>
<p${error ? ' class="bad"' : ''}>${error || '在电脑上打开掌柜的「手机」页，扫二维码，或输入那里的 6 位配对码。'}</p>
<form method="post" action="/__innkeeper/pair">
<input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" aria-label="配对码" placeholder="000000" required>
<button>连接</button>
</form>
<p class="note">配对一次，这台手机就一直认得。</p>`,
  );

export const offlinePage = () =>
  shell(
    '酒馆还没开门',
    `<h1>酒馆还没开门</h1>
<p id="t">电脑上的酒馆没有在运行。</p>
<form id="f"><button id="b">开门</button></form>`,
    `const t=document.getElementById('t'),b=document.getElementById('b');
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;t.textContent='正在开门，稍等几秒。';
try{await fetch('/__innkeeper/start',{method:'POST'})}catch{}});
setInterval(async()=>{try{const s=await(await fetch('/__innkeeper/state')).json();if(s.phase==='running')location.replace('/');
else if(s.phase==='starting'){b.disabled=true;t.textContent='正在开门，稍等几秒。'}else if(s.phase==='crashed'){b.disabled=false;t.textContent='没有启动成功，到电脑上看一眼。'}}catch{t.textContent='连不上电脑，确认掌柜开着、手机在同一个网络。'}},2000);`,
  );

/** 插进酒馆页面：电脑那边改过设置或打烊时给出提示。 */
export const INJECT = `(() => {
  let bar = null;
  const show = (text, label, act) => {
    if (bar && bar.dataset.text === text) return;
    hide();
    bar = document.createElement('div');
    bar.dataset.text = text;
    // 放进浏览器顶层，酒馆的 body 有变换，普通的固定定位会跑到屏幕外
    bar.popover = 'manual';
    bar.style.cssText = 'position:fixed;inset:calc(54px + env(safe-area-inset-top)) 12px auto 12px;margin:0;text-shadow:none;width:auto;box-sizing:border-box;z-index:99999;display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;background:#141c16f2;color:#e6ebe3;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px #0009;border:1px solid #3a4835';
    const span = document.createElement('span');
    span.style.flex = '1';
    span.textContent = text;
    bar.append(span);
    if (label) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'border:0;border-radius:9px;padding:9px 14px;background:#e0a04b;color:#241603;font:600 14px/1 system-ui,sans-serif;white-space:nowrap;text-shadow:none';
      b.onclick = act;
      bar.append(b);
    }
    document.documentElement.append(bar);
    bar.showPopover?.();
  };
  const hide = () => { bar?.remove(); bar = null; };
  const check = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch('/__innkeeper/state', { cache: 'no-store' });
      if (r.status === 401) return show('这台手机的连接被取消了', '重新配对', () => location.reload());
      const s = await r.json();
      if (s.phase === 'starting') show('酒馆正在开门');
      else if (s.phase !== 'running') show('电脑上的酒馆打烊了', '开门', () => fetch('/__innkeeper/start', { method: 'POST' }).then(() => show('酒馆正在开门')));
      else if (s.stale) show('电脑上改过设置，刷新后生效', '刷新', () => location.reload());
      else hide();
    } catch { show('连不上电脑，确认掌柜开着、手机在同一个网络'); }
  };
  setInterval(check, 8000);
  document.addEventListener('visibilitychange', check);
})();
`;
