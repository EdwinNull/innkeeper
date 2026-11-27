import { net } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import isoGit, { type HttpClient } from 'isomorphic-git';
import { CancelledError, UserError } from './errors';
import { exec } from './exec';
import { exists, removeDir } from './fsx';
import { githubCandidates, hostOf, proxyFor } from './net';
import { findGit } from './runtime';

/** 给内置 git 用的 HTTP 客户端，走 Chromium 网络栈，自动遵循代理。 */
const http: HttpClient = {
  async request({ url, method = 'GET', headers = {}, body }) {
    const chunks: Uint8Array[] = [];
    if (body) for await (const chunk of body) chunks.push(chunk);
    const res = await net.fetch(url, {
      method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      bypassCustomProtocolHandlers: true,
    });
    const payload = new Uint8Array(await res.arrayBuffer());
    return {
      url: res.url || url,
      method,
      headers: Object.fromEntries(res.headers),
      statusCode: res.status,
      statusMessage: res.statusText,
      body: (async function* () {
        yield payload;
      })(),
    };
  },
};

async function gitArgs(url: string): Promise<string[]> {
  const proxy = await proxyFor(url);
  return ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', ...(proxy ? ['-c', `http.proxy=${proxy}`] : [])];
}

const gitEnv = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

/** 候选地址：国内镜像仓库、GitHub 加速前缀、直连。 */
export async function cloneCandidates(repo: string, mirrors: string[] = []): Promise<string[]> {
  const accelerated = await githubCandidates(repo);
  return [...new Set([...accelerated.filter((u) => u !== repo), ...mirrors, repo])];
}

export interface CloneOptions {
  branch?: string;
  signal: AbortSignal;
  onLine?: (line: string) => void;
  onSource?: (host: string) => void;
}

/** 浅克隆到 dest。成功后 origin 指回原仓库，酒馆自带的更新按钮照常可用。 */
export async function cloneRepo(repo: string, mirrors: string[], dest: string, options: CloneOptions): Promise<void> {
  const git = await findGit();
  const failures: string[] = [];
  for (const url of await cloneCandidates(repo, mirrors)) {
    if (options.signal.aborted) throw new CancelledError();
    await removeDir(dest);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    options.onSource?.(hostOf(url));
    try {
      if (git) {
        const branch = options.branch ? ['--branch', options.branch] : [];
        const { code, output } = await exec(
          git.path,
          [...(await gitArgs(url)), 'clone', '--depth', '1', '--single-branch', '--no-tags', '--progress', ...branch, url, dest],
          { signal: options.signal, onLine: options.onLine, env: gitEnv, timeoutMs: 180_000 },
        );
        if (code !== 0) throw new Error(lastMeaningfulLine(output));
        if (url !== repo) await exec(git.path, ['remote', 'set-url', 'origin', repo], { cwd: dest });
      } else {
        await isoGit.clone({
          fs, http, dir: dest, url, ref: options.branch, singleBranch: true, depth: 1, noTags: true,
          onProgress: (e) => {
            if (e.total) options.onLine?.(`${e.phase}: ${Math.round((e.loaded / e.total) * 100)}%`);
          },
        });
        if (url !== repo) await isoGit.addRemote({ fs, dir: dest, remote: 'origin', url: repo, force: true });
      }
      return;
    } catch (error) {
      if (error instanceof CancelledError || options.signal.aborted) throw new CancelledError();
      failures.push(`${hostOf(url)}：${(error as Error).message}`);
      options.onLine?.(`${hostOf(url)} 失败，换下一条线路`);
    }
  }
  await removeDir(dest);
  throw new UserError('仓库克隆失败', failures.slice(0, 3).join('；'));
}

function lastMeaningfulLine(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => /fatal|error|remote:/i.test(l));
  return lines.at(-1) ?? '未知错误';
}

export interface RepoState {
  remote: string;
  branch: string;
  commit: string;
}

/** 直接读 .git 文件，不依赖 git 可执行文件，列表页要快。 */
export async function readRepoState(dir: string): Promise<RepoState | null> {
  const gitDir = path.join(dir, '.git');
  if (!exists(gitDir)) return null;
  try {
    const head = (await fsp.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
    let branch = '';
    let commit = head;
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      branch = ref.replace(/^refs\/heads\//, '');
      const loose = path.join(gitDir, ...ref.split('/'));
      if (exists(loose)) commit = (await fsp.readFile(loose, 'utf8')).trim();
      else {
        const packed = await fsp.readFile(path.join(gitDir, 'packed-refs'), 'utf8').catch(() => '');
        commit = packed.split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] ?? '';
      }
    }
    const config = await fsp.readFile(path.join(gitDir, 'config'), 'utf8').catch(() => '');
    const remote = /\[remote "origin"\][^[]*?url\s*=\s*(.+)/.exec(config)?.[1]?.trim() ?? '';
    return { remote, branch, commit };
  } catch {
    return null;
  }
}

/** 查询远端分支头。失败返回 null，由调用方决定怎么提示。 */
export async function remoteHead(repo: string, branch: string, mirrors: string[], signal?: AbortSignal): Promise<string | null> {
  const git = await findGit();
  for (const url of (await cloneCandidates(repo, mirrors)).slice(0, 3)) {
    try {
      if (git) {
        const { code, output } = await exec(git.path, [...(await gitArgs(url)), 'ls-remote', url, branch ? `refs/heads/${branch}` : 'HEAD'], {
          timeoutMs: 15_000,
          signal,
          env: gitEnv,
        });
        const hash = /^([0-9a-f]{40})\s/m.exec(output)?.[1];
        if (code === 0 && hash) return hash;
      } else {
        const refs = await isoGit.listServerRefs({ http, url, prefix: branch ? `refs/heads/${branch}` : 'HEAD' });
        const hit = refs.find((r) => r.ref === (branch ? `refs/heads/${branch}` : 'HEAD'));
        if (hit) return hit.oid;
      }
    } catch (error) {
      if (error instanceof CancelledError) throw error;
    }
  }
  return null;
}

/** 把已有仓库更新到远端最新，走加速线路但不改 origin。 */
export async function updateRepo(dir: string, mirrors: string[], options: CloneOptions): Promise<void> {
  const state = await readRepoState(dir);
  if (!state?.remote) throw new UserError('这个目录不是 git 仓库，没法更新');
  const git = await findGit();
  if (!git) {
    const staging = `${dir}.update`;
    await cloneRepo(state.remote, mirrors, staging, { ...options, branch: state.branch || undefined });
    await removeDir(dir);
    await fsp.rename(staging, dir);
    return;
  }
  const failures: string[] = [];
  for (const url of await cloneCandidates(state.remote, mirrors)) {
    if (options.signal.aborted) throw new CancelledError();
    options.onSource?.(hostOf(url));
    const ref = state.branch || 'HEAD';
    const fetched = await exec(git.path, [...(await gitArgs(url)), 'fetch', '--depth', '1', '--progress', url, ref], {
      cwd: dir,
      signal: options.signal,
      onLine: options.onLine,
      env: gitEnv,
      timeoutMs: 180_000,
    });
    if (fetched.code === 0) {
      const reset = await exec(git.path, ['reset', '--hard', 'FETCH_HEAD'], { cwd: dir, signal: options.signal, onLine: options.onLine });
      if (reset.code !== 0) throw new UserError('更新失败', lastMeaningfulLine(reset.output));
      return;
    }
    failures.push(`${hostOf(url)}：${lastMeaningfulLine(fetched.output)}`);
  }
  throw new UserError('更新失败', failures.slice(0, 3).join('；'));
}
