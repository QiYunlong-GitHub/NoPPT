import { useState } from 'react';
import { X, Download, FileCode, FileText, Image, Loader2, Package } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { usePresentationStore } from '@/stores/presentation';
import { useSettingsStore } from '@/stores/settings';
import { toHtmlLang, useI18n } from '@/i18n';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';

export default function ExportModal() {
  const { t } = useI18n();
  const setExportModal = useUIStore((s) => s.setExportModal);
  const presentation = usePresentationStore((s) => s.presentation);
  const showToast = useUIStore((s) => s.showToast);

  const [exporting, setExporting] = useState<string | null>(null);

  const exportFormats = [
    {
      id: 'html',
      name: 'HTML',
      desc: t('单文件网页，嵌入所有资源，可离线浏览'),
      icon: FileCode,
      color: 'text-orange-500 bg-orange-50',
    },
    {
      id: 'zip',
      name: t('ZIP 网页包'),
      desc: t('HTML + 资源文件夹，相对路径引用，文件更小'),
      icon: Package,
      color: 'text-purple-500 bg-purple-50',
    },
    {
      id: 'pdf',
      name: 'PDF',
      desc: t('便携式文档格式'),
      icon: FileText,
      color: 'text-red-500 bg-red-50',
    },
    {
      id: 'png',
      name: t('PNG 图片'),
      desc: t('每页一张图片'),
      icon: Image,
      color: 'text-green-500 bg-green-50',
    },
  ];

  const handleExport = async (formatId: string) => {
    if (!presentation) return;
    setExporting(formatId);

    try {
      switch (formatId) {
        case 'html':
          await exportHTML();
          break;
        case 'zip':
          await exportZIP();
          break;
        case 'pdf':
          await exportPDF();
          break;
        case 'png':
          await exportPNG();
          break;
      }
      showToast(t('导出成功！'), 'success');
      setExportModal(false);
    } catch (error) {
      console.error('Export failed:', error);
      showToast(t('导出失败，请重试'), 'error');
    } finally {
      setExporting(null);
    }
  };

  const exportHTML = async () => {
    if (!presentation) return;

    const slideWidth = presentation.width || 1280;
    const slideHeight = presentation.height || 720;

    const urlToDataUrl = async (url: string): Promise<string> => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.error('Failed to load asset:', url, err);
        return url;
      }
    };

    const extractBackgroundUrls = (cssText: string): string[] => {
      const urls: string[] = [];
      const regex = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
      let match;
      while ((match = regex.exec(cssText)) !== null) {
        const u = match[1].trim();
        if (u && !u.startsWith('data:') && !u.startsWith('http') && !u.startsWith('#')) {
          urls.push(u);
        }
      }
      return urls;
    };

    const processSlideHtml = async (html: string): Promise<string> => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      const allElements = tempDiv.querySelectorAll('*');
      allElements.forEach((el) => {
        const element = el as HTMLElement;
        element.style.cursor = '';
        element.style.userSelect = '';
        element.removeAttribute('contenteditable');
        element.classList.remove('noppt-selected');
        if (element.style.boxShadow === 'inset 0 0 0 3px rgb(59, 130, 246)' || 
            element.style.boxShadow === '0 0 0 3px #3b82f6') {
          element.style.boxShadow = '';
        }
      });
      
      const images = tempDiv.querySelectorAll('img');
      for (const img of images) {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
          const dataUrl = await urlToDataUrl(src);
          img.setAttribute('src', dataUrl);
        }
      }
      
      const videos = tempDiv.querySelectorAll('video');
      for (const video of videos) {
        const src = video.getAttribute('src');
        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
          const dataUrl = await urlToDataUrl(src);
          video.setAttribute('src', dataUrl);
        }
      }

      const bgElements = tempDiv.querySelectorAll('*');
      for (const el of bgElements) {
        const elem = el as HTMLElement;
        const styleAttr = elem.getAttribute('style') || '';
        const bgUrls = extractBackgroundUrls(styleAttr);
        if (bgUrls.length > 0) {
          let newStyle = styleAttr;
          for (const bgUrl of bgUrls) {
            const dataUrl = await urlToDataUrl(bgUrl);
            newStyle = newStyle.split(bgUrl).join(dataUrl);
          }
          elem.setAttribute('style', newStyle);
        }
      }
      
      return tempDiv.innerHTML;
    };

    const processedSlides = [];
    for (const slide of presentation.slides) {
      const processedHtml = await processSlideHtml(slide.html);
      processedSlides.push(processedHtml);
    }

    const slidesHTML = processedSlides
      .map((html) => {
        return `
<div class="slide" style="page-break-after: always; position: relative; width: ${slideWidth}px; height: ${slideHeight}px; background: #ffffff; margin: 40px auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden;">
  ${html}
</div>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="${toHtmlLang(useSettingsStore.getState().interfaceSettings.language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${presentation.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f1f5f9; padding: 40px 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .slide { overflow: hidden; }
    @media print {
      body { background: white; padding: 0; }
      .slide { margin: 0; box-shadow: none; page-break-after: always; }
    }
  </style>
</head>
<body>
  <h1 style="text-align: center; margin-bottom: 40px; color: #1e293b;">${presentation.title}</h1>
  ${slidesHTML}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `${presentation.title}.html`);
  };

  const exportZIP = async () => {
    if (!presentation) return;

    const zip = new JSZip();
    const assetsFolder = zip.folder('assets');
    const imagesFolder = assetsFolder?.folder('images');
    const videosFolder = assetsFolder?.folder('videos');

    const urlToBlob = async (url: string): Promise<Blob> => {
      const response = await fetch(url);
      return response.blob();
    };

    const processedAssets = new Map<string, string>();

    const getFileName = (url: string, isImage: boolean): string => {
      if (processedAssets.has(url)) {
        return processedAssets.get(url)!;
      }
      const parts = url.split('/');
      const originalName = parts[parts.length - 1] || (isImage ? 'image.png' : 'video.mp4');
      const cleanName = decodeURIComponent(originalName.split('?')[0]);
      processedAssets.set(url, cleanName);
      return cleanName;
    };

    const extractBackgroundUrls = (cssText: string): string[] => {
      const urls: string[] = [];
      const regex = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
      let match;
      while ((match = regex.exec(cssText)) !== null) {
        const u = match[1].trim();
        if (u && !u.startsWith('data:') && !u.startsWith('http') && !u.startsWith('#')) {
          urls.push(u);
        }
      }
      return urls;
    };

    const processSlideHtml = async (html: string): Promise<string> => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      const allElements = tempDiv.querySelectorAll('*');
      allElements.forEach((el) => {
        const element = el as HTMLElement;
        element.style.cursor = '';
        element.style.userSelect = '';
        element.removeAttribute('contenteditable');
        element.classList.remove('noppt-selected');
        if (element.style.boxShadow === 'inset 0 0 0 3px rgb(59, 130, 246)' || 
            element.style.boxShadow === '0 0 0 3px #3b82f6') {
          element.style.boxShadow = '';
        }
      });
      
      const images = tempDiv.querySelectorAll('img');
      for (const img of images) {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
          try {
            const blob = await urlToBlob(src);
            const fileName = getFileName(src, true);
            imagesFolder?.file(fileName, blob);
            img.setAttribute('src', `assets/images/${fileName}`);
          } catch (err) {
            console.error('Failed to process image:', src, err);
          }
        }
      }
      
      const videos = tempDiv.querySelectorAll('video');
      for (const video of videos) {
        const src = video.getAttribute('src');
        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
          try {
            const blob = await urlToBlob(src);
            const fileName = getFileName(src, false);
            videosFolder?.file(fileName, blob);
            video.setAttribute('src', `assets/videos/${fileName}`);
          } catch (err) {
            console.error('Failed to process video:', src, err);
          }
        }
      }

      const bgElements = tempDiv.querySelectorAll('*');
      for (const el of bgElements) {
        const elem = el as HTMLElement;
        const styleAttr = elem.getAttribute('style') || '';
        const bgUrls = extractBackgroundUrls(styleAttr);
        if (bgUrls.length > 0) {
          let newStyle = styleAttr;
          for (const bgUrl of bgUrls) {
            try {
              const blob = await urlToBlob(bgUrl);
              const fileName = getFileName(bgUrl, true);
              imagesFolder?.file(fileName, blob);
              newStyle = newStyle.split(bgUrl).join(`assets/images/${fileName}`);
            } catch (err) {
              console.error('Failed to process background image:', bgUrl, err);
            }
          }
          elem.setAttribute('style', newStyle);
        }
      }
      
      return tempDiv.innerHTML;
    };

    const slideWidth = presentation.width || 1280;
    const slideHeight = presentation.height || 720;

    const processedSlides = [];
    for (const slide of presentation.slides) {
      const processedHtml = await processSlideHtml(slide.html);
      processedSlides.push(processedHtml);
    }

    const slidesHTML = processedSlides
      .map((html) => {
        return `
<div class="slide" style="page-break-after: always; position: relative; width: ${slideWidth}px; height: ${slideHeight}px; background: #ffffff; margin: 40px auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden;">
  ${html}
</div>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="${toHtmlLang(useSettingsStore.getState().interfaceSettings.language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${presentation.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f1f5f9; padding: 40px 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .slide { overflow: hidden; }
    @media print {
      body { background: white; padding: 0; }
      .slide { margin: 0; box-shadow: none; page-break-after: always; }
    }
  </style>
</head>
<body>
  <h1 style="text-align: center; margin-bottom: 40px; color: #1e293b;">${presentation.title}</h1>
  ${slidesHTML}
</body>
</html>`;

    zip.file('index.html', html);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${presentation.title}.zip`);
  };

  const exportPDF = async () => {
    if (!presentation) return;

    const slideWidth = presentation.width || 1280;
    const slideHeight = presentation.height || 720;
    const orientation = slideWidth >= slideHeight ? 'landscape' : 'portrait';

    const pdf = new jsPDF({
      orientation,
      unit: 'px',
      format: [slideWidth, slideHeight],
    });

    for (let i = 0; i < presentation.slides.length; i++) {
      const slide = presentation.slides[i];
      const slideEl = document.createElement('div');
      slideEl.style.width = `${slideWidth}px`;
      slideEl.style.height = `${slideHeight}px`;
      slideEl.style.position = 'relative';
      slideEl.style.background = '#fff';
      slideEl.style.overflow = 'hidden';
      slideEl.innerHTML = slide.html;

      document.body.appendChild(slideEl);

      const canvas = await html2canvas(slideEl, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      document.body.removeChild(slideEl);

      const imgData = canvas.toDataURL('image/png');
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, 0, slideWidth, slideHeight);
    }

    pdf.save(`${presentation.title}.pdf`);
  };

  const exportPNG = async () => {
    if (!presentation) return;

    const slideWidth = presentation.width || 1280;
    const slideHeight = presentation.height || 720;

    for (let i = 0; i < presentation.slides.length; i++) {
      const slide = presentation.slides[i];
      const slideEl = document.createElement('div');
      slideEl.style.width = `${slideWidth}px`;
      slideEl.style.height = `${slideHeight}px`;
      slideEl.style.position = 'relative';
      slideEl.style.background = '#fff';
      slideEl.style.overflow = 'hidden';
      slideEl.innerHTML = slide.html;

      document.body.appendChild(slideEl);
      const canvas = await html2canvas(slideEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      document.body.removeChild(slideEl);

      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, `${presentation.title}_第${i + 1}页.png`);
        }
      }, 'image/png');

      await new Promise((r) => setTimeout(r, 200));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Download className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">{t('导出演示文稿')}</h3>
              <p className="text-xs text-slate-500">{t('选择导出格式')}</p>
            </div>
          </div>
          <button
            onClick={() => setExportModal(false)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {exportFormats.map((format) => (
            <button
              key={format.id}
              onClick={() => handleExport(format.id)}
              disabled={exporting !== null}
              className="w-full p-4 flex items-center gap-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all text-left disabled:opacity-50"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${format.color}`}>
                {exporting === format.id ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <format.icon className="w-6 h-6" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium text-slate-900">{format.name}</p>
                <p className="text-sm text-slate-500">{format.desc}</p>
              </div>
              <Download className="w-5 h-5 text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
