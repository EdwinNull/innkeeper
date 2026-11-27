/**
 * 成人向场面模板。WAI、Illustrious、NoobAI 用 Danbooru 标签；Pony 把多词标签改成下划线；
 * 写实和句子模型用一段英文；Wan 图生只写动作，文生再补一句动作。
 * 质量词和分级词由画风前缀负责，这里不重复堆。
 * pickScene、applyScenePrompt、applySceneMotion 会原样放进酒馆扩展。
 * 未成年判断写在 pickScene 里面，其余只能调用 NSFW_SCENES 和同文件里一起注入的函数。
 */

export type SceneStyle = 'tags' | 'prose';
export type SceneLevel = 'suggestive' | 'explicit';

export interface NsfwScene {
  id: string;
  /** 界面上的名字 */
  name: string;
  note: string;
  /** 明确的说法：单独出现就算这一场。数组靠前的优先。 */
  cue: string;
  /**
   * 有歧义的说法（射进、插入、压在身下、骑在身上、洗澡……）：日常句子和打斗里也常见，单独出现不算。
   * 只有别的明确说法已经认定是成人场面时，才用它挑出更具体的这一场。
   */
  hint?: string;
  /** 英文里已经写明这一幕时，不再追加句子 */
  present: string;
  /** 单人。双人场面为 false */
  solo: boolean;
  level: SceneLevel;
  act: string;
  pose: string;
  expression: string;
  framing: string;
  place: string;
  prose: string;
  /** 图生视频：只写怎么动、镜头怎么动 */
  motion: string;
  /** 文生视频：动作句，外貌由对话模型另写 */
  clip: string;
}

