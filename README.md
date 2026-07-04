# Markdown Image Control

A self-hosted VS Code extension that combines:

- PicGo image upload on Markdown paste / command (`Cmd+Alt+V` on macOS, `Ctrl+Alt+V` elsewhere)
- Markdown preview image control syntax from `Markdown-Image-Control`

## Features

### Upload pasted images with PicGo

When editing Markdown, paste an image or run **Markdown Image: Upload Image from Clipboard with PicGo**. The extension uploads the image through PicGo CLI and inserts:

```markdown
![image](https://...)
```

Supported image handling:

- Direct upload for Markdown-friendly formats such as PNG, JPG/JPEG, GIF, WEBP, BMP, and SVG
- Automatic conversion to PNG for unsupported formats before upload, including HEIC, HEIF, and TIFF

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

-- `markdown-image-control.picgoPath`: PicGo CLI executable path. Default: `picgo`
-- `markdown-image-control.autoUploadOnPaste`: automatically upload image paste in Markdown. Default: `true`

## Implementation notes

- The extension uses `sharp` for image format conversion, so no extra image codec dependency is required for the common conversion flow.
- If a pasted image is not directly supported by Markdown preview, it is converted to PNG and then uploaded through PicGo.

## Build locally

```bash
npm install
npm run compile
npx @vscode/vsce package
code --install-extension markdown-image-control-0.2.0.vsix
```

## Credits / upstream

This self-hosted integration is based on:

- https://github.com/zcyisiee/vscode-picgo-paste
- https://github.com/maple367/Markdown-Image-Control
