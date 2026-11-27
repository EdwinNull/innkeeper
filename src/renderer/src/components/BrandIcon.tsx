import { HardDrives } from '@phosphor-icons/react';

const files = import.meta.glob<string>(
  '../../../../node_modules/@lobehub/icons-static-svg/icons/{openai,claude,gemini,deepseek,openrouter,moonshot,zhipu,qwen,siliconcloud,grok,mistral,groq,ollama,lmstudio,doubao,minimax,cohere,fireworks,together,novelai,stability,comfyui,pollinations,hunyuan,stepfun,zai,automatic,venice,infermatic,elevenlabs,azure}.svg',
  { eager: true, query: '?raw', import: 'default' },
);

const icons = new Map(Object.entries(files).map(([path, svg]) => [path.split('/').pop()!.replace('.svg', ''), svg]));

/** 服务商标志，统一单色，跟随文字颜色。 */
export function BrandIcon({ name, size = 20 }: { name: string; size?: number }) {
  const svg = icons.get(name);
  if (!svg) return <HardDrives size={size} weight="light" style={{ flexShrink: 0 }} />;
  return <span className="brand-icon" style={{ fontSize: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
