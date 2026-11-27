/**
 * 内嵌酒馆窗口的预加载脚本。
 * 只做一件事：首次打开时把界面语言设为简体中文，之后尊重用户在酒馆里的选择。
 * 不向页面暴露任何接口。
 */
try {
  if (location.protocol.startsWith('http') && !localStorage.getItem('language')) {
    localStorage.setItem('language', 'zh-cn');
  }
} catch {
  /* 隐私模式下不可用，忽略 */
}

export {};
