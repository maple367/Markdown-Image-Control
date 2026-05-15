import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec, spawn } from 'child_process';

interface ImageOptions {
    altText: string[];
    width: string | null;
    height: string | null;
    filters: string[];
}

interface PicgoCommandCandidate {
    command: string;
    argsPrefix: string[];
    displayName: string;
}

interface PicgoUploadResult {
    imageUrl: string | null;
    errorMessage: string | null;
}

/**
 * Parse Marp-like image control directives from markdown image alt text.
 * Example: ![Caption w:200px h:100px blur:5px brightness:1.2](image.png)
 */
function parseImageOptions(alt: string): ImageOptions {
    const parts = alt.split(/\s+/).filter(Boolean);
    const opts: ImageOptions = {
        altText: [],
        width: null,
        height: null,
        filters: []
    };

    const filterKeys = new Set([
        'blur',
        'brightness',
        'contrast',
        'drop-shadow',
        'grayscale',
        'hue-rotate',
        'invert',
        'opacity',
        'saturate',
        'sepia'
    ]);

    for (const part of parts) {
        const match = part.match(/^([a-zA-Z\-]+):(.*)$/);
        if (!match) {
            opts.altText.push(part);
            continue;
        }

        const key = match[1];
        let value = match[2];

        if (!value) {
            if (key === 'blur') {
                value = '10px';
            } else if (key === 'brightness') {
                value = '1.0';
            } else if (key === 'contrast') {
                value = '100%';
            } else if (key === 'opacity') {
                value = '1';
            } else {
                value = '';
            }
        }

        if (key === 'w' || key === 'width') {
            opts.width = value;
        } else if (key === 'h' || key === 'height') {
            opts.height = value;
        } else if (filterKeys.has(key)) {
            opts.filters.push(`${key}(${value})`);
        } else {
            opts.altText.push(part);
        }
    }

    return opts;
}

function normalizeCssLength(value: string): string {
    return /[a-z%]$/i.test(value) ? value : `${value}px`;
}

function splitCommandLine(input: string): string[] {
    const parts: string[] = [];
    const matcher = /"([^"]*)"|'([^']*)'|[^\s]+/g;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(input)) !== null) {
        parts.push(match[1] ?? match[2] ?? match[0]);
    }

    return parts;
}

function buildPicgoCandidates(configuredPath: string): PicgoCommandCandidate[] {
    const raw = configuredPath.trim() || 'picgo';
    const tokens = splitCommandLine(raw);
    const command = tokens[0] || 'picgo';
    const argsPrefix = tokens.slice(1);
    const isDefaultPath = command === 'picgo' && argsPrefix.length === 0;
    const candidates: PicgoCommandCandidate[] = [];

    const addCandidate = (command: string, argsPrefix: string[] = []) => {
        const exists = candidates.some(
            (c) => c.command === command && c.argsPrefix.join('\u0000') === argsPrefix.join('\u0000')
        );
        if (!exists) {
            candidates.push({
                command,
                argsPrefix,
                displayName: [command, ...argsPrefix].join(' ')
            });
        }
    };

    addCandidate(command, argsPrefix);

    if (isDefaultPath) {
        if (process.platform === 'win32') {
            addCandidate('picgo.cmd');
            addCandidate('picgo.exe');
            addCandidate('npx', ['picgo']);
            addCandidate('npx.cmd', ['picgo']);
        } else {
            addCandidate('npx', ['picgo']);
        }
    }

    return candidates;
}

async function showPicgoConfigError(message: string): Promise<void> {
    const openSettingsAction = 'Open PicGo Path Setting';
    const picked = await vscode.window.showErrorMessage(message, openSettingsAction);
    if (picked === openSettingsAction) {
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'markdown-image-control.picgoPath'
        );
    }
}

