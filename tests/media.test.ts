import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => '0', getAppPath: () => os.tmpdir(), isPackaged: false },
  net: {}, session: {}, shell: {}, dialog: {}, nativeImage: {}, nativeTheme: {}, powerSaveBlocker: {}, BrowserWindow: class {}, WebContentsView: class {},
}));

import { ENGINE_MODELS, kitKey, mentionsMinor, MINOR_GUARD, ratingOf, sameStyle, STYLE_PRESETS, withRating } from '../src/shared/catalog/imagegen';
import { CHAT_MODELS } from '../src/shared/catalog/llm';
import { PROVIDERS } from '../src/shared/catalog/providers';
import { VIDEO_MODELS, videoWorkflow, videoWorkflowFile } from '../src/shared/catalog/video';
import { KOKORO_SIDS, KOKORO_VOICES, VOICE_BACKENDS } from '../src/shared/catalog/voice';
import { carryOver, unpack7z } from '../src/main/features/comfy';
import { isPrivateAddress, lanAddresses } from '../src/main/features/lan';
import { fillWorkflow } from '../src/main/features/workflow';

let dir = '';
beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'innkeeper-media-'));
});
afterAll(() => fsp.rm(dir, { recursive: true, force: true }));

describe('分级', () => {
  const anime = STYLE_PRESETS.find((s) => s.id === 'anime')!;
  const pony = STYLE_PRESETS.find((s) => s.id === 'pony')!;

  it('三档来回切换不会越积越多', () => {
    let { prefix, negative } = anime;
    for (const r of ['explicit', 'safe', 'free', 'explicit', 'explicit', 'safe', 'free'] as const) {
      ({ prefix, negative } = withRating(prefix, negative, r));
      expect(ratingOf(prefix, negative)).toBe(r);
      expect(sameStyle(anime, prefix, negative)).toBe(true);
    }
    expect(prefix.split(',').length).toBe(anime.prefix.split(',').length);
  });

  it('成人档的负面提示词固定排除未成年相关内容', () => {
    for (const s of STYLE_PRESETS) {
      const { negative } = withRating(s.prefix, s.negative, 'explicit');
      const list = negative.split(',').map((t) => t.trim());
      for (const t of MINOR_GUARD) expect(list).toContain(t);
    }
  });

  it('Pony 用它自己的分级词', () => {
    expect(withRating(pony.prefix, pony.negative, 'explicit').prefix).toContain('rating_explicit');
    expect(withRating(pony.prefix, pony.negative, 'safe').prefix).toContain('rating_safe');
  });

  it('认得出与未成年人有关的描述，不误伤成年角色', () => {
    for (const bad of ['1girl, loli', 'a 15 years old girl', '16岁少女', '小学生', 'little girl', 'underage', 'a 9yo']) expect(mentionsMinor(bad)).toBe(true);
    for (const ok of ['1girl, silver hair, tavern', 'a 25 years old woman', '三十岁的老板娘', 'kidney beans', 'mature woman', '18岁', 'childhood friend']) expect(mentionsMinor(ok)).toBe(false);
  });

  it('空前缀不会留下多余的逗号', () => {
    expect(withRating('', '', 'free')).toEqual({ prefix: '', negative: '' });
    expect(withRating('', '', 'safe').prefix).toBe('safe,');
  });
});

