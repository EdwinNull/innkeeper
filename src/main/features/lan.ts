import { powerSaveBlocker } from 'electron';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import type { Duplex } from 'node:stream';
import type { LanAddress, LanDevice, LanStatus } from '@shared/types';
import { emit } from '../core/bus';
import { UserError } from '../core/errors';
import { exec } from '../core/exec';
import { pickPort } from '../core/port';
import { prefs, setPrefs } from '../core/store';
import { readConfig } from '../tavern/config';
import { tavernProcess } from '../tavern/process';
import { settingsEpoch } from '../tavern/userdata';
import { codePage, INJECT, offlinePage } from './lan-pages';

/**
 * 手机连接：在局域网上开一道只认配对设备的门，转发到只监听本机的酒馆。
 * 酒馆自己的监听、白名单与密码设置都不用动。
 */

const COOKIE = 'ik_phone';
const BASE = '/__innkeeper';
const PAIR_TTL = 10 * 60_000;
const COOKIE_AGE = 180 * 24 * 3600;
/** 测试用：只绑定到指定地址，避免弹出防火墙提示 */
const BIND = process.env.INNKEEPER_LAN_BIND || '0.0.0.0';

let server: http.Server | null = null;
let lastError: string | null = null;
/** 手机在玩的时候电脑不能自己睡过去，屏幕照常熄 */
let awake: number | null = null;
let pairing = { token: '', code: '', expires: 0 };
/** 各地址输错配对码的次数 */
const misses = new Map<string, { count: number; until: number }>();
/** 设备上次取设置时的版本，用来拦住用旧数据覆盖新设置 */
const loaded = new Map<string, number>();
const seen = new Map<string, number>();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function freshPairing(): void {
  pairing = { token: randomBytes(16).toString('base64url'), code: String(randomInt(0, 1_000_000)).padStart(6, '0'), expires: Date.now() + PAIR_TTL };
}