function imageOptionsPlugin(md: any) {
    md.core.ruler.after('inline', 'markdown_image_control_options', (state: any) => {
        const tokens = state.tokens;

        for (const token of tokens) {
            if (token.type !== 'inline' || !token.children) {
                continue;
            }

            for (const child of token.children) {
                if (child.type !== 'image') {
                    continue;
                }

                const opts = parseImageOptions(child.content || '');
                const newAlt = opts.altText.join(' ');
                child.content = newAlt;

                const altIndex = child.attrIndex('alt');
                if (altIndex >= 0) {
                    child.attrs[altIndex][1] = newAlt;
                } else {
                    child.attrPush(['alt', newAlt]);
                }

                let style = '';
                if (opts.width) {
                    style += `width:${normalizeCssLength(opts.width)};`;
                }
                if (opts.height) {
                    style += `height:${normalizeCssLength(opts.height)};`;
                }
                if (opts.filters.length > 0) {
                    style += `filter:${opts.filters.join(' ')};`;
                }
                if (!style) {
                    continue;
                }

                const styleIndex = child.attrIndex('style');
                if (styleIndex >= 0) {
                    const existing = child.attrs[styleIndex][1] || '';
                    child.attrs[styleIndex][1] = existing.endsWith(';') || existing === '' ? `${existing}${style}` : `${existing};${style}`;
                } else {
                    child.attrPush(['style', style]);
                }
            }
        }
    });
}

/**
 * 获取配置
 */
function getConfig() {
    const config = vscode.workspace.getConfiguration('markdown-image-control');
    return {
        picgoPath: config.get<string>('picgoPath', 'picgo'),
        autoUploadOnPaste: config.get<boolean>('autoUploadOnPaste', true)
    };
}

/**
 * 将剪贴板图片保存到临时文件
 */
async function saveClipboardImageToFile(): Promise<string | null> {
    const tempDir = os.tmpdir();
    const tempFileName = `vscode_picgo_${Date.now()}.png`;
    const tempFilePath = path.join(tempDir, tempFileName);

    return new Promise((resolve) => {
        if (process.platform === 'darwin') {
            // macOS: 使用 osascript 保存剪贴板图片
            const script = `
                set theFile to POSIX file "${tempFilePath}"
                try
                    set imageData to the clipboard as «class PNGf»
                    set fileRef to open for access theFile with write permission
                    write imageData to fileRef
                    close access fileRef
                    return "success"
                on error
                    try
                        close access theFile
                    end try
                    return "no image"
                end try
            `;
            
            exec(`osascript -e '${script}'`, (error, stdout) => {
                if (error || stdout.trim() !== 'success') {
                    resolve(null);
                } else {
                    resolve(tempFilePath);
                }
            });
        } else if (process.platform === 'win32') {
            // Windows: 使用 PowerShell
            const script = `
                Add-Type -AssemblyName System.Windows.Forms
                $img = [System.Windows.Forms.Clipboard]::GetImage()
                if ($img -ne $null) {
                    $img.Save('${tempFilePath.replace(/\\/g, '\\\\')}')
                    Write-Output "success"
                } else {
                    Write-Output "no image"
                }
            `;
            
            exec(`powershell -command "${script}"`, (error, stdout) => {
                if (error || stdout.trim() !== 'success') {
                    resolve(null);
                } else {
                    resolve(tempFilePath);
                }
            });
        } else {
            // Linux: 使用 xclip
            exec(`xclip -selection clipboard -t image/png -o > "${tempFilePath}"`, (error) => {
                if (error) {
                    resolve(null);
                } else {
                    fs.stat(tempFilePath, (err, stats) => {
                        if (err || stats.size === 0) {
                            resolve(null);
                        } else {
                            resolve(tempFilePath);
                        }
                    });
                }
            });
        }
    });
}

/**
 * 从 DataTransfer 保存图片到临时文件
 */
async function saveDataTransferImageToFile(dataTransfer: vscode.DataTransfer): Promise<string | null> {
    const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
    
    for (const mimeType of imageTypes) {
        const item = dataTransfer.get(mimeType);
        if (item) {
            try {
                const file = item.asFile();
                if (file) {
                    const data = await file.data();
                    if (data && data.byteLength > 0) {
                        const ext = mimeType.split('/')[1] || 'png';
                        const tempDir = os.tmpdir();
                        const tempFileName = `vscode_picgo_${Date.now()}.${ext}`;
                        const tempFilePath = path.join(tempDir, tempFileName);
                        
                        fs.writeFileSync(tempFilePath, Buffer.from(data));
                        return tempFilePath;
                    }
                }
            } catch (e) {
                console.error('Failed to read image from DataTransfer:', e);
            }
        }
    }
    
    return null;
}

