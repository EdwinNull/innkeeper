// 本地模拟服务：OpenAI 兼容聊天、SD WebUI、sd.cpp、ComfyUI
import http from 'node:http';
import sharp from 'sharp';

const svg = (label) => `<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b4a3d"/><stop offset="1" stop-color="#d4904a"/></linearGradient></defs><rect width="832" height="1216" fill="url(#g)"/><circle cx="416" cy="470" r="210" fill="#f0d9b0" opacity=".8"/><path d="M130 1216C170 830 660 830 700 1216Z" fill="#1d2e27"/><text x="416" y="1120" font-size="54" fill="#f6ead2" text-anchor="middle" font-family="serif">${label}</text></svg>`;
export const image = await sharp(Buffer.from(svg('MOCK'))).png().toBuffer();
export const seen = { chat: [], txt2img: [], prompt: [], auth: [] };

const read = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
export function start(port = 18080) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const body = req.method === 'POST' ? await read(req) : '';
    const p = url.pathname;
    if (p.startsWith('/v1/') || p.startsWith('/bad/')) seen.auth.push(req.headers.authorization ?? '');
    if (p === '/bad/v1/models') return json({ error: { message: 'Incorrect API key provided' } }, 401);
    if (p === '/v1/models') {
      if (req.headers.authorization === 'Bearer wrong') return json({ error: { message: 'Incorrect API key provided' } }, 401);
      return json({ data: [{ id: 'mock-large', context_length: 128000 }, { id: 'mock-mini', context_length: 32000 }, { id: 'text-embedding-x' }] });
    }
    if (p === '/v1/chat/completions') {
      const q = JSON.parse(body); seen.chat.push(q);
      const all = JSON.stringify(q.messages ?? '');
      // 按上下文写画图提示词、从角色卡提取外貌时，回一串标签
      const text = /roleplay character card/.test(all)
        ? (/MINOR_TEST/.test(all) ? 'MINOR' : 'long brown hair, pink eyes, white shirt, beige trench coat')
        : /Danbooru tags/.test(all)
          // 夹带和外貌冲突的发色、发长、瞳色，掌柜的扩展要以外貌为准
          ? '1girl, solo, smile, long brown hair, blonde hair, short hair, blue eyes, holding cup, tavern interior, warm lighting, ethereal, white skin'
          : /image-to-video model|text-to-video model/.test(all)
            ? 'She smiles softly and breathes, her hair sways in the warm light, the camera slowly pushes in.'
            : '（擦了擦杯子）欢迎光临，阿青。外头雨大，先坐。';
      if (q.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const ch of text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
        res.write('data: [DONE]\n\n'); return res.end();
      }
      return json({ choices: [{ message: { role: 'assistant', content: text } }] });
    }
    if (p === '/sdapi/v1/sd-models') return json([{ title: 'mock-xl.safetensors [abc]', model_name: 'mock-xl' }]);
    if (p === '/sdapi/v1/samplers') return json([{ name: 'Euler a' }, { name: 'DPM++ 2M' }]);
    if (p === '/sdapi/v1/schedulers') return json([{ label: 'Automatic' }, { label: 'Karras' }]);
    if (p === '/sdapi/v1/txt2img') { seen.txt2img.push(JSON.parse(body)); await new Promise((r) => setTimeout(r, 1500)); return json({ images: [image.toString('base64')] }); }
    if (p === '/object_info/KSampler') return json({ KSampler: { input: { required: { sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']] } } } });
    if (p === '/object_info/CheckpointLoaderSimple') return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['mock-comfy.safetensors']] } } } });
    if (p === '/object_info/UNETLoader') return json({ UNETLoader: { input: { required: { unet_name: [[]] } } } });
    if (p === '/system_stats') return json({ system: {} });
    if (p === '/object_info/InnkeeperLoadImageBase64') return json({ InnkeeperLoadImageBase64: { input: { required: { data: ['STRING', {}] } } } });
    if (p === '/prompt') { seen.prompt.push(JSON.parse(body)); return json({ prompt_id: 'p1' }); }
    if (p === '/history/p1') return json({ p1: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } });
    if (p === '/view') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(image); }
    json({ error: 'nope ' + p }, 404);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
