## 下载哪个

| 系统 | 文件 |
| --- | --- |
| Windows 10 / 11（64 位） | `Innkeeper-*-setup.exe` |
| Mac，Apple 芯片（M1 及以后） | `Innkeeper-*-mac-arm64.dmg` |
| Mac，Intel 芯片 | `Innkeeper-*-mac-x64.dmg` |

不确定是哪种 Mac：点左上角苹果菜单 →「关于本机」，「芯片」一栏写着 Apple M 开头的就是 Apple 芯片。

## 第一次打开

**Windows**：安装包没有代码签名，会提示「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」。

**Mac**：没有苹果开发者证书，没做公证。打开 dmg，把「掌柜」拖进「应用程序」，第一次双击会提示无法验证开发者：

1. 点「完成」关掉提示；
2. 打开「系统设置 → 隐私与安全性」，拉到最下面，点「掌柜」旁边的「仍要打开」，输入开机密码确认。

之后就能正常双击打开。也可以在「终端」里运行一次 `xattr -cr /Applications/掌柜.app`，效果一样。

## Mac 版说明

- 要 macOS 12 或更新的系统。
- 一键配置、多版本酒馆、模型接入、云端生图与配音、插件、角色卡、备份、手机连接和 Windows 版一样。没装 Node 时会自动下载便携版；没装 Xcode 命令行工具也能克隆插件。
- 本机对话引擎（llama.cpp）：Apple 芯片用 Metal 加速，要 macOS 13.3 以上；Intel 芯片只有 CPU 版。
- 本机语音（Kokoro）：Apple 芯片和 Intel 都能用。
- 轻量生图引擎（stable-diffusion.cpp）：上游的 Mac 版要 macOS 26 以上。
- ComfyUI 没有 Mac 便携版：按官方说明装好源码版（带 venv）后，在生图页「绑定已有目录」。
- 声线克隆（GPT-SoVITS）官方只有 Windows 整合包，Mac 上暂时用不了。
- 关闭窗口只是收起，酒馆继续营业，点程序坞图标回来；⌘Q 退出时酒馆一起打烊。

`SHA256SUMS.txt` 是各文件的校验值。