/**
 * 调用 picgo 上传图片
 */
async function uploadWithPicgo(imagePath: string): Promise<string | null> {
    const config = getConfig();
    const candidates = buildPicgoCandidates(config.picgoPath);
    const attempted: string[] = [];
    const runtimeErrors: string[] = [];

    for (const candidate of candidates) {
        attempted.push(candidate.displayName);

        const result = await new Promise<PicgoUploadResult>((resolve) => {
            const args = [...candidate.argsPrefix, 'upload', imagePath];
            let settled = false;
            const finish = (value: PicgoUploadResult) => {
                if (!settled) {
                    settled = true;
                    resolve(value);
                }
            };

            let picgo;
            try {
                picgo = spawn(candidate.command, args, {
                    shell: process.platform === 'win32',
                    windowsHide: true
                });
            } catch (err) {
                const spawnErr = err as NodeJS.ErrnoException;
                runtimeErrors.push(
                    `Command '${candidate.displayName}' threw before start: ${spawnErr.message}`
                );
                finish({ imageUrl: null, errorMessage: null });
                return;
            }

            let stdout = '';
            let stderr = '';

            picgo.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            picgo.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            picgo.on('close', (code: number | null) => {
                if (code === 0) {
                    // picgo 成功时会输出上传后的 URL
                    const urlMatch = stdout.match(/https?:\/\/[^\s\]\n]+/);
                    if (urlMatch) {
                        finish({ imageUrl: urlMatch[0].trim(), errorMessage: null });
                        return;
                    }

                    const trimmedOutput = stdout.trim();
                    if (trimmedOutput.startsWith('http')) {
                        finish({ imageUrl: trimmedOutput.split('\n')[0].trim(), errorMessage: null });
                        return;
                    }

                    runtimeErrors.push(`Command '${candidate.displayName}' succeeded but returned no URL.`);
                    if (trimmedOutput) {
                        console.log('PicGo output:', trimmedOutput);
                    }
                    finish({ imageUrl: null, errorMessage: null });
                    return;
                }

                const errorText = (stderr || stdout).trim();
                runtimeErrors.push(
                    errorText
                        ? `Command '${candidate.displayName}' failed (exit code ${code}): ${errorText}`
                        : `Command '${candidate.displayName}' failed with exit code ${code}.`
                );
                finish({ imageUrl: null, errorMessage: null });
            });

            picgo.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code !== 'ENOENT') {
                    runtimeErrors.push(
                        `Command '${candidate.displayName}' failed to start: ${err.message}`
                    );
                }
                finish({ imageUrl: null, errorMessage: null });
            });
        });

        if (result.imageUrl) {
            return result.imageUrl;
        }
    }

    const attemptedText = attempted.join(', ');
    const detailText = runtimeErrors.length > 0 ? ` Details: ${runtimeErrors[0]}` : '';
    const message = `PicGo command not found or failed. Tried: ${attemptedText}. Configure 'markdown-image-control.picgoPath' to your PicGo executable.${detailText}`;
    console.error(message);

    return null;
}

/**
 * 在编辑器中插入 Markdown 图片链接
 */
async function insertMarkdownImage(editor: vscode.TextEditor, imageUrl: string) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    
    const altText = selectedText || 'image';
    const markdownImage = `![${altText}](${imageUrl})`;

    await editor.edit((editBuilder) => {
        if (selection.isEmpty) {
            editBuilder.insert(selection.active, markdownImage);
        } else {
            editBuilder.replace(selection, markdownImage);
        }
    });
}

/**
 * 上传剪贴板图片的主函数（手动触发）
 */
