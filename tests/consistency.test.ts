import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false }, dialog: {}, shell: {}, net: {}, session: {} }));

import { mentionsMinor } from '../src/shared/catalog/imagegen';
import { dressUp, lockLook, LOOK_RULES, MOTION_FALLBACK, motionPrompt, splitOutfit, VIDEO_PROMPTS } from '../src/shared/catalog/scene';
import { FRAME_NODE, FRAME_PLACEHOLDER, VIDEO_MODELS, videoModelById, videoOptionsOf, videoSize, videoWorkflow, videoWorkflowFile } from '../src/shared/catalog/video';
import { EXTENSION_JS } from '../src/main/features/scene';
import { fillWorkflow } from '../src/main/features/workflow';

/** 扩展里用的是函数源码，不能引用外部变量 */
const rebuild = <T>(fn: T): T => new Function(`return ${String(fn)}`)() as T;

describe('人物统一：长相以外貌为准', () => {
  const look = '1girl, silver hair, long hair, red eyes, large breasts, fox ears';

  it('去掉模型写的、和外貌冲突的发色、发长、瞳色、身材和耳朵', () => {
    const written = 'solo, white hair, short hair, blue eyes, small breasts, cat ears, animal ears, smile, sitting, tavern, indoors';
    expect(lockLook(written, look, LOOK_RULES)).toBe('solo, smile, sitting, tavern, indoors');
  });

  it('和外貌一致的、和长相无关的都留下', () => {
    expect(lockLook('1girl, silver hair, hair ribbon, closed eyes, glowing eyes, hair between eyes, blush', look, LOOK_RULES)).toBe(
      '1girl, silver hair, hair ribbon, closed eyes, glowing eyes, hair between eyes, blush',
    );
  });

  it('外貌没写的属性不管，模型写什么就是什么', () => {
    expect(lockLook('solo, ponytail, dark skin, pale skin', 'silver hair', LOOK_RULES)).toBe('solo, ponytail, dark skin, pale skin');
  });

  it('多人同框时分不清是谁的发色，不动', () => {
    const written = '1girl, 1boy, black hair, short hair, blue eyes, hetero';
    expect(lockLook(written, look, LOOK_RULES)).toBe(written);
    expect(lockLook('2girls, black hair', look, LOOK_RULES)).toBe('2girls, black hair');
  });

  it('认得连写的标签：long brown hair 同时管发色和发长', () => {
    const mixed = 'long brown hair, pink eyes';
    expect(lockLook('1girl, solo, blonde hair, short hair, big blue eyes, long brown hair, hair ornament, very long hair', mixed, LOOK_RULES)).toBe(
      '1girl, solo, long brown hair, hair ornament',
    );
    expect(lockLook('solo, silver-white hair', 'black hair', LOOK_RULES)).toBe('solo');
  });

  it('外貌里带权重也认得', () => {
    expect(lockLook('solo, black hair', '(silver hair:1.2)', LOOK_RULES)).toBe('solo');
  });

  it('没有外貌时原样返回，函数源码能单独运行', () => {
    expect(lockLook('solo, black hair', '', LOOK_RULES)).toBe('solo, black hair');
    expect(rebuild(lockLook)('solo, black hair', 'silver hair', LOOK_RULES)).toBe('solo');
  });
});

