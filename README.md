# Markdown Image PicGo Control

A self-hosted VS Code extension that combines:

- PicGo image upload on Markdown paste / command (`Cmd+Alt+V` on macOS, `Ctrl+Alt+V` elsewhere)
- Markdown preview image control syntax from `Markdown-Image-Control`

## Features

### Upload pasted images with PicGo

When editing Markdown, paste an image or run **Markdown Image: Upload Image from Clipboard with PicGo**. The extension uploads the image through PicGo CLI and inserts:

```markdown
![image](https://...)
```

### Control Markdown preview image style

Use directives in image alt text:

```markdown
![caption w:320 h:180 blur:2px brightness:1.1](./image.png)
```

Supported size directives:

- `w:` / `width:`
- `h:` / `height:`

Supported CSS filter directives:

- `blur`, `brightness`, `contrast`, `drop-shadow`, `grayscale`, `hue-rotate`, `invert`, `opacity`, `saturate`, `sepia`

Directives are removed from the rendered `alt` text and converted to inline styles in VS Code Markdown preview.

## Settings

- `markdown-image-picgo-control.picgoPath`: PicGo CLI executable path. Default: `picgo`
- `markdown-image-picgo-control.autoUploadOnPaste`: automatically upload image paste in Markdown. Default: `true`

## Build locally

```bash
npm install
npm run compile
npx @vscode/vsce package
code --install-extension markdown-image-picgo-control-0.1.0.vsix
```

## Credits / upstream

This self-hosted integration is based on:

- https://github.com/zcyisiee/vscode-picgo-paste
- https://github.com/maple367/Markdown-Image-Control