describe('目录', () => {
  it('对话模型与视频模型都带校验值', () => {
    for (const f of [...CHAT_MODELS.map((m) => m.remote), ...VIDEO_MODELS.flatMap((m) => m.parts)]) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.hfPath.endsWith(f.file)).toBe(true);
      if (f.msPath) expect(f.msPath).toContain('/resolve/master/');
    }
  });

  it('同名文件在各处是同一个', () => {
    const seen = new Map<string, string>();
    for (const p of [...ENGINE_MODELS.flatMap((m) => m.parts ?? []), ...VIDEO_MODELS.flatMap((m) => m.parts)]) {
      if (seen.has(p.file)) expect(seen.get(p.file)).toBe(p.sha256);
      seen.set(p.file, p.sha256);
    }
  });

  it('推荐参数指向存在的画风', () => {
    for (const m of ENGINE_MODELS) expect(STYLE_PRESETS.some((s) => s.id === m.recommend.style)).toBe(true);
    expect(new Set(ENGINE_MODELS.map(kitKey)).size).toBe(ENGINE_MODELS.length);
  });

  it('没开成人内容时，画图和对话都还有能用的模型', () => {
    expect(ENGINE_MODELS.filter((m) => !m.adult).length).toBeGreaterThan(2);
    expect(CHAT_MODELS.filter((m) => !m.adult).length).toBeGreaterThan(0);
    expect(PROVIDERS.filter((p) => p.adultOnly).every((p) => p.adult)).toBe(true);
  });

  it('语音音色与引擎编号一一对应', () => {
    expect(KOKORO_VOICES.length).toBe(103);
    expect(new Set(Object.values(KOKORO_SIDS)).size).toBe(103);
    expect(KOKORO_SIDS['英文女声Maple']).toBe(0);
    expect(KOKORO_SIDS['女声001']).toBe(3);
    expect(KOKORO_SIDS['男声100']).toBe(102);
    // 酒馆用逗号分隔音色列表
    for (const b of VOICE_BACKENDS) for (const v of b.voices) expect(v.id).not.toContain(',');
  });
});

describe('视频工作流', () => {
  it('填完占位符是合法 JSON，参数不被酒馆的画图设置带跑', () => {
    for (const m of VIDEO_MODELS) {
      const flow = videoWorkflow(m, { orientation: 'portrait', frames: m.lengths[0]!.frames }, false);
      const text = fillWorkflow(JSON.stringify(flow), {
        prompt: '她说："你好"\n换行', negative_prompt: 'x', model: 'm', sampler: 'euler', scheduler: 'normal', steps: 99, scale: 99, width: 99, height: 99, seed: 7, clip_skip: 1,
      });
      const json = JSON.parse(text);
      expect(json['5'].inputs.text).toBe('她说："你好"\n换行');
      expect(json['8'].inputs.seed).toBe(7);
      expect(json['8'].inputs.steps).toBe(m.steps);
      expect(json['7'].inputs.width).toBe(m.sizes.portrait[0]);
      // 起始画面由酒馆按自定义占位符填，掌柜的扩展在拍之前临时放进去
      expect(text.replaceAll('"%innkeeper_frame%"', '""')).not.toMatch(/%[a-z_]+%/);
      expect(videoWorkflowFile(m)).toMatch(/^掌柜_视频_[\w.-]+(_图生)?\.json$/);
    }
  });

  it('帧数与尺寸符合模型要求', () => {
    for (const m of VIDEO_MODELS) {
      for (const l of m.lengths) expect((l.frames - 1) % 4).toBe(0);
      for (const s of Object.values(m.sizes)) for (const n of s) expect(n % m.step).toBe(0);
    }
  });

  it('成人内容打开时，负面提示词排除未成年人', () => {
    const text = (adult: boolean) => String(videoWorkflow(VIDEO_MODELS[0]!, { orientation: 'portrait', frames: 17 }, adult)['6']!.inputs.text);
    expect(text(true)).toContain('未成年');
  });
});