export const NSFW_SCENES: NsfwScene[] = [
  {
    id: 'after', name: '事后', note: '做完之后，余韵',
    // 「事后」多半只是「后来」，「射进」「射在他」常是阳光、箭，都只作提示
    cue: '内射|中出|射(?:进|在)(?:了)?(?:她|他)?(?:的)?(?:体内|里面|小穴|阴道)|after\\s*sex|creampie|cum\\s+inside',
    hint: '事后|事後|做完(?:之后|以后)|余韵|射(?:进|在)(?:了)?(?:她|他)?(?:的)?(?:身上|脸上|嘴里|小腹|胸上)|\\bcum\\b',
    present: 'after\\s*sex|creampie|afterglow',
    solo: false, level: 'explicit',
    act: 'after sex, nude, sweat, cum on body, uncensored',
    pose: 'lying on back, on bed',
    expression: 'blush, smile, half-closed eyes, looking at viewer',
    framing: 'cowboy shot',
    place: 'bedroom, night, dim lighting',
    prose: 'Two adults lie together on a bed after sex, nude, flushed and sweating, warm lamp light, medium shot.',
    motion: 'They breathe slowly and shift a little closer. A hand rests on a waist. Hair moves slightly. The camera slowly pushes in.',
    clip: 'Slow breathing after sex, flushed skin, a small shift closer, warm lamp light, medium shot, slow camera push in.',
  },
  {
    id: 'paizuri', name: '乳交', note: '胸部夹着',
    cue: '乳交|paizuri|titfuck|titjob',
    present: 'paizuri|titfuck|titjob',
    solo: false, level: 'explicit',
    act: 'paizuri, nude, penis, breasts, uncensored',
    pose: 'kneeling, leaning forward',
    expression: 'blush, looking at viewer, parted lips',
    framing: 'upper body, pov',
    place: 'bedroom, dim lighting',
    prose: 'An adult woman kneels and presses her breasts around a penis, looking toward the camera, dim bedroom light, close upper-body shot.',
    motion: 'She presses her breasts together and moves them slowly up and down. She looks toward the camera and breathes. The camera stays close and still.',
    clip: 'Paizuri, slow up-and-down breast motion, she looks at the camera, close upper-body shot, camera almost still.',
  },
  {
    id: 'oral', name: '口交', note: '含着或舔',
    cue: '口交|舔(?:他的|她的)?(?:阴茎|肉棒|性器)|含住(?:他的|她的)?(?:阴茎|肉棒|性器)|fellatio|blowjob|irrumatio',
    present: 'fellatio|blowjob|oral sex|irrumatio',
    solo: false, level: 'explicit',
    act: 'fellatio, oral, nude, penis, uncensored',
    pose: 'kneeling, leaning forward',
    expression: 'blush, looking at viewer, half-closed eyes',
    framing: 'close-up, pov',
    place: 'bedroom, dim lighting',
    prose: 'An adult woman kneels and performs fellatio, looking up toward the camera, dim bedroom light, close-up.',
    motion: 'Her head moves slowly forward and back. She blinks and looks up. The camera holds a close-up.',
    clip: 'Fellatio, her head moves slowly forward and back, she looks up, close-up, camera holds still.',
  },
  {
    id: 'handjob', name: '手交', note: '用手',
    cue: '手交|handjob',
    // 「用手套弄」也可能是「用手套」
    hint: '套弄',
    present: 'handjob',
    solo: false, level: 'explicit',
    act: 'handjob, nude, penis, uncensored',
    pose: 'sitting, leaning forward',
    expression: 'blush, looking at viewer, smirk',
    framing: 'cowboy shot, pov',
    place: 'bedroom, dim lighting',
    prose: 'An adult woman sits close and gives a handjob, looking at the camera, dim bedroom light, medium close-up.',
    motion: 'Her hand moves slowly and steadily. She glances at the camera and breathes. The camera pushes in slightly.',
    clip: 'Handjob, her hand moves slowly, she looks at the camera, medium close-up, slight camera push in.',
  },
  {
    id: 'doggy', name: '后入', note: '从后面',
    cue: '后入|后背位|doggystyle|doggy\\s*style',
    hint: '趴着|从(?:后面|身后)(?:进入|插入|抱住)',
    present: 'doggystyle|doggy style|from behind',
    solo: false, level: 'explicit',
    act: 'doggystyle, sex, vaginal, from behind, nude, uncensored',
    pose: 'all fours, on bed, arched back',
    expression: 'blush, open mouth, heavy breathing, looking back',
    framing: 'from behind, cowboy shot',
    place: 'bedroom, on bed, night, dim lighting',
    prose: 'Two adults have sex in a doggystyle position on a bed, nude, she looks back, dim lamp light, medium shot from behind.',
    motion: 'Slow rhythmic hip motion from behind. Hair swings a little. Hands grip the sheet. The camera stays at a side-rear medium shot.',
    clip: 'Doggystyle sex, slow hip motion, hair swinging, medium shot from the side-rear, camera almost still.',
  },
  {
    id: 'cowgirl', name: '骑乘', note: '她在上面',
    // 「骑乘」也说骑马，「骑在他身上」也可能在打架
    cue: '骑乘位|女上位|cowgirl|reverse\\s*cowgirl',
    hint: '骑乘|骑在(?:他|你)身上|坐在(?:他|你)(?:的)?(?:身上|腰上|腿上)',
    present: 'cowgirl|straddling',
    solo: false, level: 'explicit',
    act: 'cowgirl position, sex, vaginal, straddling, nude, uncensored',
    pose: 'straddling, sitting, on bed',
    expression: 'blush, open mouth, heavy breathing, looking at viewer',
    framing: 'from below, cowboy shot',
    place: 'bedroom, on bed, night, dim lighting',
    prose: 'An adult woman straddles her partner on a bed in a cowgirl position, nude, looking down, dim lamp light, low angle.',
    motion: 'She rocks her hips slowly while straddling. Her hair bounces a little. She looks down toward the camera. Slight low-angle push in.',
    clip: 'Cowgirl position, she rocks her hips slowly, hair bouncing, low angle, slight camera push in.',
  },
  {
    id: 'standing', name: '站立', note: '靠着墙或抱着',
    // 「站着做饭」「抵在墙上质问」都不是
    cue: '站着做爱|站立(?:体位|式)|抱起来(?:进入|抽插)|standing\\s*sex',
    hint: '站着(?:进入|插入)|抵在墙上|按在墙上|against\\s+the\\s+wall',
    present: 'standing sex|against the wall',
    solo: false, level: 'explicit',
    act: 'standing sex, sex, vaginal, against wall, nude, uncensored',
    pose: 'standing, leg up, against wall',
    expression: 'blush, open mouth, heavy breathing',
    framing: 'cowboy shot, from side',
    place: 'indoors, wall, dim lighting',
    prose: 'Two adults have standing sex against a wall, nude, one leg raised, dim indoor light, medium side shot.',
    motion: 'They move together slowly against a wall. One leg stays raised. Flushed faces, breathing. The camera holds a medium shot.',
    clip: 'Standing sex against a wall, slow motion, one leg raised, medium shot, camera holds still.',
  },
  {
    id: 'missionary', name: '传教士', note: '她躺着，面对面',
    // 「传教士」「missionary」本身是传教的人，「压在身下」常在打斗里
    cue: '传教士(?:体位|式|的姿势)|missionary\\s*(?:position|sex)',
    hint: '传教士|missionary|压在身下|分开(?:她的)?(?:双)?腿',
    present: 'missionary',
    solo: false, level: 'explicit',
    act: 'missionary, sex, vaginal, nude, uncensored',
    pose: 'lying on back, on bed, spread legs',
    expression: 'blush, open mouth, heavy breathing, looking at viewer',
    framing: 'from above, cowboy shot',
    place: 'bedroom, on bed, night, dim lighting',
    prose: 'Two adults have sex in a missionary position on a bed, nude, she looks up, dim lamp light, view from above.',
    motion: 'Slow rhythmic motion in a missionary position on the bed. Hands clutch the sheet. Faces stay flushed. The camera slowly pushes in from above.',
    clip: 'Missionary sex on a bed, slow rhythmic motion, flushed faces, view from above, slow camera push in.',
  },
  {
    id: 'sex', name: '性交', note: '没写具体体位时用这个',
    // 「插入他的胸口」「钥匙插入进去」都不是；英文排除 opposite sex 这类
    cue: '做爱|做愛|性交|交合|抽插|插入(?:了)?(?:她|他)?(?:的)?(?:体内|下体|小穴|阴道)|(?<!opposite |same )\\bsex\\b(?!\\s*appeal)|vaginal|intercourse',
    hint: '插入|进入(?:了)?(?:她|他)的?身体',
    present: '\\bsex\\b|vaginal|intercourse',
    solo: false, level: 'explicit',
    act: 'sex, vaginal, nude, uncensored',
    pose: 'on bed',
    expression: 'blush, open mouth, heavy breathing',
    framing: 'cowboy shot, from side',
    place: 'bedroom, on bed, night, dim lighting',
    prose: 'Two adults have vaginal sex on a bed, nude, flushed and breathing, dim lamp light, medium side shot.',
    motion: 'Two adults move together slowly on the bed. Breathing, flushed skin, hair shifting. Medium shot, slight camera push in.',
    clip: 'Two adults have sex slowly on a bed, flushed skin, hair shifting, medium side shot, slight camera push in.',
  },
  {
    id: 'yuri', name: '双女', note: '两个成年女性',
    // 百合也是花和名字：一束百合、百合花、小百合都不算
    cue: '(?<![束朵枝盆株小])百合(?![花香根])|女女|蕾丝边|蕾絲邊|\\byuri\\b|\\blesbian\\b',
    present: '\\byuri\\b|lesbian|two women',
    solo: false, level: 'explicit',
    act: 'yuri, kissing, nude, uncensored',
    pose: 'embrace, lying on bed',
    expression: 'blush, closed eyes',
    framing: 'cowboy shot',
    place: 'bedroom, on bed, dim lighting',
    prose: 'Two adult women kiss and hold each other on a bed, nude, dim lamp light, medium shot.',
    motion: 'Two adult women kiss and hold each other. A hand moves along a back. Hair falls forward. Close-up, slow push in.',
    clip: 'Two adult women kiss and embrace, hair falling forward, close-up, slow camera push in.',
  },
  {
    id: 'solo', name: '自慰', note: '一个人',
    // fingering 也说摸剑柄、按琴弦
    cue: '自慰|手淫|masturbat',
    hint: '抚慰自己|fingering',
    present: 'masturbat|fingering',
    solo: true, level: 'explicit',
    act: 'masturbation, fingering, nude, spread legs, uncensored',
    pose: 'sitting, spread legs, on bed',
    expression: 'blush, half-closed eyes, open mouth, heavy breathing',
    framing: 'cowboy shot, from above',
    place: 'bedroom, on bed, night, dim lighting',
    prose: 'An adult woman sits on a bed masturbating, nude, eyes half closed, dim lamp light, medium shot from above.',
    motion: 'Her hand moves slowly between her thighs. She breathes, eyes half closed. The camera slowly pushes in. Keep the same person.',
    clip: 'An adult woman masturbates on a bed, slow hand motion, eyes half closed, medium shot, slow camera push in.',
  },
  {
    id: 'bath', name: '入浴', note: '淋浴、浴缸、温泉',
    // 「去洗个澡」「明天泡温泉」只是提到，要有裸露之类的明确说法才画成入浴
    cue: '(?!)',
    hint: '温泉|浴缸|淋浴|洗澡|泡澡|莲蓬|泡在水里|\\bonsen\\b|bathtub|\\bshower\\b',
    present: 'shower|bathtub|onsen|bathing',
    solo: true, level: 'explicit',
    act: 'bathing, wet, wet hair, steam, nude, uncensored',
    pose: 'standing',
    expression: 'blush, looking at viewer',
    framing: 'cowboy shot',
    place: 'bathroom, shower, steam',
    prose: 'An adult woman stands in a shower, nude, wet hair, steam, warm light, medium shot.',
    motion: 'Water runs over her shoulders. She turns slightly and brushes wet hair back. Steam drifts. The camera slowly pans.',
    clip: 'An adult woman in the shower, water over her shoulders, she brushes wet hair back, steam, slow camera pan.',
  },
  {
    id: 'undress', name: '更衣', note: '解开、掀起、脱掉，衣服还在',
    // 「脱掉外套」「解开扣子」多半只是换衣服、松领口，不算；也不拿它细分别的场面，免得把全裸改成半脱
    cue: '衣衫不整|宽衣解带|脱光|脱得(?:精光|一丝不挂)|掀起(?:了)?(?:她的)?裙子|skirt\\s*lift|shirt\\s*lift|clothes\\s*pull',
    present: 'undress|shirt lift|skirt lift|open shirt|clothes pull',
    solo: true, level: 'explicit',
    act: 'undressing, open shirt, skirt lift, clothes pull',
    pose: 'standing, leaning forward',
    expression: 'embarrassed, blush, looking away',
    framing: 'cowboy shot',
    place: 'indoors, dim lighting',
    prose: 'An adult woman undresses, shirt open and skirt lifted, embarrassed, blushing, indoor lamp light, medium shot.',
    motion: 'Her hands undo a button and pull the fabric aside. The cloth slips off one shoulder. She looks away. The camera tilts down slightly, then holds.',
    clip: 'She undresses slowly, fabric slipping off one shoulder, she looks away, medium shot, camera tilts down slightly.',
  },
  {
    id: 'lingerie', name: '内衣', note: '内衣、吊带袜',
    // 「在商场挑内衣」只是提到
    cue: '情趣内衣|吊带袜|只穿着(?:内衣|內衣|胸罩)|\\blingerie\\b|garter\\s*belt',
    present: 'lingerie|garter belt|bra and panties',
    solo: true, level: 'explicit',
    act: 'lingerie, bra, panties, garter straps',
    pose: 'standing',
    expression: 'blush, looking at viewer, light smile',
    framing: 'cowboy shot',
    place: 'bedroom, dim lighting',
    prose: 'An adult woman stands in lingerie, bra, panties and garter straps, looking at the camera, dim bedroom light, medium shot.',
    motion: 'She shifts her weight and touches a garter strap. Fabric moves slightly. She looks at the camera. Slow push in.',
    clip: 'She stands in lingerie, shifts her weight and looks at the camera, medium shot, slow camera push in.',
  },
  {
    id: 'nude', name: '裸体', note: '全裸，没有具体行为',
    // 「赤裸裸的威胁」「naked eye」都不是
    cue: '全裸|裸体|裸體|一丝不挂|不着寸缕|赤身裸体|没穿衣服|赤裸(?:着|地|的身体|身体|的身躯|上身|下身)|completely\\s+nude|\\bnaked\\b(?!\\s+(?:eye|blade|sword|steel|truth|flame|ambition|aggression))|\\bnude\\b',
    present: '\\bnude\\b|\\bnaked\\b|completely nude',
    solo: true, level: 'explicit',
    act: 'completely nude, nude, nipples, navel, uncensored',
    pose: 'lying on back, on bed, arms up',
    expression: 'blush, parted lips, looking at viewer',
    framing: 'full body, from above',
    place: 'bedroom, on bed, morning, sunlight',
    prose: 'An adult woman lies nude on a bed, looking at the camera, morning light through the curtains, full body from above.',
    motion: 'She shifts on the bed and breathes, chest rising and falling. Hair falls over one shoulder. Slow push in. No new clothes appear.',
    clip: 'An adult woman lies nude on a bed, breathing, hair falling over one shoulder, full body, slow camera push in.',
  },
  {
    id: 'kiss', name: '亲吻', note: '接吻，不到更进一步',
    // 「亲吻额头、脸颊、手背」不是接吻，不算
    cue: '接吻|舌吻|吻住(?:了)?(?:她|他)的?(?:嘴|唇)|\\bkissing\\b|french\\s*kiss',
    present: '\\bkissing\\b|french kiss',
    solo: false, level: 'suggestive',
    act: 'kissing, french kiss',
    pose: 'embrace',
    expression: 'closed eyes, blush',
    framing: 'close-up',
    place: 'indoors, dim lighting',
    prose: 'Two adults kiss, eyes closed, a slight head tilt, dim indoor light, close-up.',
    motion: 'They lean in and kiss. A slight head tilt, eyes closed. Hair shifts. The camera holds a close-up.',
    clip: 'Two adults kiss, eyes closed, hair shifting, close-up, camera holds still.',
  },
  {
    id: 'flirt', name: '暧昧', note: '靠近、色气，衣服还穿着',
    // 「诱惑」「贴上来」「壁咚」太常见，不算
    cue: '情欲|欲火|色气|乳沟|衣领大开|\\bcleavage\\b|seductive',
    present: 'cleavage|seductive|leaning closer',
    solo: true, level: 'suggestive',
    act: 'cleavage, collarbone, leaning forward',
    pose: 'leaning forward, sitting',
    expression: 'blush, half-closed eyes, light smile, looking at viewer',
    framing: 'cowboy shot, from above',
    place: 'indoors, dim lighting',
    prose: 'An adult woman leans forward toward the camera, collar open, blushing, a small smile, dim indoor light, medium shot from above.',
    motion: 'She leans a little closer, breathes, and blinks slowly. Hair sways. The camera slowly pushes in.',
    clip: 'She leans closer and breathes, hair swaying, medium shot from above, slow camera push in.',
  },
];