describe('人物统一：常穿的衣服', () => {
  const outfit = 'white shirt, black skirt, black thighhighs';

  it('这一幕没写穿什么时加在最前面', () => {
    expect(dressUp('solo, smile, sitting, tavern', outfit, LOOK_RULES)).toBe('white shirt, black skirt, black thighhighs, solo, smile, sitting, tavern');
  });

  it('写了别的衣服或全裸，就听这一幕的', () => {
    expect(dressUp('solo, bikini, beach', outfit, LOOK_RULES)).toBe('solo, bikini, beach');
    expect(dressUp('solo, school uniform', outfit, LOOK_RULES)).toBe('solo, school uniform');
    expect(dressUp('solo, completely nude, bed', outfit, LOOK_RULES)).toBe('solo, completely nude, bed');
    expect(dressUp('solo, nude', outfit, LOOK_RULES)).toBe('solo, nude');
  });

  it('只是衣服状态变了（掀起、敞开、没穿胸罩），照样是常穿的那身', () => {
    expect(dressUp('solo, open shirt, skirt lift, no bra', outfit, LOOK_RULES)).toBe(
      'white shirt, black skirt, black thighhighs, solo, open shirt, skirt lift, no bra',
    );
    expect(dressUp('solo, topless', outfit, LOOK_RULES)).toBe('white shirt, black skirt, black thighhighs, solo, topless');
  });

  it('只写了袜子不算换装，已有的不重复', () => {
    expect(dressUp('solo, black thighhighs', outfit, LOOK_RULES)).toBe('white shirt, black skirt, solo, black thighhighs');
  });

  it('不误认带衣物字样的别的词', () => {
    // bracelet 不是 bra，hair ribbon 不是衣服
    expect(dressUp('solo, bracelet, hair ribbon', 'maid dress', LOOK_RULES)).toBe('maid dress, solo, bracelet, hair ribbon');
  });

  it('没存常穿的衣服时原样返回，函数源码能单独运行', () => {
    expect(dressUp('solo, smile', '', LOOK_RULES)).toBe('solo, smile');
    expect(rebuild(dressUp)('solo', 'white dress', LOOK_RULES)).toBe('white dress, solo');
  });

  it('把旧外貌拆成长相和衣着，LoRA 写法留在长相里', () => {
    expect(splitOutfit('1girl, silver hair, red eyes, glasses, <lora:aqing:0.8>, white shirt, beige trench coat, black thighhighs, boots', LOOK_RULES)).toEqual({
      look: '1girl, silver hair, red eyes, glasses, <lora:aqing:0.8>',
      outfit: 'white shirt, beige trench coat, black thighhighs, boots',
    });
    expect(splitOutfit('', LOOK_RULES)).toEqual({ look: '', outfit: '' });
  });
});

