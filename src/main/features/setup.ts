import fsp from 'node:fs/promises';
import path from 'node:path';
import { extensionById } from '@shared/catalog/extensions';
import { imageBackendById } from '@shared/catalog/imagegen';
import type { SetupPlan } from '@shared/types';
import { UserError } from '../core/errors';
import { prefs, setPrefs } from '../core/store';
import { hasRunning, startTask } from '../core/tasks';
import { adopt, INSTALL_STEPS, installedVersions, latestVersion, runInstall } from '../tavern/install';
import { ensureUserDir, inspectTavern, requireInstance } from '../tavern/instance';
import { tavernProcess } from '../tavern/process';
import { openTavern } from '../tavern/window';
import { installStarter, listStarters } from './characters';
import { runInstallMany } from './extensions';
import { saveImageKey, selectBackend } from './imagegen';
import { saveConnection, writeGeneration } from './models';

/** 一键配置：按计划把所有步骤串起来。可选项失败只记录，不影响酒馆可用。 */
export function runSetup(plan: SetupPlan): string {
  if (hasRunning('setup')) throw new UserError('一键配置正在进行');
  const steps: { key: string; title: string }[] = [];
  if (plan.mode === 'managed') steps.push(...INSTALL_STEPS);
  else steps.push({ key: 'adopt', title: '接管已有酒馆' });
  steps.push({ key: 'profile', title: '写入基础设置' });
  if (plan.connection) steps.push({ key: 'model', title: '接入模型' });
  if (plan.imagegen) steps.push({ key: 'image', title: '配置生图' });
  for (const id of plan.extensions) {
    const item = extensionById(id);
    if (item) steps.push({ key: `ext:${id}`, title: `插件：${item.name}` });
  }
  for (const id of plan.starters) {
    const card = listStarters().find((s) => s.id === id);
    if (card) steps.push({ key: `card:${id}`, title: `角色：${card.name}` });
  }
  if (plan.launch) steps.push({ key: 'launch', title: '启动酒馆' });

  return startTask('setup', '一键配置', steps, async (task) => {
    const soft: string[] = [];
    const optional = async (key: string, label: string, fn: Parameters<typeof task.run>[1]) => {
      try {
        await task.run(key, fn);
      } catch (error) {
        if (task.signal.aborted) throw error;
        const e = error as UserError;
        task.log(`${label}：${e.message}${e.hint ? `（${e.hint}）` : ''}`);
        soft.push(label);
      }
    };

    if (plan.mode === 'managed') {
      const workspace = path.resolve(plan.workspace);
      if (/[\\/](program files|windows)([\\/]|$)/i.test(workspace)) {
        throw new UserError('不能装在系统目录里', '换到普通文件夹，例如 D:\\Innkeeper。');
      }
      await fsp.mkdir(workspace, { recursive: true });
      await setPrefs({ workspace, tavernMode: 'managed' });
      const have = await installedVersions();
      // 没指定版本就要最新版，已经装着最新版则不再重复下载
      const target = plan.version ?? (have.length ? await latestVersion() : null);
      if (target && have.includes(target)) {
        for (const s of INSTALL_STEPS) task.skip(s.key, '已经装好');
        await tavernProcess.stop();
        await setPrefs({ activeVersion: target });
        await tavernProcess.refresh();
      } else await runInstall(task, target, plan.userName);
    } else {
      await task.run('adopt', async (step) => {
        const root = plan.adoptedRoot;
        if (!root) throw new UserError('没有选择酒馆目录');
        const info = await inspectTavern(root);
        step.detail(info.message);
        await fsp.mkdir(path.resolve(plan.workspace), { recursive: true });
        await setPrefs({ workspace: path.resolve(plan.workspace) });
        await adopt(root);
      });
    }

    await task.run('profile', async (step) => {
      const instance = await requireInstance();
      await ensureUserDir(instance, plan.userName);
      if (plan.userName.trim()) await writeGeneration({ userName: plan.userName.trim(), autoConnect: true });
      step.detail(plan.userName.trim() ? `称呼：${plan.userName.trim()}` : '使用默认设置');
    });

    if (plan.connection) {
      const request = plan.connection;
      await optional('model', '模型接入', async (step) => {
        const c = await saveConnection({ ...request, activate: true });
        step.detail(`${c.label}，${c.model}`);
      });
    }

    if (plan.imagegen) {
      const { backendId, apiKey, url, model } = plan.imagegen;
      await optional('image', '生图', async (step) => {
        const backend = imageBackendById(backendId);
        if (!backend) throw new UserError('没有这个生图后端');
        if (apiKey.trim()) await saveImageKey(backendId, apiKey);
        await selectBackend(backendId, {
          ...(model ? { model } : {}),
          ...(url && backend.id === 'comfy' ? { comfyUrl: url } : {}),
          ...(url && backend.id === 'auto' ? { autoUrl: url } : {}),
          ...(backend.id === 'engine' ? { sdcppUrl: `http://127.0.0.1:${prefs().imagegen.enginePort}` } : {}),
        });
        step.detail(backend.name);
      });
    }

    soft.push(...(await runInstallMany(task, plan.extensions, (id) => `ext:${id}`)));

    for (const id of plan.starters) {
      await optional(`card:${id}`, `角色卡 ${id}`, async (step) => {
        try {
          step.detail((await installStarter(id)).name ?? '');
        } catch (error) {
          if (!(error instanceof UserError) || error.code !== 'duplicate') throw error;
          step.detail('已经有了');
        }
      });
    }

    await setPrefs({ onboarded: true });

    if (plan.launch) {
      await task.run('launch', async (step) => {
        step.detail('首次启动需要编译前端，大约半分钟');
        await tavernProcess.start();
        step.detail(tavernProcess.view().url ?? '');
        await openTavern();
      });
    }
    if (soft.length) task.log(`这些没有完成，可以稍后单独重试：${soft.join('、')}`);
  }).id;
}