async function uploadClipboardImage() {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
    }

    if (editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('PicGo Paste only works in Markdown files');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Uploading image...',
            cancellable: false
        },
        async () => {
            try {
                const tempImagePath = await saveClipboardImageToFile();
                
                if (!tempImagePath) {
                    vscode.window.showWarningMessage('No image found in clipboard');
                    return;
                }

                const imageUrl = await uploadWithPicgo(tempImagePath);
                
                try {
                    fs.unlinkSync(tempImagePath);
                } catch (e) {
                    // 忽略清理错误
                }

                if (!imageUrl) {
                    await showPicgoConfigError('Failed to upload image with PicGo. Please check setting markdown-image-control.picgoPath.');
                    return;
                }

                await insertMarkdownImage(editor, imageUrl);
                vscode.window.showInformationMessage('Image uploaded successfully!');
                
            } catch (error) {
                vscode.window.showErrorMessage(`Error: ${error}`);
            }
        }
    );
}

/**
 * DocumentPasteEditProvider - 实现粘贴时自动上传
 * 这是 VSCode 1.82+ 的官方 API，可以拦截粘贴操作
 */
class PicgoPasteEditProvider implements vscode.DocumentPasteEditProvider {
    
    private static readonly kind = vscode.DocumentDropOrPasteEditKind.Empty.append('picgo', 'upload');

    async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        
        const config = getConfig();
        
        if (!config.autoUploadOnPaste) {
            return undefined;
        }

        // 检查是否有图片
        let hasImage = false;
        for (const [mimeType] of dataTransfer) {
            if (mimeType.startsWith('image/')) {
                hasImage = true;
                break;
            }
        }

        if (!hasImage) {
            return undefined;
        }

        // 检查是否已取消
        if (token.isCancellationRequested) {
            return undefined;
        }

        // 从 DataTransfer 获取图片并保存
        let tempImagePath = await saveDataTransferImageToFile(dataTransfer);
        
        // 如果 DataTransfer 没有图片数据，尝试从系统剪贴板获取
        if (!tempImagePath) {
            tempImagePath = await saveClipboardImageToFile();
        }

        if (!tempImagePath) {
            return undefined;
        }

        // 显示上传状态
        const imageUrl = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Uploading image to PicGo...',
                cancellable: false
            },
            async () => {
                const result = await uploadWithPicgo(tempImagePath!);
                
                // 清理临时文件
                try {
                    fs.unlinkSync(tempImagePath!);
                } catch (e) {
                    // 忽略
                }

                return result;
            }
        );

        if (!imageUrl) {
            await showPicgoConfigError('Failed to upload image with PicGo. Please check setting markdown-image-control.picgoPath.');
            return undefined;
        }

        // 创建 Markdown 图片链接
        const markdownImage = `![image](${imageUrl})`;
        
        // 创建粘贴编辑（新 API 需要 3 个参数：insertText, title, kind）
        const pasteEdit = new vscode.DocumentPasteEdit(
            markdownImage,
            'Upload with PicGo',
            PicgoPasteEditProvider.kind
        );
        
        vscode.window.showInformationMessage('Image uploaded successfully!');
        
        return [pasteEdit];
    }
}

/**
 * 扩展激活时调用
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Markdown Image PicGo Control extension is now active!');

    // 注册手动上传命令 (Cmd+Alt+V)
    const uploadCommand = vscode.commands.registerCommand(
        'markdown-image-control.uploadFromClipboard',
        uploadClipboardImage
    );
    context.subscriptions.push(uploadCommand);

    // 注册 DocumentPasteEditProvider
    // 这是 VSCode 官方的粘贴拦截 API，当粘贴图片时会自动触发
    const selector: vscode.DocumentSelector = { language: 'markdown' };
    
    const pasteProvider = vscode.languages.registerDocumentPasteEditProvider(
        selector,
        new PicgoPasteEditProvider(),
        {
            providedPasteEditKinds: [
                vscode.DocumentDropOrPasteEditKind.Empty.append('picgo', 'upload')
            ],
            pasteMimeTypes: ['image/*', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']
        }
    );
    context.subscriptions.push(pasteProvider);

    console.log('Markdown Image PicGo Control: DocumentPasteEditProvider registered for Markdown files');

    return {
        extendMarkdownIt(md: any) {
            return md.use(imageOptionsPlugin);
        }
    };
}

/**
 * 扩展停用时调用
 */
export function deactivate() {}
