import { existsSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import { JSDOM } from 'jsdom';
import type { Presentation } from '@noppt/core';
import type { StorageService } from '../../common/storage.service';
import { sanitizeHtmlServerSide } from '../../utils/sanitize';
import type { Locale } from '../../i18n/types';

/**
 * 自包含 deck 组装器（规格 3.3.6 / 2.5.7）。
 *
 * 仓库内原本**没有**任何服务端 deck 组装代码（只有前端 ExportModal 的静态长页外壳），本文件为新建：
 * 1. 逐页 `sanitizeHtmlServerSide` 清洗；
 * 2. 把 `img[src]` 与内联 `style` 里的 `url(...)` 资源内联成 data URL（本地 `/data/**` 读盘，远程 http(s) 拉取）；
 * 3. 套自包含外壳 + 键盘/点击/翻页运行时。
 *
 * 因为资源已内联，产物为单文件、可离线打开，**无需把 `data/tenants` 暴露到静态托管**
 * （直接消解规格 D-11 的静态托管绕过隔离风险）。
 * `noppt_export_html` 与 `/api/mcp-view` 复用同一条链。
 */

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

/** 单文件内联上限：超过则保留原 URL（避免产物体积失控）。 */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export interface DeckBuildResult {
  html: string;
  /** 内联成功 / 失败的资源数，便于审计与排障 */
  inlined: number;
  failed: number;
}

function mimeOf(filePathOrUrl: string): string {
  return (
    MIME_BY_EXT[extname(filePathOrUrl.split('?')[0]).toLowerCase()] || 'application/octet-stream'
  );
}

/** 把 `/data/**` 的公开 URL 还原成本地文件路径（支持作用域目录）。 */
function resolveLocalPath(publicUrl: string): string | null {
  if (!publicUrl.startsWith('/data/')) return null;
  const rel = publicUrl.slice('/data/'.length).split('?')[0];
  // 归一化后再拼接，杜绝 `..` 穿越
  const normalized = rel.replace(/\.\./g, '');
  return join(process.cwd(), 'data', normalized);
}

/**
 * 组装自包含 deck HTML。
 * @param presentation 演示数据（含逐页 slide.html）
 * @param _storage 作用域 storage（当前用于定位资源根目录；保留参数以便后续扩展）
 */
export async function buildSelfContainedDeck(
  presentation: Presentation,
  _storage?: StorageService,
  lang: Locale = 'zh-CN',
): Promise<DeckBuildResult> {
  const width = Number(presentation?.width) || 1280;
  const height = Number(presentation?.height) || 720;
  const slides = (presentation?.slides || []).filter((s) => !s.hidden);
  const title = escapeHtml(presentation?.title || '演示');

  const cache = new Map<string, string>();
  let inlined = 0;
  let failed = 0;

  const toDataUrl = async (src: string): Promise<string | null> => {
    if (!src) return null;
    if (src.startsWith('data:')) return null;
    if (cache.has(src)) return cache.get(src) ?? null;

    let dataUrl: string | null = null;
    try {
      if (/^https?:\/\//i.test(src)) {
        const res = await fetch(src, { redirect: 'follow' });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length && buf.length <= MAX_INLINE_BYTES) {
            dataUrl = `data:${mimeOf(src)};base64,${buf.toString('base64')}`;
          }
        }
      } else {
        const file = resolveLocalPath(src);
        if (file && existsSync(file)) {
          const buf = readFileSync(file);
          if (buf.length && buf.length <= MAX_INLINE_BYTES) {
            dataUrl = `data:${mimeOf(file)};base64,${buf.toString('base64')}`;
          }
        }
      }
    } catch {
      dataUrl = null;
    }

    if (dataUrl) {
      inlined += 1;
      cache.set(src, dataUrl);
    } else {
      failed += 1;
      cache.set(src, '');
    }
    return dataUrl;
  };

  const slideHtmlList: string[] = [];
  for (const slide of slides) {
    const sanitized = sanitizeHtmlServerSide(slide.html || '');
    const dom = new JSDOM('<body></body>');
    const doc = dom.window.document;
    doc.body.innerHTML = sanitized;

    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src');
      if (!src) continue;
      const dataUrl = await toDataUrl(src);
      if (dataUrl) img.setAttribute('src', dataUrl);
    }

    for (const el of Array.from(doc.querySelectorAll('*'))) {
      const style = el.getAttribute('style');
      if (!style || !/url\(/i.test(style)) continue;
      const urls = Array.from(style.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)).map((m) => m[2]);
      let next = style;
      for (const u of urls) {
        const dataUrl = await toDataUrl(u);
        if (dataUrl) next = next.split(u).join(dataUrl);
      }
      if (next !== style) el.setAttribute('style', next);
    }

    slideHtmlList.push(doc.body.innerHTML);
  }

  const slidesMarkup = slideHtmlList
    .map(
      (html, i) =>
        `<section class="slide${i === 0 ? ' is-active' : ''}" data-index="${i}">${html}</section>`,
    )
    .join('\n');

  const html = renderShell({
    title,
    width,
    height,
    slidesMarkup,
    total: slideHtmlList.length,
    lang,
  });
  return { html, inlined, failed };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * deck 外壳。**不使用模板字符串内嵌脚本**：脚本单独用普通字符串定义，
 * 避免 `${}` / 反引号与 HTML 模板冲突。
 */