/** 对话模型拒写时丢掉那段，改用模板。扩展里靠函数名调用，不要改成箭头函数以外的引用。 */
export function refused(text: string): boolean {
  return /\b(?:I can(?:'|’|no)t|I cannot|I(?:'|’)m sorry|I am sorry|I won(?:'|’)t|I will not|as an AI|unable to (?:help|assist|create|write|describe))\b|抱歉|我不能|无法(?:提供|协助|生成|描述)/i.test(String(text ?? ''));
}

/** Pony 的多词标签用下划线。已经是下划线的不动。 */
export function asPony(tag: string, pony: boolean): string {
  if (!pony || tag.startsWith('<')) return tag;
  const wrapped = /^(\(+)(.*?)(\)+)$/.exec(tag);
  const body = wrapped ? wrapped[2]! : tag;
  const weight = /:([\d.]+)$/.exec(body);
  const core = (weight ? body.slice(0, weight.index) : body).replace(/ /g, '_');
  const next = weight ? `${core}:${weight[1]}` : core;
  return wrapped ? `${wrapped[1]}${next}${wrapped[3]}` : next;
}

export function pickScene(text: string): NsfwScene | null {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  // 与 imagegen.mentionsMinor 同一标准，写在函数里，放进酒馆扩展时不依赖外部函数。
  if (/\b(child(ren)?|kids?|toddlers?|infants?|lolis?|lolicon|shotas?|shotacon|under-?age|pre-?teens?|minors?|little (girl|boy)s?|elementary school|middle school|kindergarten)\b/i.test(raw)) return null;
  if (/萝莉|蘿莉|正太|幼女|幼童|儿童|兒童|孩童|小孩|孩子|未成年|小学生|小學生|初中生|中学生|幼儿园/.test(raw)) return null;
  for (const m of raw.matchAll(/\b(\d{1,2})\s*(?:-?\s*years?\s*-?\s*old|yo\b|y\/o|岁|歲)/gi)) if (Number(m[1]) < 18) return null;
  // 学生制服和在校生会把画面往未成年拉，这类原文不套成人模板。不分大小写：JK制服、School Uniform 也算。
  if (/高中生|初中生|小学生|学生制服|水手服|jk制服|schoolgirl|schoolboy|school\s*uniform|high\s*school|middle\s*school|elementary/i.test(raw)) return null;
  // 先找明确的说法；没有就不套。
  const at = NSFW_SCENES.findIndex((scene) => new RegExp(scene.cue, 'i').test(raw));
  if (at < 0) return null;
  const found = NSFW_SCENES[at]!;
  // 已经认定是成人场面时，排在前面、更具体的那一场若有歧义说法对得上，就用它（「做爱」加「骑在他身上」是骑乘）。
  // 只在成人场面里细分，不会把接吻之类升级成性行为。
  if (found.level !== 'explicit') return found;
  for (let i = 0; i < at; i++) {
    const scene = NSFW_SCENES[i]!;
    if (scene.level === 'explicit' && scene.hint && new RegExp(scene.hint, 'i').test(raw)) return scene;
  }
  return found;
}

/** 打开成人内容、分级不是全年龄时，出图才套这些模板。 */
export function nsfwTemplatesOn(adult: boolean, rating: string): boolean {
  return adult && rating !== 'safe';
}

/**
 * 按原文选一场，把模板补进提示词。
 * 标签已经写全时只补缺少的行为标签，不改姿势和场景。
 * 中文句子或很短的标签则套上整套模板。外貌标签原样留下。
 * 分组正则写在函数里面，放进酒馆扩展时不用再带一份。
 */
export function applyScenePrompt(written: string, source: string, style: SceneStyle, pony: boolean, look = ''): { id: string | null; name: string; prompt: string } {
  const bare = (tag: string) => tag.toLowerCase().replace(/^\(+/, '').replace(/\)+$/, '').replace(/:[\d.]+$/, '').replace(/_/g, ' ').trim();
  const scene = pickScene(`${source}\n${written}`);
  if (!scene) return { id: null, name: '', prompt: String(written ?? '') };
  if (style === 'prose') {
    const body = refused(written) ? '' : String(written ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (body && new RegExp(scene.present, 'i').test(body)) return { id: scene.id, name: scene.name, prompt: body.slice(0, 700) };
    return { id: scene.id, name: scene.name, prompt: [body, scene.prose].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, 700) };
  }
  const raw = refused(written) ? '' : String(written ?? '');
  const have = raw.split(',').map((t) => t.trim()).filter((t) => t && !/[\u3400-\u9fff]/.test(t));
  const count = (tag: string) => /^(?:\d+\+?\s*)?(?:girls?|boys?|others?)$/.test(tag)
    || /^(?:solo(?: focus)?|multiple (?:girls|boys|others)|hetero|yuri|faceless male|mature female|mature male|adult)$/.test(tag);
  const counts = have.filter((t) => count(bare(t)));
  const rest = have.filter((t) => !count(bare(t)));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (chunk: string) => {
    for (const tag of chunk.split(',').map((t) => t.trim()).filter(Boolean)) {
      const shown = asPony(tag, pony);
      const key = bare(shown);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(shown);
    }
  };
  const text = `${source}\n${written}`;
  const male = /\b1boy\b/i.test(look) && !/\b1girl\b/i.test(look);
  // 和 yuri 那一场的说法一致：一束百合、百合花、小百合不算
  const yuri = /(?<![束朵枝盆株小])百合(?![花香根])|女女|蕾丝边|蕾絲邊|\byuri\b|\blesbian\b/i.test(text);
  const twoGirls = scene.id === 'yuri' || (yuri && scene.id !== 'solo');
  let people = '1girl, solo, mature female';
  if (twoGirls) people = '2girls, yuri, mature female';
  else if (scene.solo) people = male ? '1boy, solo, mature male' : '1girl, solo, mature female';
  else {
    const pair = male ? '1boy, 1girl, hetero, mature female' : '1girl, 1boy, hetero, mature female';
    people = /你的视角|第一人称|男性视角|\bpov\b|male pov/i.test(text) && !male ? `${pair}, pov, faceless male` : pair;
  }
  // 模型写的人数要和这一场对得上才留：两人场面写了 solo、百合写成 1girl 1boy、只写了 mature female 都换成模板的
  const persons = counts.reduce((n, t) => {
    const m = /^(\d+)\+?\s*(?:girls?|boys?|others?)$/.exec(bare(t));
    return m ? n + Number(m[1]) : /^multiple /.test(bare(t)) ? n + 2 : n;
  }, 0);
  const fits = twoGirls
    ? counts.some((t) => /^(?:2girls|multiple girls)$/.test(bare(t)))
    : persons >= (scene.solo ? 1 : 2) && !(!scene.solo && counts.some((t) => bare(t) === 'solo'));
  if (counts.length && fits) for (const tag of counts) push(tag);
  else push(people);
  push(scene.act);
  const rich = rest.length >= 6;
  const has = (re: RegExp) => rest.some((t) => re.test(bare(t)));
  if (!rich) {
    if (!has(/^(?:sitting|kneeling|lying|on back|on stomach|all fours|spread legs|straddling|standing|leaning forward|arched back|arms up|embrace|leg up|against wall)$/i)) push(scene.pose);
    if (!has(/^(?:blush|smile|smirk|embarrassed|ahegao|tears|half-closed eyes|parted lips|open mouth|tongue out|heavy breathing|closed eyes|looking away|looking at viewer|looking back|light smile)$/i)) push(scene.expression);
    if (!has(/^(?:close-up|upper body|cowboy shot|full body|portrait|from above|from below|from behind|from side|wide shot|face focus|pov)$/i)) push(scene.framing);
    if (!has(/(?:bedroom|bathroom|shower|onsen|bathtub|\bbed\b|couch|kitchen|office|outdoors|forest|beach|hotel|tavern|living room|indoors|wall)/i)) {
      let place = scene.place;
      if (/酒馆|客栈|吧台/.test(text)) place = 'tavern, indoors, dim lighting';
      else if (/浴室|淋浴|浴缸|温泉/.test(text)) place = 'bathroom, steam';
      else if (/森林|树林/.test(text)) place = 'forest, outdoors';
      else if (/海边|沙滩/.test(text)) place = 'beach, outdoors';
      else if (/办公室/.test(text)) place = 'office, indoors';
      else if (/厨房/.test(text)) place = 'kitchen, indoors';
      else if (/客厅|沙发/.test(text)) place = 'living room, couch, indoors';
      push(place);
    }
  }
  for (const tag of rest) push(tag);
  if (scene.level === 'explicit') push(pony ? 'rating_explicit' : 'nsfw, explicit');
  return { id: scene.id, name: scene.name, prompt: out.join(', ') };
}

/** 视频。图生直接用这场的动作；文生保留外貌句，缺了动作再补。 */
export function applySceneMotion(written: string, source: string, mode: 'scene' | 'animate'): { id: string | null; name: string; prompt: string } {
  const scene = pickScene(`${source}\n${written}`);
  if (!scene) return { id: null, name: '', prompt: String(written ?? '') };
  if (mode === 'animate') return { id: scene.id, name: scene.name, prompt: scene.motion };
  const body = refused(written) ? '' : String(written ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (body && new RegExp(scene.present, 'i').test(body)) return { id: scene.id, name: scene.name, prompt: body.slice(0, 600) };
  return { id: scene.id, name: scene.name, prompt: [body, scene.clip].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, 600) };
}

/** 成人档时附在「最后一条消息」「整个故事」说明末尾，让对话模型别把行为写成气氛。 */
export const NSFW_WRITE_HINT: Record<SceneStyle, string> = {
  tags: 'If the scene is sexual, include explicit Danbooru tags for the nudity, clothing state, position and act. Do not soften those into intimate, romantic or atmosphere. If it is not sexual, do not add sex tags. Every person is an adult.',
  prose: 'If the scene is sexual, describe the adult bodies, clothing state, position and motion in plain words. Do not soften that into an intimate atmosphere. If it is not sexual, do not add sexual detail. Every person is an adult.',
};
