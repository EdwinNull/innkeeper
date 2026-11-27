import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IpcArgs, IpcChannel, IpcEnvelope, IpcResult } from '@shared/ipc';
import { describeError, UserError } from './core/errors';
import { applyProxy, resetMirrorRanking } from './core/net';
import { toolStatus } from './core/runtime';
import { listDrives, prefs, setPrefs, suggestWorkspace } from './core/store';
import { cancelTask, dismissTask, listTasks } from './core/tasks';
import * as appearance from './features/appearance';
import * as backup from './features/backup';
import * as chars from './features/characters';
import * as comfy from './features/comfy';
import * as engine from './features/engine';
import * as ext from './features/extensions';
import * as gsv from './features/gsv';
import * as hires from './features/hires';
import * as img from './features/imagegen';
import * as lan from './features/lan';
import * as llm from './features/llm';
import * as models from './features/models';
import { overview, reachability } from './features/overview';
import * as res from './features/resources';
import * as scene from './features/scene';
import { runSetup } from './features/setup';
import * as loras from './features/loras';
import * as video from './features/video';
import * as voice from './features/voice';
import * as clones from './features/voice-clone';
import { readConfig, readConfigText, writeConfig, writeConfigText } from './tavern/config';
import * as install from './tavern/install';
import { inspectTavern, requireInstance } from './tavern/instance';
import { tavernProcess } from './tavern/process';
import { listSecrets } from './tavern/userdata';
import { closeTavernWindow, openTavern, reloadTavernWindow } from './tavern/window';

type Awaitable<T> = T | Promise<T>;
type Handlers = { [K in IpcChannel]: (...args: IpcArgs<K>) => Awaitable<IpcResult<K>> };