function renderShell(ctx: {
  title: string;
  width: number;
  height: number;
  slidesMarkup: string;
  total: number;
  lang: Locale;
}): string {
  const script = [
    '(function(){',
    'var W=' + ctx.width + ',H=' + ctx.height + ',TOTAL=' + ctx.total + ';',
    'var slides=[].slice.call(document.querySelectorAll(".slide"));',
    'var stage=document.getElementById("stage");',
    'var indicator=document.getElementById("indicator");',
    'var prevBtn=document.getElementById("prev"),nextBtn=document.getElementById("next");',
    'var idx=0;',
    'function fit(){',
    'var availW=Math.max(320,window.innerWidth-96);',
    'var availH=Math.max(240,window.innerHeight-140);',
    'var s=Math.min(availW/W,availH/H);',
    'stage.style.width=(W*s)+"px";stage.style.height=(H*s)+"px";',
    'for(var i=0;i<slides.length;i++){slides[i].style.transform="scale("+s+")";}',
    '}',
    'function show(i){',
    'idx=Math.max(0,Math.min(slides.length-1,i));',
    'for(var k=0;k<slides.length;k++){slides[k].classList.toggle("is-active",k===idx);}',
    'indicator.textContent=(idx+1)+" / "+TOTAL;',
    'prevBtn.disabled=idx===0;nextBtn.disabled=idx===slides.length-1;',
    'try{parent.postMessage({type:"noppt:index",index:idx,total:TOTAL},"*");}catch(e){}',
    '}',
    'function next(){show(idx+1);}function prev(){show(idx-1);}',
    'prevBtn.addEventListener("click",prev);nextBtn.addEventListener("click",next);',
    'document.addEventListener("keydown",function(e){',
    'if(e.key==="ArrowRight"||e.key===" "||e.key==="PageDown"||e.key==="Enter"){e.preventDefault();next();}',
    'else if(e.key==="ArrowLeft"||e.key==="PageUp"||e.key==="Backspace"){e.preventDefault();prev();}',
    'else if(e.key==="Home"){e.preventDefault();show(0);}',
    'else if(e.key==="End"){e.preventDefault();show(slides.length-1);}',
    '});',
    'stage.addEventListener("click",function(e){',
    'var r=stage.getBoundingClientRect();',
    'if(e.clientX-r.left>r.width/2){next();}else{prev();}',
    '});',
    'window.addEventListener("resize",fit);',
    'window.addEventListener("message",function(e){',
    'var d=e.data;var cmd=(d&&d.type)?d.type:d;',
    'if(cmd==="noppt:next"){next();}else if(cmd==="noppt:prev"){prev();}',
    'else if(cmd==="noppt:go"&&d&&typeof d.index==="number"){show(d.index);}',
    '});',
    'fit();show(0);',
    '})();',
  ].join('');

  return [
    '<!DOCTYPE html>',
    '<html lang="' + (ctx.lang === 'en' ? 'en' : 'zh-CN') + '">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>' + ctx.title + '</title>',
    '<style>',
    '*{box-sizing:border-box;}',
    'html,body{height:100%;}',
    'body{margin:0;background:#0F172A;color:#F1F5F9;',
    'font-family:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;overflow:hidden;}',
    '.deck-head{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:500;color:#94A3B8;',
    'max-width:92vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.deck-head .badge{border:1px solid #334155;border-radius:999px;padding:2px 10px;font-size:12px;color:#CBD5E1;}',
    '#stage{position:relative;background:#FFFFFF;border-radius:12px;overflow:hidden;',
    'box-shadow:0 24px 60px rgba(2,6,23,.55);cursor:pointer;}',
    '.slide{position:absolute;left:0;top:0;transform-origin:0 0;opacity:0;pointer-events:none;',
    'width:' + ctx.width + 'px;height:' + ctx.height + 'px;overflow:hidden;background:#fff;',
    'transition:opacity .22s ease;}',
    '.slide.is-active{opacity:1;pointer-events:auto;}',
    '.deck-bar{display:flex;align-items:center;gap:14px;}',
    '.deck-bar button{appearance:none;border:1px solid #334155;background:#1E293B;color:#E2E8F0;',
    'height:36px;padding:0 18px;border-radius:999px;font-size:13px;cursor:pointer;transition:all .18s ease;}',
    '.deck-bar button:hover:not(:disabled){border-color:#2563EB;color:#fff;transform:translateY(-1px);',
    'box-shadow:0 6px 16px rgba(37,99,235,.28);}',
    '.deck-bar button:disabled{opacity:.4;cursor:not-allowed;}',
    '#indicator{font-size:13px;color:#94A3B8;min-width:56px;text-align:center;font-variant-numeric:tabular-nums;}',
    '.deck-empty{color:#94A3B8;font-size:14px;}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="deck-head"><span class="badge">只读 · Hermes 产物</span><span>' +
      ctx.title +
      '</span></div>',
    ctx.total > 0
      ? '<div id="stage">' + ctx.slidesMarkup + '</div>'
      : '<div class="deck-empty">该演示暂无可展示的页面</div>',
    '<div class="deck-bar">',
    '<button id="prev" type="button" aria-label="上一页">上一页</button>',
    '<span id="indicator">1 / ' + Math.max(1, ctx.total) + '</span>',
    '<button id="next" type="button" aria-label="下一页">下一页</button>',
    '</div>',
    ctx.total > 0 ? '<script>' + script + '</script>' : '',
    '</body>',
    '</html>',
  ].join('');
}
