/* PEA Studio canvas compositor: deterministic scene drawing for preview and export. */
(function () {
  'use strict';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const easeOut = n => 1 - Math.pow(1 - clamp(n, 0, 1), 3);

  const DIMENSIONS = {
    '9:16': [1080, 1920],
    '4:5': [1080, 1350],
    '1:1': [1080, 1080],
    '16:9': [1920, 1080]
  };
  const LOOKS = {
    luxe: { bg: '#171512', accent: '#d8b982', overlay: 0.38, filter: 'cinematic', font: 'serif' },
    editorial: { bg: '#e8e0d3', accent: '#c5a36f', overlay: 0.28, filter: 'warm', font: 'serif' },
    bold: { bg: '#191b23', accent: '#f2b84b', overlay: 0.52, filter: 'vivid', font: 'bold' },
    clean: { bg: '#f0eee9', accent: '#9f8b6b', overlay: 0.18, filter: 'none', font: 'sans' },
    warm: { bg: '#3a241b', accent: '#e8ae78', overlay: 0.36, filter: 'warm', font: 'serif' },
    corporate: { bg: '#142637', accent: '#8fb7ce', overlay: 0.46, filter: 'cinematic', font: 'sans' }
  };
  const FILTERS = {
    none: 'none',
    cinematic: 'contrast(1.12) saturate(.82) brightness(.88)',
    warm: 'sepia(.23) saturate(1.18) contrast(1.04)',
    mono: 'grayscale(1) contrast(1.12)',
    vivid: 'saturate(1.42) contrast(1.08)',
    cool: 'hue-rotate(178deg) saturate(.72) contrast(1.1)',
    soft: 'brightness(1.08) saturate(.78) contrast(.92)',
    noir: 'grayscale(1) contrast(1.35) brightness(.78)',
    vintage: 'sepia(.34) saturate(.82) contrast(1.08)'
  };

  function dimensions(format, preview) {
    const base = DIMENSIONS[format] || DIMENSIONS['9:16'];
    if (!preview) return base;
    const maxLong = 960;
    const scale = maxLong / Math.max(base[0], base[1]);
    return [Math.round(base[0] * scale), Math.round(base[1] * scale)];
  }

  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawCover(ctx, media, width, height, fit, zoom) {
    if (!media || !media.ready) return false;
    const sourceW = media.element.videoWidth || media.element.naturalWidth || media.element.width || width;
    const sourceH = media.element.videoHeight || media.element.naturalHeight || media.element.height || height;
    if (!sourceW || !sourceH) return false;
    const scale = fit === 'contain' ? Math.min(width / sourceW, height / sourceH) : Math.max(width / sourceW, height / sourceH);
    const finalScale = scale * (zoom || 1);
    const drawW = sourceW * finalScale;
    const drawH = sourceH * finalScale;
    ctx.drawImage(media.element, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
    return true;
  }

  function textMotion(ctx, motion, progress, width, height) {
    const p = easeOut(progress);
    if (motion === 'fade') ctx.globalAlpha *= p;
    if (motion === 'rise') { ctx.globalAlpha *= p; ctx.translate(0, (1 - p) * 55); }
    if (motion === 'slide') { ctx.globalAlpha *= p; ctx.translate((1 - p) * -width * .18, 0); }
    if (motion === 'zoom') { ctx.globalAlpha *= p; const s = .86 + .14 * p; ctx.translate(width / 2, height / 2); ctx.scale(s, s); ctx.translate(-width / 2, -height / 2); }
  }

  function drawText(ctx, scene, width, height, localTime, ratio) {
    const look = LOOKS[scene.look] || LOOKS.luxe;
    const scale = width / 1080;
    const title = String(scene.headline || 'Make your mark.').trim();
    const body = String(scene.body || '').trim();
    const cta = String(scene.cta || '').trim();
    const motionDuration = Math.min(.85, Math.max(.28, scene.duration * .19));
    const motionProgress = clamp(localTime / motionDuration, 0, 1);
    const padding = width * .09;
    const maxWidth = width - padding * 2;
    const align = scene.position === 'left' ? 'left' : 'center';
    let titleY;
    if (scene.position === 'upper') titleY = height * .25;
    else if (scene.position === 'center') titleY = height * .49;
    else if (scene.position === 'left') titleY = height * .59;
    else titleY = height * .64;
    const titleSize = (scene.font === 'bold' ? 104 : 92) * scale * (ratio === '16:9' ? .9 : 1);
    const bodySize = 31 * scale;
    const face = scene.font === 'serif' ? 'Georgia, "Times New Roman", serif' : scene.font === 'bold' ? 'Arial Black, Impact, sans-serif' : 'Arial, Helvetica, sans-serif';

    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = scene.textColor || '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,.34)';
    ctx.shadowBlur = 20 * scale;
    ctx.shadowOffsetY = 5 * scale;
    ctx.translate(0, 0);
    textMotion(ctx, scene.motion || 'rise', motionProgress, width, height);

    ctx.font = `700 ${titleSize}px ${face}`;
    let titleLines = wrapText(ctx, title, maxWidth);
    if (titleLines.length > 4) titleLines = titleLines.slice(0, 4);
    if (scene.motion === 'type') {
      const chars = Math.max(1, Math.floor(title.length * clamp(localTime / motionDuration, 0, 1)));
      const visible = title.slice(0, chars);
      titleLines = wrapText(ctx, visible, maxWidth);
    }
    const lineHeight = titleSize * 1.03;
    const titleHeight = titleLines.length * lineHeight;
    const bodyLines = body ? wrapText(ctx, body, maxWidth * .88).slice(0, 3) : [];
    const bodyHeight = bodyLines.length * bodySize * 1.5;
    const ctaHeight = cta ? 68 * scale : 0;
    let y = titleY - (titleHeight + bodyHeight + ctaHeight) / 2;
    if (scene.position === 'upper') y = Math.max(height * .12, titleY - titleHeight * .35);
    if (scene.position === 'lower') y = Math.min(height * .68, titleY - titleHeight * .38);
    if (scene.position === 'left') y = titleY - titleHeight * .45;

    titleLines.forEach((line, index) => {
      const x = align === 'left' ? padding : width / 2;
      ctx.fillText(line, x, y + index * lineHeight, maxWidth);
    });
    y += titleHeight + (body ? 25 * scale : 0);
    if (body) {
      ctx.shadowBlur = 9 * scale;
      ctx.font = `400 ${bodySize}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = scene.textColor || '#ffffff';
      bodyLines.forEach((line, index) => {
        ctx.fillText(line, align === 'left' ? padding : width / 2, y + index * bodySize * 1.5, maxWidth * .9);
      });
    }
    y += bodyHeight + (cta ? 32 * scale : 0);
    if (cta) {
      const ctaFont = 23 * scale;
      ctx.font = `700 ${ctaFont}px Arial, sans-serif`;
      const buttonW = Math.min(maxWidth, Math.max(210 * scale, ctx.measureText(cta).width + 68 * scale));
      const buttonH = 61 * scale;
      const buttonX = align === 'left' ? padding : (width - buttonW) / 2;
      const buttonY = y;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = 18 * scale; ctx.shadowOffsetY = 5 * scale;
      roundedRect(ctx, buttonX, buttonY, buttonW, buttonH, 10 * scale);
      ctx.fillStyle = look.accent;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#181713';
      ctx.textAlign = 'center';
      ctx.fillText(cta, buttonX + buttonW / 2, buttonY + buttonH / 2 + 1 * scale, buttonW - 28 * scale);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawLogo(ctx, media, scene, width, height) {
    if (!media || !media.ready || !media.element) return;
    const image = media.element;
    const sourceW = image.naturalWidth || image.width || 0;
    const sourceH = image.naturalHeight || image.height || 0;
    if (!sourceW || !sourceH) return;
    const maxW = width * .22;
    const maxH = height * .085;
    const scale = Math.min(maxW / sourceW, maxH / sourceH);
    const drawW = sourceW * scale;
    const drawH = sourceH * scale;
    const margin = width * .075;
    const position = scene.logoPosition || 'top-left';
    const x = position.endsWith('right') ? width - margin - drawW : margin;
    const y = position.startsWith('bottom') ? height - margin - drawH : margin;
    ctx.save();
    ctx.globalAlpha = .96;
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 18 * (width / 1080);
    ctx.drawImage(image, x, y, drawW, drawH);
    ctx.restore();
  }

  function drawScene(ctx, scene, media, localTime, width, height, options) {
    const opts = options || {};
    const look = LOOKS[scene.look] || LOOKS.luxe;
    const progress = clamp(localTime / Math.max(.1, Number(scene.duration) || 5), 0, 1);
    const entrance = scene.transition || 'fade';
    const entranceTime = .55;
    const p = easeOut(localTime / entranceTime);
    const alpha = entrance === 'fade' ? p : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = look.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    let zoom = 1.035 + progress * .035;
    if (entrance === 'zoom') zoom = 1.13 - .095 * p + progress * .02;
    if (entrance === 'slide') ctx.translate((1 - p) * width * .08, 0);
    ctx.filter = FILTERS[scene.filter || look.filter] || 'none';
    const drawn = drawCover(ctx, media, width, height, scene.fit || 'cover', zoom);
    ctx.filter = 'none';
    ctx.restore();

    const overlay = clamp((Number(scene.overlay) || 0) / 100, 0, .88);
    const shade = ctx.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, `rgba(0,0,0,${overlay * .7})`);
    shade.addColorStop(.35, `rgba(0,0,0,${overlay * .36})`);
    shade.addColorStop(1, `rgba(0,0,0,${Math.min(.94, overlay + .22)})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    if (['cinematic', 'noir', 'vintage'].includes(scene.filter || look.filter)) {
      const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .19, width / 2, height / 2, Math.max(width, height) * .72);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, `rgba(0,0,0,${scene.filter === 'noir' ? .52 : .31})`);
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    }

    // A subtle graphic accent gives text-only scenes and product frames a designed finish.
    ctx.save();
    ctx.globalAlpha *= .42;
    ctx.strokeStyle = look.accent;
    ctx.lineWidth = Math.max(1, width * .001);
    const margin = width * .065;
    ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
    ctx.restore();

    drawLogo(ctx, opts.logoMedia, scene, width, height);
    drawText(ctx, scene, width, height, localTime, opts.format || '9:16');
    if (scene.signature !== false) {
      ctx.save();
      ctx.globalAlpha = .76;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.font = `italic ${Math.max(19, width * .022)}px Georgia, serif`;
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8;
      ctx.fillText('Pea', width - width * .085, height - height * .048);
      ctx.restore();
    }
    ctx.restore();
    return drawn;
  }

  function locateScene(project, time) {
    let start = 0;
    const scenes = project && project.scenes ? project.scenes : [];
    for (let i = 0; i < scenes.length; i += 1) {
      const duration = Math.max(1, Number(scenes[i].duration) || 5);
      if (time < start + duration || i === scenes.length - 1) {
        return { scene: scenes[i], index: i, start, local: clamp(time - start, 0, duration), duration };
      }
      start += duration;
    }
    return null;
  }

  function totalDuration(project) {
    return (project?.scenes || []).reduce((sum, scene) => sum + Math.max(1, Number(scene.duration) || 5), 0);
  }

  window.PeaEngine = { dimensions, drawScene, locateScene, totalDuration, LOOKS };
})();