/** 只放行内网地址，含 Tailscale 一类组网用的 100.64.0.0/10。 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/i, '');
  if (ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return false;
  const [a, b] = p as [number, number, number, number];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const VIRTUAL = /vethernet|vmware|virtualbox|wsl|hyper-v|docker|loopback|\btap\b|\btun\b|clash|mihomo|meta|sing-box|wintun|wireguard|zerotier|tailscale|radmin|hamachi|vpn|npcap|bluetooth/i;

/** 列出手机可能连得上的地址，最像家里路由器的排前面。 */
export function lanAddresses(interfaces = os.networkInterfaces()): LanAddress[] {
  const out: (LanAddress & { score: number })[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      // 198.18/15 是代理软件的假地址，169.254 是没拿到地址
      if (/^(198\.1[89]|169\.254)\./.test(i.address) || !isPrivateAddress(i.address)) continue;
      const virtual = VIRTUAL.test(name);
      const score =
        (virtual ? 0 : 100) + (/wlan|wi-?fi|无线/i.test(name) ? 30 : /ethernet|以太网|本地连接/i.test(name) ? 20 : 0) +
        (i.address.startsWith('192.168.') ? 8 : i.address.startsWith('10.') ? 6 : 4) - (/\.1$/.test(i.address) ? 5 : 0);
      out.push({ address: i.address, name, virtual, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).map(({ score: _, ...rest }) => rest);
}

export async function lanStatus(): Promise<LanStatus> {
  const { lan } = prefs();
  const addresses = BIND === '0.0.0.0' ? lanAddresses() : [{ address: BIND, name: '本机测试', virtual: false }];
  const address = addresses.find((a) => a.address === lan.address)?.address ?? addresses[0]?.address ?? null;
  const running = Boolean(server?.listening);
  if (running && pairing.expires < Date.now()) freshPairing();
  const url = running && address ? `http://${address}:${lan.port}` : null;
  return {
    enabled: lan.enabled,
    running,
    port: lan.port,
    error: lastError,
    addresses,
    address,
    url,
    pairUrl: url ? `${url}${BASE}/p/${pairing.token}` : null,
    code: running ? pairing.code : null,
    expiresAt: running ? pairing.expires : null,
    devices: lan.devices
      .map(({ tokenHash: _, ...d }) => ({ ...d, lastSeen: seen.get(d.id) ?? d.lastSeen, online: Date.now() - (seen.get(d.id) ?? 0) < 60_000 }))
      .sort((a, b) => b.lastSeen - a.lastSeen),
  };
}

const publish = async () => emit('lan:state', await lanStatus());

// —— 开关 ——

export async function setLan(enabled: boolean): Promise<LanStatus> {
  await setPrefs({ lan: { ...prefs().lan, enabled } });
  if (enabled) await openLan();
  else await closeLan();
  return lanStatus();
}

export async function openLan(): Promise<void> {
  if (server?.listening) return;
  lastError = null;
  try {
    const port = await pickPort(prefs().lan.port, '换一个端口再试。');
    freshPairing();
    const s = http.createServer((req, res) => {
      handle(req, res).catch((error) => {
        console.error('[lan]', error);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
    });
    s.on('upgrade', (req, socket, head) => void upgrade(req, socket, head).catch(() => socket.destroy()));
    // 慢速连接不能一直占着
    s.headersTimeout = 20_000;
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, BIND, () => resolve());
    });
    server = s;
    awake ??= powerSaveBlocker.start('prevent-app-suspension');
    if (port !== prefs().lan.port) await setPrefs({ lan: { ...prefs().lan, port } });
  } catch (error) {
    lastError = (error as UserError).message;
    throw error;
  } finally {
    await publish();
  }
}

export async function closeLan(): Promise<void> {
  const s = server;
  server = null;
  if (awake !== null) powerSaveBlocker.stop(awake);
  awake = null;
  if (s) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  await saveSeen();
  await publish();
}

export async function setLanAddress(address: string | null): Promise<LanStatus> {
  await setPrefs({ lan: { ...prefs().lan, address } });
  await publish();
  return lanStatus();
}

export async function renewPairing(): Promise<LanStatus> {
  freshPairing();
  await publish();
  return lanStatus();
}

export async function removeDevice(id: string): Promise<LanStatus> {
  await setPrefs({ lan: { ...prefs().lan, devices: prefs().lan.devices.filter((d) => d.id !== id) } });
  seen.delete(id);
  // 已经建立的长连接也断开
  server?.closeAllConnections();
  await publish();
  return lanStatus();
}

async function saveSeen(): Promise<void> {
  if (!seen.size) return;
  await setPrefs({ lan: { ...prefs().lan, devices: prefs().lan.devices.map((d) => ({ ...d, lastSeen: seen.get(d.id) ?? d.lastSeen })) } });
}

// —— 配对 ——

function deviceName(ua: string): string {
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  const android = /Android [\d.]+; ([^;)]+?)(?: Build|\)|;)/.exec(ua)?.[1]?.trim();
  if (/Android/.test(ua)) return android && android !== 'K' ? android : '安卓手机';
  if (/HarmonyOS|OpenHarmony/.test(ua)) return '鸿蒙手机';
  if (/Windows/.test(ua)) return 'Windows 电脑';
  if (/Macintosh/.test(ua)) return 'Mac 或 iPad';
  return '浏览器';
}

const cookieOf = (req: http.IncomingMessage, name: string) =>
  (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

function deviceOf(req: http.IncomingMessage): LanDevice | null {
  const [id, secret] = (cookieOf(req, COOKIE) ?? '').split('.');
  if (!id || !secret) return null;
  const device = prefs().lan.devices.find((d) => d.id === id);
  return device && same(device.tokenHash, sha(secret)) ? device : null;
}

async function enroll(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const known = deviceOf(req);
  if (known) {
    redirect(res, '/');
    return;
  }
  const id = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  const now = Date.now();
  const device: LanDevice = { id, name: deviceName(req.headers['user-agent'] ?? ''), tokenHash: sha(secret), createdAt: now, lastSeen: now };
  seen.set(id, now);
  await setPrefs({ lan: { ...prefs().lan, devices: [...prefs().lan.devices, device] } });
  // 配对码只用一次
  freshPairing();
  res.setHeader('Set-Cookie', `${COOKIE}=${id}.${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_AGE}`);
  redirect(res, '/');
  await publish();
}

function throttled(address: string): boolean {
  const m = misses.get(address);
  return Boolean(m && m.count >= 5 && m.until > Date.now());
}

function miss(address: string): void {
  const now = Date.now();
  const m = misses.get(address);
  misses.set(address, { count: m && m.until > now ? m.count + 1 : 1, until: now + 5 * 60_000 });
  // 换着地址猜也不行
  const total = [...misses.values()].filter((x) => x.until > now).reduce((n, x) => n + x.count, 0);
  if (total > 20) freshPairing();
}

// —— 请求处理 ——

const redirect = (res: http.ServerResponse, to: string) => res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' }).end();

const html = (res: http.ServerResponse, status: number, body: string) =>
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'",
  }).end(body);

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

