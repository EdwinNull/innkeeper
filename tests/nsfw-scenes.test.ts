import { describe, expect, it } from 'vitest';
import { LOOK_RULES, dressUp } from '../src/shared/catalog/scene';
import {
  NSFW_SCENES, applySceneMotion, applyScenePrompt, asPony, nsfwTemplatesOn, pickScene, refused,
} from '../src/shared/catalog/nsfw-scenes';
import { EXTENSION_JS } from '../src/main/features/scene';

describe('按场面选成人模板', () => {
  it('日常句子、未成年人、在校生都不选', () => {
    expect(pickScene('掌柜的，来碗热茶。')).toBeNull();
    expect(pickScene('Essex is a county')).toBeNull();
    expect(pickScene('他把钥匙插入锁里')).toBeNull();
    expect(pickScene('a loli in the shower')).toBeNull();
    expect(pickScene('高中生解开了扣子')).toBeNull();
    expect(pickScene('she wears a school uniform, nude')).toBeNull();
    expect(nsfwTemplatesOn(false, 'explicit')).toBe(false);
    expect(nsfwTemplatesOn(true, 'safe')).toBe(false);
    expect(nsfwTemplatesOn(true, 'free')).toBe(true);
  });

  it('具体体位优先于笼统的做爱', () => {
    expect(pickScene('事后他抱着她，两人都没穿衣服')?.id).toBe('after');
    expect(pickScene('他们做爱，做完之后又接吻')?.id).toBe('after');
    expect(pickScene('她用传教士的姿势做爱')?.id).toBe('missionary');
    expect(pickScene('她骑在他身上，两人做爱')?.id).toBe('cowgirl');
    expect(pickScene('两个人做爱')?.id).toBe('sex');
    expect(pickScene('百合，她吻了上去')?.id).toBe('yuri');
    expect(pickScene('她一丝不挂地泡在浴缸里')?.id).toBe('bath');
  });

  it('日常句子和打斗里的歧义说法不选', () => {
    const everyday = [
      '清晨的阳光射进窗户，照在她的脸上。',
      '一支箭射在他的盾牌上，发出闷响。',
      '他拔剑插入他的胸口，鲜血涌出。',
      '他把钥匙插入进去，打开了门。',
      '她站着做饭，哼着小曲。',
      '他把她抵在墙上，低声质问：钱呢？',
      '他一把将敌人压在身下，夺过匕首。',
      '她骑在他身上挥拳，两人扭打在一起。',
      '他脱掉外套，挂在门口的衣架上。',
      '他解开扣子，把风衣递给侍者。',
      '这是赤裸裸的威胁。',
      '我先去洗个澡，你等我一下。',
      '明天我们一起去泡温泉吧？',
      'She saw it with the naked eye.',
      'He was fingering the hilt of his sword.',
      '她在商场挑了一套内衣。',
      '事后他才知道真相。',
      '做完作业之后，她去散步了。',
      '传教士来到了村子。',
      '她手里拿着一束百合。',
      '她最喜欢百合花。',
      '小百合推门进来。',
      '她亲吻了他的手背。',
      '骑乘技术是骑士的基本功。',
      'the opposite sex',
    ];
    for (const line of everyday) expect(pickScene(line), line).toBeNull();
  });

  it('歧义说法只细分成人场面，不把接吻升级成性行为，也不把全裸改成半脱', () => {
    expect(pickScene('他们接吻，他把她抵在墙上')?.id).toBe('kiss');
    expect(pickScene('她脱掉衣服，全裸站着')?.id).toBe('nude');
  });

  it('提到孩子、大写的制服词都不套', () => {
    expect(pickScene('她亲吻了孩子的额头。')).toBeNull();
    expect(pickScene('孩子们睡着后，他们做爱')).toBeNull();
    expect(pickScene('她穿着JK制服，全裸')).toBeNull();
    expect(pickScene('She wears a School Uniform, nude underneath.')).toBeNull();
  });

  it('模型写的人数和这一场对不上时换成模板的', () => {
    const pair = applyScenePrompt('1girl, solo, bed, night', '他们在床上做爱。', 'tags', false, '');
    expect(pair.prompt.startsWith('1girl, 1boy, hetero, mature female')).toBe(true);
    expect(pair.prompt).not.toMatch(/\bsolo\b/);
    const onlyAge = applyScenePrompt('mature female, bed', '她全裸', 'tags', false, '');
    expect(onlyAge.prompt.startsWith('1girl, solo, mature female')).toBe(true);
    const kept = applyScenePrompt('1girl, 1boy, hetero, bed', '他们在床上做爱。', 'tags', false, '');
    expect(kept.prompt.startsWith('1girl, 1boy, hetero')).toBe(true);
    const yuri = applyScenePrompt('1girl, 1boy, bed', '两个女人百合，做爱', 'tags', false, '');
    expect(yuri.prompt.startsWith('2girls, yuri, mature female')).toBe(true);
  });

  it('中文句子套上 WAI 标签，全裸时不再加常穿的衣服', () => {
    const { id, prompt } = applyScenePrompt('她银发红瞳', '她赤裸地躺在床上', 'tags', false, '1girl, silver hair');
    expect(id).toBe('nude');
    expect(prompt).toContain('1girl, solo, mature female');
    expect(prompt).toContain('completely nude');
    expect(prompt).toContain('nsfw, explicit');
    expect(prompt).not.toMatch(/[\u3400-\u9fff]/);
    expect(dressUp(prompt, 'white shirt, skirt', LOOK_RULES)).toBe(prompt);
  });

  it('更衣仍把常穿的衣服加回去，酒馆地点盖过默认卧室', () => {
    const { id, prompt } = applyScenePrompt('', '她在酒馆解开了衬衫扣子，衣衫不整', 'tags', false, '');
    expect(id).toBe('undress');
    expect(prompt).toContain('open shirt');
    expect(prompt).toContain('tavern, indoors, dim lighting');
    expect(prompt).not.toContain('bedroom');
    expect(dressUp(prompt, 'white shirt', LOOK_RULES)).toContain('white shirt');
  });

  it('百合加上体位时不写 hetero，男性角色单人用 1boy', () => {
    const yuri = applyScenePrompt('', '两个女人百合，后入', 'tags', false, '1girl, long hair');
    expect(yuri.id).toBe('doggy');
    expect(yuri.prompt.startsWith('2girls, yuri, mature female')).toBe(true);
    expect(yuri.prompt).not.toContain('hetero');
    expect(yuri.prompt).toContain('doggystyle');
    const male = applyScenePrompt('', '他全裸站着', 'tags', false, '1boy, short hair');
    expect(male.prompt).toContain('1boy, solo, mature male');
    expect(male.prompt).not.toContain('1girl');
  });

  it('视角词加上 faceless male，Pony 用下划线', () => {
    const pov = applyScenePrompt('silver hair', '你的视角，她在给他口交', 'tags', false, '');
    expect(pov.id).toBe('oral');
    expect(pov.prompt).toContain('pov, faceless male');
    expect(pov.prompt).toContain('fellatio');
    const pony = applyScenePrompt('', 'cowgirl position', 'tags', true, '');
    expect(pony.prompt).toContain('cowgirl_position');
    expect(pony.prompt).toContain('rating_explicit');
    expect(pony.prompt).not.toContain('nsfw');
    expect(asPony('(silver hair:1.2)', true)).toBe('(silver_hair:1.2)');
  });

  it('标签已经写全时只补行为，不改姿势', () => {
    const written = '1girl, solo, silver hair, red eyes, standing, smile, tavern, wooden counter, lantern';
    const { prompt } = applyScenePrompt(written, '她全裸', 'tags', false, '');
    expect(prompt).toContain('completely nude');
    expect(prompt).toContain('standing');
    expect(prompt).not.toContain('lying on back');
    expect(prompt).toContain('tavern');
  });

  it('拒答换成模板，句子模型保留中文并补英文', () => {
    expect(refused("I'm sorry, I can't describe that")).toBe(true);
    const tags = applyScenePrompt("I'm sorry, I can't describe that", '他们在做爱', 'tags', false, '');
    expect(tags.id).toBe('sex');
    expect(tags.prompt).toContain('sex, vaginal');
    const prose = applyScenePrompt('她靠在他身上。', '他们在做爱', 'prose', false, '');
    expect(prose.prompt).toContain('她靠在他身上');
    expect(prose.prompt).toContain('vaginal sex');
  });

  it('图生视频只用动作句，文生保留已写明的动作', () => {
    const still = applySceneMotion('1girl, nude, on bed', '她全裸躺着', 'animate');
    expect(still.id).toBe('nude');
    expect(still.prompt).toContain('breathes');
    expect(still.prompt).not.toContain('1girl');
    const clip = applySceneMotion('An adult woman with silver hair has sex on a bed.', '他们在做爱', 'scene');
    expect(clip.id).toBe('sex');
    expect(clip.prompt).toBe('An adult woman with silver hair has sex on a bed.');
  });

  it('放进扩展的函数不依赖外部变量，和掌柜用的是同一套', () => {
    const src = [
      `const NSFW_SCENES = ${JSON.stringify(NSFW_SCENES)};`,
      `const refused = ${refused.toString()};`,
      `const asPony = ${asPony.toString()};`,
      `const pickScene = ${pickScene.toString()};`,
      `const applyScenePrompt = ${applyScenePrompt.toString()};`,
      `const applySceneMotion = ${applySceneMotion.toString()};`,
      'return { pickScene, applyScenePrompt, applySceneMotion };',
    ].join('\n');
    const api = new Function(src)() as {
      pickScene: typeof pickScene;
      applyScenePrompt: typeof applyScenePrompt;
    };
    expect(api.pickScene('来碗热茶')).toBeNull();
    expect(api.applyScenePrompt('', '她赤裸地躺着', 'tags', false, '').prompt).toContain('completely nude');
    expect(EXTENSION_JS.indexOf('applyScenePrompt(prompt')).toBeLessThan(EXTENSION_JS.indexOf('dressUp(prompt'));
    expect(NSFW_SCENES.map((s) => s.id).length).toBe(new Set(NSFW_SCENES.map((s) => s.id)).size);
    for (const scene of NSFW_SCENES) {
      expect(() => new RegExp(scene.cue, 'i')).not.toThrow();
      if (scene.hint) expect(() => new RegExp(scene.hint!, 'i')).not.toThrow();
      expect(scene.motion.length).toBeGreaterThan(20);
    }
  });
});
