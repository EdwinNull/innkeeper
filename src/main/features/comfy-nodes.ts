import fsp from 'node:fs/promises';
import path from 'node:path';
import { LORA_NODE } from '@shared/catalog/imagegen';
import { FRAME_NODE, FRAME_PLACEHOLDER } from '@shared/catalog/video';
import { exists } from '../core/fsx';

/**
 * 掌柜放进 ComfyUI 的自定义节点，只用 ComfyUI 本身就有的依赖，不另装第三方节点。
 * - 读图：ComfyUI 自带的「加载图像」只认 input 目录里的文件，酒馆能交过去的只有工作流文本，
 *   所以聊天里的图以 base64 放进占位符，由这个节点读成画面。
 * - 读 LoRA：SD WebUI 和轻量引擎认提示词里的 <lora:名字:权重>，ComfyUI 不认。这个节点把它们从
 *   提示词里取出来加载，再把去掉标签的提示词交给 CLIPTextEncode，角色外貌里写的 LoRA 三个后端都能用。
 * 用 String.raw：Python 的正则里有反斜杠。
 */
const NODE_PY = String.raw`# 掌柜（Innkeeper）放进来的节点。掌柜启动 ComfyUI 时会按需覆盖这个文件，请不要手改。
import base64
import binascii
import io
import re
from collections import OrderedDict

import numpy as np
import torch
from PIL import Image, ImageOps

import comfy.sd
import comfy.utils
import folder_paths

MAX_CHARS = 48 * 1024 * 1024


class InnkeeperLoadImageBase64:
    """把 base64 图片读成画面。酒馆把聊天里的图放进 %${FRAME_PLACEHOLDER}% 占位符交给 ComfyUI。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"data": ("STRING", {"default": "", "multiline": False})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "load"
    CATEGORY = "innkeeper"

    def load(self, data):
        text = (data or "").strip()
        if text.startswith("data:"):
            text = text.split(",", 1)[-1]
        if not text or text.startswith("%"):
            raise ValueError("没有收到起始画面。请用酒馆聊天框上的「动起来」，或掌柜生图页里的「让它动起来」")
        if len(text) > MAX_CHARS:
            raise ValueError("起始画面太大")
        try:
            raw = base64.b64decode(text)
        except (binascii.Error, ValueError) as error:
            raise ValueError("起始画面不是有效的 base64") from error
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        array = np.asarray(image).astype(np.float32) / 255.0
        return (torch.from_numpy(array)[None,],)


LORA_TAG = re.compile(r"<lora:([^:<>]+?)(?::\s*(-?[\d.]+))?(?::\s*(-?[\d.]+))?\s*>", re.IGNORECASE)
LORA_EXT = (".safetensors", ".ckpt", ".pt", ".bin")
# 最近用过的几个 LoRA 留在内存里，连着画同一个角色时不用每张都从硬盘读
_loaded = OrderedDict()


def _find_lora(name):
    wanted = name.strip().replace("\\", "/").lower()
    stem = wanted[: -len(next(e for e in LORA_EXT if wanted.endswith(e)))] if wanted.endswith(LORA_EXT) else wanted
    for f in folder_paths.get_filename_list("loras"):
        norm = f.replace("\\", "/").lower()
        base = norm[: -len(next(e for e in LORA_EXT if norm.endswith(e)))] if norm.endswith(LORA_EXT) else norm
        if norm == wanted or base == stem or base.rsplit("/", 1)[-1] == stem:
            return f
    return None


def _load(path):
    if path in _loaded:
        _loaded.move_to_end(path)
        return _loaded[path]
    item = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
    _loaded[path] = item
    while len(_loaded) > 3:
        _loaded.popitem(last=False)
    return item


def strip_lora_tags(text):
    cleaned = LORA_TAG.sub("", text or "")
    cleaned = re.sub(r"\s*,(\s*,)+", ",", cleaned)
    return re.sub(r"^[\s,]+|[\s,]+$", "", cleaned)


class InnkeeperPromptLora:
    """加载提示词里写的 <lora:名字:权重>（或 <lora:名字:模型权重:文本权重>），输出去掉这些标签的提示词。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",), "clip": ("CLIP",), "text": ("STRING", {"default": "", "multiline": True})}}

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "text")
    FUNCTION = "apply"
    CATEGORY = "innkeeper"

    def apply(self, model, clip, text):
        for match in LORA_TAG.finditer(text or ""):
            name = match.group(1)
            strength_model = float(match.group(2)) if match.group(2) else 1.0
            strength_clip = float(match.group(3)) if match.group(3) else strength_model
            if strength_model == 0 and strength_clip == 0:
                continue
            found = _find_lora(name)
            if found is None:
                raise ValueError("找不到 LoRA：" + name + "。把文件放进 loras 目录，或检查外貌里写的文件名")
            lora, metadata = _load(folder_paths.get_full_path_or_raise("loras", found))
            model, clip = comfy.sd.load_lora_for_models(model, clip, lora, strength_model, strength_clip, lora_metadata=metadata)
        return (model, clip, strip_lora_tags(text))


NODE_CLASS_MAPPINGS = {"${FRAME_NODE}": InnkeeperLoadImageBase64, "${LORA_NODE}": InnkeeperPromptLora}
NODE_DISPLAY_NAME_MAPPINGS = {
    "${FRAME_NODE}": "Load Image (Base64) · Innkeeper",
    "${LORA_NODE}": "LoRA from Prompt · Innkeeper",
}
`;

export const NODE_DIR_NAME = 'innkeeper_nodes';

/** 写进 ComfyUI 的 custom_nodes。内容没变就不动，返回是否改过（改过要重启 ComfyUI 才生效）。 */
export async function installComfyNodes(comfyRoot: string): Promise<boolean> {
  const dir = path.join(comfyRoot, 'custom_nodes', NODE_DIR_NAME);
  const file = path.join(dir, '__init__.py');
  if (exists(file) && (await fsp.readFile(file, 'utf8')) === NODE_PY) return false;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, NODE_PY, 'utf8');
  return true;
}

/** 给单元测试看的节点源码 */
export const nodeSource = () => NODE_PY;