const wantsHtml = (req: http.IncomingMessage) => req.method === 'GET' && /text\/html/.test(req.headers.accept ?? '');

async function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += (chunk as Buffer).toString('utf8');
    if (body.length > limit) throw new Error('请求过大');
  }
  return body;
}

/** 写操作必须从自己的页面发出 */
const ownOrigin = (req: http.IncomingMessage) => {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
};

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const remote = req.socket.remoteAddress ?? '';
  if (!isPrivateAddress(remote)) return void res.writeHead(403).end();
  const url = new URL(req.url ?? '/', 'http://x');
  const device = deviceOf(req);
  if (device) {
    const was = seen.get(device.id) ?? 0;
    seen.set(device.id, Date.now());
    if (Date.now() - was > 60_000) void publish();
  }

  if (url.pathname.startsWith(`${BASE}/p/`)) {
    const token = url.pathname.slice(BASE.length + 3);
    if (throttled(remote)) return void html(res, 429, codePage('试得太多了，过几分钟再来。'));
    if (pairing.expires > Date.now() && same(sha(token), sha(pairing.token))) return enroll(req, res);
    if (device) return void redirect(res, '/');
    miss(remote);
    return void html(res, 403, codePage('这个二维码过期了，在电脑上的掌柜里看一眼新的。'));
  }
  if (url.pathname === `${BASE}/pair` && req.method === 'POST') {
    if (!ownOrigin(req)) return void res.writeHead(403).end();
    if (throttled(remote)) return void html(res, 429, codePage('试得太多了，过几分钟再来。'));
    const code = new URLSearchParams(await readBody(req)).get('code')?.replace(/\D/g, '') ?? '';
    if (pairing.expires > Date.now() && same(sha(code), sha(pairing.code))) return enroll(req, res);
    miss(remote);
    return void html(res, 403, codePage('配对码不对。'));
  }
  if (!device) {
    if (wantsHtml(req)) return void html(res, 401, codePage());
    return void res.writeHead(401).end();
  }

  if (url.pathname === `${BASE}/state`) {
    return void json(res, 200, { phase: tavernProcess.view().phase, stale: (loaded.get(device.id) ?? Infinity) < settingsEpoch() });
  }
  if (url.pathname === `${BASE}/start` && req.method === 'POST') {
    if (!ownOrigin(req)) return void res.writeHead(403).end();
    if (!tavernProcess.running) void tavernProcess.start().catch(() => undefined);
    return void json(res, 200, { ok: true });
  }
  if (url.pathname === `${BASE}/phone.js`) {
    return void res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(INJECT);
  }
  if (url.pathname.startsWith(BASE)) return void redirect(res, '/');

  if (!tavernProcess.running) {
    if (wantsHtml(req)) return void html(res, 503, offlinePage());
    return void res.writeHead(503).end();
  }

  // 手机上的页面打开得比设置旧，保存会把电脑上刚改的盖掉
  if (url.pathname === '/api/settings/get') loaded.set(device.id, settingsEpoch());
  if (url.pathname === '/api/settings/save' && (loaded.get(device.id) ?? 0) < settingsEpoch()) {
    req.resume();
    return void json(res, 409, { error: '设置在电脑上改过，请刷新页面' });
  }
  await forward(req, res, url);
}

const DROP = /^(host|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|x-forwarded-.*|x-real-ip|forwarded|cf-.*)$/i;

interface Target {
  secure: boolean;
  port: number;
  auth: string | null;
}

let cached: { pid: number | null; target: Target } | null = null;

/** 酒馆的配置只在启动时读一次，同一个进程不用反复解析。打开一次页面有几百个请求。 */
async function target(): Promise<Target> {
  const view = tavernProcess.view();
  if (cached?.pid === view.pid) return cached.target;
  const config = view.instance ? await readConfig(view.instance) : null;
  const target: Target = {
    secure: view.url?.startsWith('https:') ?? false,
    port: view.port ?? 8000,
    auth: config?.listen && config.basicAuthMode ? `Basic ${Buffer.from(`${config.basicAuthUser}:${config.basicAuthPassword}`).toString('base64')}` : null,
  };
  cached = { pid: view.pid, target };
  return target;
}