describe('局域网地址', () => {
  it('只认内网地址', () => {
    for (const ok of ['192.168.1.5', '10.0.0.2', '172.16.0.1', '172.31.9.9', '127.0.0.1', '::1', '::ffff:192.168.0.3', 'fe80::1', 'fd00::2', '100.64.1.1', '169.254.3.3']) expect(isPrivateAddress(ok)).toBe(true);
    for (const no of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '100.128.0.1', '2001:db8::1', '', 'abc', '1.2.3', '::ffff:1.1.1.1']) expect(isPrivateAddress(no)).toBe(false);
  });

  it('真实网卡排在虚拟网卡前面，代理的假地址不列', () => {
    const v4 = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '255.255.255.0', mac: '', cidr: null });
    const list = lanAddresses({
      Meta: [v4('198.18.0.1')],
      'vEthernet (WSL)': [v4('172.20.16.1')],
      'VMware Network Adapter VMnet8': [v4('192.168.88.1')],
      以太网: [v4('10.1.2.3')],
      WLAN: [v4('192.168.31.77')],
      蓝牙网络连接: [v4('169.254.9.9')],
      Loopback: [v4('127.0.0.1', true)],
    });
    expect(list[0]!.address).toBe('192.168.31.77');
    expect(list[1]!.address).toBe('10.1.2.3');
    expect(list.slice(2).every((a) => a.virtual)).toBe(true);
    expect(list.some((a) => /^(198\.18|169\.254|127)\./.test(a.address))).toBe(false);
  });
});

describe.runIf(process.platform === 'win32')('ComfyUI 安装', () => {
  it('系统自带的 tar 能解 7z，进度走到头', async (ctx) => {
    const src = path.join(dir, 'src', 'ComfyUI_windows_portable', 'ComfyUI');
    await fsp.mkdir(src, { recursive: true });
    for (let i = 0; i < 40; i++) await fsp.writeFile(path.join(src, `中文 名字${i}.txt`), `内容${i}`);
    const archive = path.join(dir, 'x.7z');
    // 打 7z 要 Windows 11 23H2 以上的 tar；CI 的 Windows Server 上一打就崩，那里测不了，掌柜运行时会改用 7-Zip
    try {
      execFileSync(path.join(process.env.SystemRoot!, 'System32', 'tar.exe'), ['-a', '-cf', archive, '-C', path.join(dir, 'src'), 'ComfyUI_windows_portable']);
    } catch {
      ctx.skip();
    }
    const out = path.join(dir, 'out');
    await fsp.mkdir(out);
    const seen: number[] = [];
    await unpack7z(archive, out, new AbortController().signal, (r) => seen.push(r));
    expect((await fsp.readdir(path.join(out, 'ComfyUI_windows_portable', 'ComfyUI'))).length).toBe(40);
    expect(seen.at(-1)).toBeGreaterThan(0.95);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it('坏的压缩包报错', async () => {
    const bad = path.join(dir, 'bad.7z');
    await fsp.writeFile(bad, 'not an archive');
    await expect(unpack7z(bad, dir, new AbortController().signal, () => undefined)).rejects.toThrow();
  });

  it('重装时保留模型、节点、工作流与出图，程序文件用新的', async () => {
    const put = async (base: string, files: Record<string, string>) => {
      for (const [f, text] of Object.entries(files)) {
        const full = path.join(base, f);
        await fsp.mkdir(path.dirname(full), { recursive: true });
        await fsp.writeFile(full, text);
      }
    };
    const old = path.join(dir, 'old');
    const fresh = path.join(dir, 'fresh');
    await put(old, {
      'main.py': '旧程序', 'models/checkpoints/mine.safetensors': '我的模型', 'custom_nodes/my-node/a.py': '我的节点',
      'user/default/workflows/w.json': '我的工作流', 'output/1.png': '我的图', 'models/checkpoints/put_checkpoints_here': '旧',
    });
    await put(fresh, { 'main.py': '新程序', 'models/checkpoints/put_checkpoints_here': '新', 'custom_nodes/websocket_image_save.py': '新节点' });
    await carryOver(old, fresh);
    const read = (f: string) => fs.readFileSync(path.join(fresh, f), 'utf8');
    expect(read('main.py')).toBe('新程序');
    expect(read('models/checkpoints/mine.safetensors')).toBe('我的模型');
    expect(read('custom_nodes/my-node/a.py')).toBe('我的节点');
    expect(read('custom_nodes/websocket_image_save.py')).toBe('新节点');
    expect(read('user/default/workflows/w.json')).toBe('我的工作流');
    expect(read('output/1.png')).toBe('我的图');
  });
});
