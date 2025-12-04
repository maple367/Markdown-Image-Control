// extension.js

/**
 * 解析 alt 文本中的图片控制指令
 * 例如："示意图 w:200px h:100px blur:5px brightness:1.2"
 */
function parseImageOptions(alt) {
  const parts = alt.split(/\s+/).filter(Boolean);

  const opts = {
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

  for (const p of parts) {
    const m = p.match(/^([a-zA-Z\-]+):(.*)$/);
    if (!m) {
      // 普通文字 → 真 alt 内容
      opts.altText.push(p);
      continue;
    }

    const key = m[1];
    let value = m[2];

    // 没写参数时的一些默认值，可按需调
    if (!value) {
      if (key === 'blur') value = '10px';
      else if (key === 'brightness') value = '1.0';
      else if (key === 'contrast') value = '100%';
      else if (key === 'opacity') value = '1';
      else value = '';
    }

    if (key === 'w' || key === 'width') {
      opts.width = value;
    } else if (key === 'h' || key === 'height') {
      opts.height = value;
    } else if (filterKeys.has(key)) {
      opts.filters.push(`${key}(${value})`);
    } else {
      // 未知指令就当普通文字
      opts.altText.push(p);
    }
  }

  return opts;
}

/**
 * markdown-it 插件：修改 image token
 */
function imageOptionsPlugin(md) {
  md.core.ruler.after('inline', 'image_options', function (state) {
    const tokens = state.tokens;

    for (const token of tokens) {
      if (token.type !== 'inline' || !token.children) continue;

      for (const child of token.children) {
        if (child.type !== 'image') continue;

        // 1. 取出原始 alt 文本
        const rawAlt = child.content || '';
        const opts = parseImageOptions(rawAlt);

        // 2. 还原真正 alt
        const newAlt = opts.altText.join(' ');
        child.content = newAlt;

        const altIdx = child.attrIndex('alt');
        if (altIdx >= 0) {
          child.attrs[altIdx][1] = newAlt;
        } else {
          child.attrPush(['alt', newAlt]);
        }

        // 3. 构造 style
        let style = '';

        if (opts.width) {
          const w = /[a-z%]$/i.test(opts.width) ? opts.width : `${opts.width}px`;
          style += `width:${w};`;
        }

        if (opts.height) {
          const h = /[a-z%]$/i.test(opts.height) ? opts.height : `${opts.height}px`;
          style += `height:${h};`;
        }

        if (opts.filters.length > 0) {
          const filterStr = opts.filters.join(' ');
          style += `filter:${filterStr};`;
        }

        if (!style) continue;

        const styleIdx = child.attrIndex('style');
        if (styleIdx >= 0) {
          // 已有 style（比如别的扩展加的）就拼接
          child.attrs[styleIdx][1] += style;
        } else {
          child.attrPush(['style', style]);
        }
      }
    }
  });
}

/**
 * VS Code 插件入口：返回 extendMarkdownIt
 */
function activate(context) {
  return {
    extendMarkdownIt(md) {
      // 在这里挂上我们的 markdown-it 插件
      return md.use(imageOptionsPlugin);
    }
  };
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