/** 换成本机地址发给酒馆，它看到的就是一次普通的本机访问。 */
function upstreamHeaders(req: http.IncomingMessage, t: Target, keepUpgrade = false): http.OutgoingHttpHeaders {
  const host = `127.0.0.1:${t.port}`;
  const self = `${t.secure ? 'https' : 'http'}://${host}`;
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && (!DROP.test(k) || (keepUpgrade && /^(connection|upgrade)$/i.test(k)))) headers[k] = v;
  headers.host = host;
  const mine = `http://${req.headers.host}`;
  for (const k of ['origin', 'referer']) {
    const v = headers[k];
    if (typeof v === 'string' && v.startsWith(mine)) headers[k] = self + v.slice(mine.length);
  }
  const cookies = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).filter((c) => c && !c.startsWith(`${COOKIE}=`)).join('; ');
  if (cookies) headers.cookie = cookies;
  else delete headers.cookie;
  if (t.auth) headers.authorization = t.auth;
  return headers;
}

async function forward(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const t = await target();
  const page = req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html');
  const headers = upstreamHeaders(req, t);
  // 首页要插一段脚本，让酒馆不要压缩，也不要回 304
  if (page) {
    headers['accept-encoding'] = 'identity';
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
  }
  await new Promise<void>((resolve) => {
    const up = (t.secure ? https : http).request(
      // 原样转发，不经 URL 解析再拼，免得转义变样
      { host: '127.0.0.1', port: t.port, method: req.method, path: req.url?.startsWith('/') ? req.url : url.pathname + url.search, headers, rejectUnauthorized: false },
      (r) => {
        const out: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !/^(connection|keep-alive|transfer-encoding)$/i.test(k)) out[k] = v;
        const location = r.headers.location;
        if (location) out.location = location.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/, '');
        if (page && r.statusCode === 200 && /text\/html/.test(String(r.headers['content-type'] ?? ''))) {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8').replace('</head>', `<script src="${BASE}/phone.js" defer></script></head>`);
            delete out['content-length'];
            delete out.etag;
            out['cache-control'] = 'no-store';
            res.writeHead(200, out).end(body);
          });
        } else {
          res.writeHead(r.statusCode ?? 502, out);
          r.pipe(res);
        }
        r.once('close', resolve);
        r.once('error', () => {
          res.destroy();
          resolve();
        });
      },
    );
    up.once('error', () => {
      if (!res.headersSent) {
        if (wantsHtml(req)) html(res, 503, offlinePage());
        else res.writeHead(502).end();
      } else res.destroy();
      resolve();
    });
    // 手机中途关页面，酒馆那边的生成也要跟着停
    res.once('close', () => {
      if (!res.writableFinished) up.destroy();
    });
    req.pipe(up);
  });
}

async function upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  if (!isPrivateAddress(req.socket.remoteAddress ?? '') || !deviceOf(req) || !tavernProcess.running) return void socket.destroy();
  const t = await target();
  const up = (t.secure ? https : http).request({ host: '127.0.0.1', port: t.port, method: 'GET', path: req.url, headers: upstreamHeaders(req, t, true), rejectUnauthorized: false });
  up.once('upgrade', (r, upSocket, upHead) => {
    const lines = Object.entries(r.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]));
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
    upSocket.once('error', () => socket.destroy());
    socket.once('error', () => upSocket.destroy());
  });
  up.once('response', () => socket.destroy());
  up.once('error', () => socket.destroy());
  up.end();
}

// —— 防火墙 ——

const RULE = 'Innkeeper LAN';

/** 有没有给掌柜放行。查不到只说明没有我们加的规则，不代表一定连不上。 */
export async function firewallOpen(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const { code } = await exec('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`], { timeoutMs: 8000 }).catch(() => ({ code: 1 }));
  return code === 0;
}

/**
 * 放行手机连接的端口，只对同一网段的设备开放。会弹出系统的管理员确认。
 * 首次监听时如果在系统提示里点过取消，Windows 会留下一条拦截规则，也一并去掉。
 */
export async function allowFirewall(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = [
    `$exe = ${quote(process.execPath)}`,
    'Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq "Inbound" -and $_.Action -eq "Block" } | Remove-NetFirewallRule -ErrorAction SilentlyContinue',
    `Remove-NetFirewallRule -DisplayName ${quote(RULE)} -ErrorAction SilentlyContinue`,
    `New-NetFirewallRule -DisplayName ${quote(RULE)} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${prefs().lan.port} -RemoteAddress LocalSubnet -Profile Any -Program $exe | Out-Null`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await exec('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'`,
  ], { timeoutMs: 120_000 });
  const ok = await firewallOpen();
  if (!ok) throw new UserError('没有放行成功', '需要在弹出的管理员确认里点「是」。');
  return ok;
}