/** 生图设置变了以后，高清修复和聊天配图都跟上。高清改不了也要让配图按钮指向新工作流。 */
async function afterImage(): Promise<void> {
  try {
    await hires.syncHires();
  } finally {
    await scene.syncScene();
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null, setTitlebarTone: (tone: 'auto' | 'onDark') => void): void {
  const handlers: Handlers = {
    // 应用
    'app:info': async () => ({
      version: app.getVersion(),
      platform: `${process.platform} ${process.getSystemVersion()}`,
      electron: process.versions.electron ?? '',
      suggestedWorkspace: await suggestWorkspace(),
      drives: await listDrives(),
    }),
    'app:prefs': () => prefs(),
    'app:setPrefs': async (patch) => {
      const next = await setPrefs(patch);
      if ('proxyMode' in patch || 'proxyUrl' in patch) {
        await applyProxy();
        resetMirrorRanking();
      }
      if ('githubMirror' in patch || 'githubMirrorCustom' in patch) resetMirrorRanking();
      // 视频工作流的负面提示词跟着成人内容开关走
      // 扩展里「动作描述提到未成年人就不拍」也跟着这个开关
      if ('adult' in patch) {
        await video.refreshVideoWorkflows().catch(() => undefined);
        await scene.syncScene().catch(() => undefined);
      }
      return next;
    },
    'app:pickDirectory': async ({ title, defaultPath }) => {
      const win = getWindow();
      const opts: Electron.OpenDialogOptions = { title, defaultPath, properties: ['openDirectory', 'createDirectory'] };
      const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return canceled ? null : (filePaths[0] ?? null);
    },
    'app:pickFiles': async ({ title, filters, multi }) => {
      const win = getWindow();
      const opts: Electron.OpenDialogOptions = { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] };
      const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return canceled ? [] : filePaths;
    },
    'app:openExternal': async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new UserError('只能打开网页链接');
      await shell.openExternal(url);
    },
    'app:reveal': async (target) => {
      const stat = await fsp.stat(target).catch(() => null);
      if (!stat) throw new UserError('路径不存在', target);
      if (stat.isDirectory()) await shell.openPath(path.resolve(target));
      else shell.showItemInFolder(path.resolve(target));
    },
    'app:tools': () => toolStatus(),
    'app:reach': () => reachability(),
    'app:overview': () => overview(),
    'app:titlebar': (tone) => setTitlebarTone(tone),

    // 任务
    'tasks:list': () => listTasks(),
    'tasks:cancel': (id) => cancelTask(id),
    'tasks:dismiss': (id) => dismissTask(id),

    // 一键配置
    'setup:run': (plan) => runSetup(plan),
    'setup:inspect': (dir) => inspectTavern(dir),

    // 酒馆本体
    'tavern:status': () => tavernProcess.refresh(),
    'tavern:versions': (refresh) => install.listVersions(refresh),
    'tavern:install': (version) => install.installVersion(version),
    'tavern:activate': (version) => install.activateVersion(version),
    'tavern:removeVersion': (version) => install.removeVersion(version),
    'tavern:updateAdopted': () => install.updateAdopted(),
    'tavern:repair': () => install.repairInstall(),
    'tavern:start': () => tavernProcess.start(),
    'tavern:stop': () => {
      closeTavernWindow();
      return tavernProcess.stop();
    },
    'tavern:restart': async () => {
      const status = await tavernProcess.restart();
      reloadTavernWindow();
      return status;
    },
    'tavern:open': (where) => openTavern(where),
    'tavern:logs': () => tavernProcess.logs(),
    'tavern:clearLogs': () => tavernProcess.clearLogs(),
    'tavern:config': async () => readConfig(await requireInstance()),
    'tavern:setConfig': async (patch) => {
      const instance = await requireInstance();
      await writeConfig(instance, patch);
      return readConfig(instance);
    },
    'tavern:configText': async () => readConfigText(await requireInstance()),
    'tavern:setConfigText': async (text) => writeConfigText(await requireInstance(), text),
    'tavern:adopt': (dir) => install.adopt(dir),
    'tavern:useManaged': () => install.useManaged(),

    // 模型接入
    'models:probe': (req) => models.probe(req),
    'models:hints': (id) => models.modelHints(id),
    'models:save': (req) => models.saveConnection(req),
    'models:activate': (id) => models.activateConnection(id),
    'models:remove': (id) => models.removeConnection(id),
    'models:check': (id) => models.checkConnection(id),
    'models:secrets': async () => listSecrets(await requireInstance()),
    'models:generation': () => models.readGeneration(),
    'models:setGeneration': (patch) => models.writeGeneration(patch),

    // 本机对话引擎
    'llm:status': () => llm.chatEngineStatus(),
    'llm:install': () => llm.installChatEngine(),
    'llm:download': (id) => llm.downloadChatModel(id),
    'llm:import': (p) => llm.importChatModel(p),
    'llm:remove': (file) => llm.removeChatModel(file),
    'llm:start': (file) => llm.startChatEngine(file),
    'llm:stop': () => llm.stopChatEngine(),

    // 视频
    'video:status': () => video.videoStatus(),
    'video:download': (id) => video.downloadVideoModel(id),
    'video:workflow': (id, o) => video.writeVideoWorkflow(id, o),
    'video:use': (id) => video.useVideoWorkflow(id),
    'video:buttons': (mode, id) => video.setVideoButtons(mode, id),
    'video:every': (n) => video.setAnimateEvery(n),
    'video:animate': (id, dataUrl, prompt) => video.animateTest(id, dataUrl, prompt),
    'video:restartComfy': () => video.restartForNodes(),

    // 配音
    'voice:view': () => voice.readVoice(),
    'voice:set': (patch) => voice.writeVoice(patch),
    'voice:select': (id) => voice.selectVoiceBackend(id),
    'voice:saveKey': (id, key) => voice.saveVoiceKey(id, key),
    'voice:test': (text, v) => voice.testVoice(text, v),
    'voice:engine': () => voice.voiceEngineStatus(),
    'voice:install': () => voice.installVoice(),
    'voice:start': () => voice.startVoice(),
    'voice:stop': () => voice.stopVoice(),
    'voice:installEdge': () => voice.installEdge(),
    'voice:clones': () => clones.listClones(),
    'voice:addClone': async (req) => {
      const list = await clones.addClone(req);
      await voice.syncCloneVoices();
      voice.wakeGsv();
      return list;
    },
    'voice:removeClone': async (id) => {
      const list = await clones.removeClone(id);
      await voice.syncCloneVoices();
      return list;
    },
    'gsv:status': () => gsv.gsvStatus(),
    'gsv:install': () => gsv.installGsv(),
    'gsv:bind': (dir) => gsv.bindGsv(dir),
    'gsv:start': async () => {
      await voice.ensureGsv();
      return gsv.gsvStatus();
    },
    'gsv:stop': () => gsv.stopGsv(),
    'voice:cloneAudio': (id) => clones.cloneAudio(id),
    'voice:readAudioFile': async (p) => {
      // 只给界面解码用：限定常见音频格式和大小
      if (!/\.(wav|mp3|m4a|aac|ogg|opus|flac|webm)$/i.test(p)) throw new UserError('不支持这种文件', '用 wav、mp3、m4a、ogg 或 flac。');
      const stat = await fsp.stat(p);
      if (stat.size > 30 * 1024 ** 2) throw new UserError('文件太大', '剪出几秒钟的一句话就够了。');
      return (await fsp.readFile(p)).toString('base64');
    },

    // 手机连接
    'lan:status': () => lan.lanStatus(),
    'lan:set': (enabled) => lan.setLan(enabled),
    'lan:address': (address) => lan.setLanAddress(address),
    'lan:renew': () => lan.renewPairing(),
    'lan:removeDevice': (id) => lan.removeDevice(id),
    'lan:firewall': () => lan.firewallOpen(),
    'lan:allowFirewall': () => lan.allowFirewall(),

    // 插件
    'ext:list': () => ext.listExtensions(),
    'ext:install': (req) => ext.installExtension(req),
    'ext:installMany': (ids) => ext.installMany(ids),
    'ext:setEnabled': (folder, enabled) => ext.setExtensionEnabled(folder, enabled),
    'ext:remove': (folder, scope) => ext.removeExtension(folder, scope),
    'ext:checkUpdates': () => ext.checkUpdates(),
    'ext:update': (folders) => ext.updateExtensions(folders),
    'ext:officialCatalog': () => ext.officialCatalog(),

    // 角色卡
    'chars:list': () => chars.listCharacters(),
    'chars:detail': (file) => chars.characterDetail(file),
    'chars:importFiles': (paths) => chars.importFiles(paths),
    'chars:importUrl': (url) => chars.importUrl(url),
    'chars:update': (file, patch) => chars.updateCharacter(file, patch),
    'chars:setAvatar': (file, image) => chars.setAvatar(file, image),
    'chars:create': (patch) => chars.createCharacter(patch),
    'chars:duplicate': (file) => chars.duplicateCharacter(file),
    'chars:export': (file, format) => chars.exportCharacter(file, format),
    'chars:remove': (files) => chars.removeCharacters(files),
    'chars:setFav': (file, fav) => chars.setCharacterFav(file, fav),
    'chars:extractBook': (file) => chars.extractBook(file),
    'chars:appearance': (file) => appearance.readAppearance(file),
    'chars:setAppearance': async (file, a) => {
      const saved = await appearance.saveAppearance(file, a);
      // 外貌里加了或去掉 <lora:…>，ComfyUI 的画图工作流要跟着换
      await afterImage().catch(() => undefined);
      return saved;
    },
    'chars:extractAppearance': (file) => appearance.extractAppearance(file),
    'chars:starters': () => chars.listStarters(),
    'chars:installStarter': (id) => chars.installStarter(id),

    // 资源
    'res:list': (kind) => res.listResources(kind),
    'res:import': (kind, paths) => res.importResources(kind, paths),
    'res:remove': (kind, file) => res.removeResource(kind, file),
    'res:export': (kind, file) => res.exportResource(kind, file),
    'res:use': async (kind, file) => {
      await res.activateResource(kind, file);
      if (kind === 'workflows') await afterImage();
    },

    // 生图
    'img:view': () => img.readImagegen(),
    'img:set': async (patch) => {
      await img.writeImagegen(patch);
      // 换了后端、工作流、步数或画风，高清修复和聊天配图要跟着落到新地方
      // 精绘跟着日常的分级和横竖走，尺寸变了也要同步
      if (['source', 'comfyWorkflow', 'steps', 'promptPrefix', 'negativePrompt', 'width', 'height'].some((k) => k in patch)) await afterImage();
      return img.readImagegen();
    },
    'img:hires': async (patch) => {
      try {
        return await hires.setHires(patch);
      } finally {
        await scene.syncScene();
      }
    },
    'scene:status': () => scene.sceneStatus(),
    'scene:set': (patch) => scene.setScene(patch),
    'scene:startWriter': () => llm.startWriterEngine(),
    'img:select': async (id, overrides) => {
      await img.selectBackend(id, overrides);
      await afterImage();
      return img.readImagegen();
    },
    'img:saveKey': async (id, key) => {
      await img.saveImageKey(id, key);
      // 精绘的按钮要等密钥填好才放
      await scene.syncScene();
    },
    'img:probe': (id) => img.probeBackend(id),
    'img:test': (prompt, route) => img.testImage(prompt, route),
    'img:polish': (patch) => scene.setPolish(patch),
    'img:loras': async () => ({ files: await loras.listLoras(), dir: loras.loraDir() }),
    'img:saveImage': (url) => img.saveImage(url),
    'img:engine': () => engine.engineStatus(),
    'img:engineInstall': () => engine.installEngine(),
    'img:engineModelDownload': (id) => engine.downloadModel(id),
    'img:engineImportModel': (p) => engine.importModel(p),
    'img:engineRemoveModel': (file) => engine.removeModel(file),
    'img:engineUse': async (file) => {
      await img.useEngineModel(file);
      await afterImage();
      return img.readImagegen();
    },
    'img:engineStart': (file) => img.bootEngine(file),
    'img:engineStop': async () => {
      await engine.stopEngine();
      return engine.engineStatus();
    },
    'img:comfy': () => comfy.comfyStatus(),
    'img:comfyBind': (dir) => comfy.bindComfy(dir),
    'img:comfyStart': () => comfy.startComfy(),
    'img:comfyStop': () => comfy.stopComfy(),
    'img:comfyInstall': (variant) => comfy.installComfy(variant),

    // 备份
    'backup:list': () => backup.listBackups(),
    'backup:create': (note) => backup.createBackup(note),
    'backup:restore': (file) => backup.restoreBackup(file),
    'backup:remove': (file) => backup.removeBackup(file),
  };

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, async (event, ...args): Promise<IpcEnvelope<unknown>> => {
      // 只接受掌柜自己的窗口，内嵌的酒馆页面没有资格调用
      if (event.sender !== getWindow()?.webContents) return { ok: false, error: { message: '拒绝访问' } };
      try {
        const fn = handlers[channel] as (...a: unknown[]) => unknown;
        return { ok: true, value: await fn(...args) };
      } catch (error) {
        if (!(error instanceof UserError)) console.error(`[ipc:${channel}]`, error);
        return { ok: false, error: describeError(error) };
      }
    });
  }
}
