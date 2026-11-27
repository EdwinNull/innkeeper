import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/noto-sans-sc/wght.css';
import '@fontsource-variable/noto-serif-sc/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isMac } from './lib/platform';
import { boot } from './lib/store';

// mac 的红绿灯在左上角，侧栏要让出位置
document.documentElement.dataset.os = isMac ? 'mac' : 'win';

// 拖进窗口的文件只由各页面自己处理，避免误触跳转
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(<App />);
void boot();
