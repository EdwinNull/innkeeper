/** 渲染层只需要知道是不是 mac：窗口按钮的位置、系统名称、只有 Windows 版的功能。 */
export const isMac = navigator.userAgent.includes('Macintosh');