describe('短片提示词', () => {
  it('整理成一行，去掉思考、前缀和会被当成命令语法的字符', () => {
    expect(motionPrompt('<think>嗯</think>\nPrompt: "She smiles | tilts her head {slowly}.\nHair sways."')).toBe('She smiles tilts her head slowly . Hair sways.');
  });

  it('拒写、太短时返回空串，由调用方换成备用描述', () => {
    expect(motionPrompt("I'm sorry, but I can't help with that.")).toBe('');
    expect(motionPrompt('抱歉，我不能生成这类内容。')).toBe('');
    expect(motionPrompt('ok')).toBe('');
    expect(rebuild(motionPrompt)('She breathes slowly and blinks.')).toBe('She breathes slowly and blinks.');
  });

  it('说明里都要求成年人，动图那份有图的提示词占位', () => {
    expect(VIDEO_PROMPTS.scene).toMatch(/adult/);
    expect(VIDEO_PROMPTS.animate).toMatch(/adult/);
    expect(VIDEO_PROMPTS.animate).toContain('%PICTURE%');
    expect(VIDEO_PROMPTS.animate).not.toMatch(/\{\{picture/i);
    expect(MOTION_FALLBACK.length).toBeGreaterThan(20);
    expect(rebuild(mentionsMinor)('a loli in a park')).toBe(true);
  });
});

describe('让图动起来的工作流', () => {
  const fun = videoModelById('wan21-fun-inp-1.3b')!;
  const ti2v = videoModelById('wan22-ti2v-5b')!;
  const values = { prompt: 'she smiles', negative_prompt: '', model: '', sampler: '', scheduler: '', steps: 0, scale: 0, width: 0, height: 0, seed: 9, clip_skip: 1 };

  it('Fun InP：起始画面同时进 CLIP Vision 和潜空间，采样器用它输出的条件', () => {
    const flow = videoWorkflow(fun, { orientation: 'portrait', frames: 33, format: 'webp' }, true, 'animate');
    expect(flow['12']).toEqual({ class_type: FRAME_NODE, inputs: { data: `%${FRAME_PLACEHOLDER}%` } });
    expect(flow['14']!.inputs).toMatchObject({ image: ['12', 0], crop: 'none' });
    expect(flow['7']!.inputs).toMatchObject({ start_image: ['12', 0], clip_vision_output: ['14', 0], width: 512, height: 752, length: 33 });
    expect(flow['8']!.inputs).toMatchObject({ positive: ['7', 0], negative: ['7', 1], latent_image: ['7', 2] });
    expect(flow['11']!.class_type).toBe('SaveAnimatedWEBP');
    expect(flow['10']).toBeUndefined();
    const text = fillWorkflow(JSON.stringify(flow), values, { [FRAME_PLACEHOLDER]: 'iVBORw0KGgo=' });
    expect(text).not.toMatch(/%[a-z_]+%/);
    expect(JSON.parse(text)['12'].inputs.data).toBe('iVBORw0KGgo=');
  });

  it('5B 两种都能拍，各写一份；图生只多一个起始画面', () => {
    const scene = videoWorkflow(ti2v, { orientation: 'portrait', frames: 49 }, false, 'scene');
    const animate = videoWorkflow(ti2v, { orientation: 'portrait', frames: 49 }, false, 'animate');
    expect(scene['7']!.inputs.start_image).toBeUndefined();
    expect(animate['7']!.inputs.start_image).toEqual(['12', 0]);
    expect(animate['7']!.inputs.width).toBe(704);
    expect(animate['7']!.inputs.height).toBe(1024);
    expect(videoWorkflowFile(ti2v, 'scene')).not.toBe(videoWorkflowFile(ti2v, 'animate'));
    expect(videoWorkflowFile(fun)).toBe('掌柜_视频_Wan2.1-Fun-1.3B_图生.json');
  });

  it('LoRA 接在底模和采样偏移之间，只作用于模型', () => {
    const flow = videoWorkflow(fun, { orientation: 'landscape', frames: 17, lora: { file: 'motion.safetensors', strength: 0.8 } }, false, 'animate');
    expect(flow['15']).toEqual({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'motion.safetensors', strength_model: 0.8 } });
    expect(flow['4']!.inputs.model).toEqual(['15', 0]);
    expect(videoWorkflow(fun, { orientation: 'landscape', frames: 17 }, false, 'animate')['4']!.inputs.model).toEqual(['1', 0]);
  });

  it('写好的工作流能读回全部选项', () => {
    for (const m of VIDEO_MODELS) {
      for (const mode of m.modes) {
        const o = { orientation: 'landscape' as const, frames: m.lengths[0]!.frames, format: 'webp' as const, lora: { file: 'x.safetensors', strength: 0.6 } };
        expect(videoOptionsOf(videoWorkflow(m, o, false, mode))).toEqual(o);
        const [w, h] = videoSize(m, mode, o);
        expect(w % m.step).toBe(0);
        expect(h % m.step).toBe(0);
      }
    }
    expect(videoOptionsOf(null)).toBeNull();
  });

  it('需要的文件都带 CLIP Vision 之类的部件目录', () => {
    expect(fun.parts.map((p) => p.role).sort()).toEqual(['clip_vision', 'diffusion_models', 'text_encoders', 'vae']);
  });
});

describe('放进酒馆的扩展', () => {
  it('注入后是一段能解析的脚本，规则和函数都在', () => {
    expect(EXTENSION_JS).not.toContain('@innkeeper-shared');
    for (const name of ['cleanTags', 'lockLook', 'dressUp', 'motionPrompt', 'mentionsMinor', 'VIDEO_PROMPTS', 'MOTION_FALLBACK', 'FRAME', 'LOOK', 'RULES', 'NSFW_SCENES', 'refused', 'asPony', 'pickScene', 'applyScenePrompt', 'applySceneMotion', 'tidyWritten', 'WRITER_LIMITS', 'writerInstruction', 'chatForWriter', 'writerMessages', 'writerPayload']) {
      expect(EXTENSION_JS).toMatch(new RegExp(`const ${name} = `));
    }
    // 只解析不运行：脚本里用到酒馆页面的全局变量
    expect(() => new Function(EXTENSION_JS)).not.toThrow();
    expect(EXTENSION_JS).toContain("name: 'innkeeper-video'");
  });
});
