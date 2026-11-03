/* PEA Studio — art-directed advertising compositor. Preview and export share this renderer. */
(function () {
  'use strict';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const ease = n => { const x = clamp(n, 0, 1); return 1 - Math.pow(1 - x, 3); };
  const DIMENSIONS = { '9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '16:9':[1920,1080] };
  const LOOKS = {
    luxe:{bg:'#171512',accent:'#D7B77F',overlay:.36,filter:'cinematic',font:'serif',paper:'#E9E0D1',ink:'#211D18'},
    editorial:{bg:'#E9E0D2',accent:'#A98455',overlay:.10,filter:'warm',font:'serif',paper:'#E9E0D2',ink:'#26221C'},
    bold:{bg:'#141821',accent:'#F3BD43',overlay:.48,filter:'vivid',font:'bold',paper:'#F3BD43',ink:'#151821'},
    clean:{bg:'#F3F1EC',accent:'#8D795B',overlay:.08,filter:'none',font:'sans',paper:'#F3F1EC',ink:'#24221E'},
    warm:{bg:'#3D261D',accent:'#E8AE78',overlay:.26,filter:'warm',font:'serif',paper:'#F1DFCA',ink:'#42281B'},
    corporate:{bg:'#14283B',accent:'#9BC4DD',overlay:.32,filter:'cinematic',font:'sans',paper:'#E9F0F4',ink:'#102638'}
  };
  const FILTERS = {
    none:'none', cinematic:'contrast(1.10) saturate(.88) brightness(.92)', warm:'sepia(.16) saturate(1.15) contrast(1.04)',
    mono:'grayscale(1) contrast(1.12)', vivid:'saturate(1.38) contrast(1.08)', cool:'hue-rotate(178deg) saturate(.76) contrast(1.08)',
    soft:'brightness(1.08) saturate(.83) contrast(.94)', noir:'grayscale(1) contrast(1.34) brightness(.78)', vintage:'sepia(.3) saturate(.88) contrast(1.06)'
  };
  function dimensions(format, preview) {
    const base = DIMENSIONS[format] || DIMENSIONS['9:16'];
    if (!preview) return base;
    const scale = 960 / Math.max(base[0], base[1]);
    return [Math.round(base[0]*scale), Math.round(base[1]*scale)];
  }
  function roundRect(ctx,x,y,w,h,r) {
    const rr=Math.max(0,Math.min(r,w/2,h/2)); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
  }
  function wrap(ctx,text,maxW) {
    const words=String(text||'').trim().split(/\s+/).filter(Boolean), lines=[]; let line='';
    for (const word of words) { const t=line?line+' '+word:word; if(line&&ctx.measureText(t).width>maxW){lines.push(line);line=word;}else line=t; }
    if(line) lines.push(line); return lines;
  }
  function hexRgb(hex) {
    const h=String(hex||'#D7B77F').replace('#',''); const full=h.length===3?h.split('').map(x=>x+x).join(''):h;
    const n=parseInt(full,16); return Number.isFinite(n)?[(n>>16)&255,(n>>8)&255,n&255]:[215,183,127];
  }
  function rgba(hex,a){const [r,g,b]=hexRgb(hex);return `rgba(${r},${g},${b},${clamp(a,0,1)})`;}
  function gradient(ctx,w,h,a,b,vertical=true) { const g=vertical?ctx.createLinearGradient(0,0,0,h):ctx.createLinearGradient(0,0,w,0);g.addColorStop(0,a);g.addColorStop(1,b);return g; }
  function drawGlow(ctx,x,y,r,color,alpha) { const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,rgba(color,alpha));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2); }
  function imageSource(media) { if(!media||!media.ready||!media.element)return null;const el=media.element;const w=el.videoWidth||el.naturalWidth||el.width||0,h=el.videoHeight||el.naturalHeight||el.height||0;return w&&h?{el,w,h}:null; }
  function drawImageBox(ctx,media,x,y,w,h,fit,zoom,positionX,positionY,radius,filter) {
    const src=imageSource(media); if(!src)return false;
    ctx.save(); if(radius){roundRect(ctx,x,y,w,h,radius);ctx.clip();}
    if(filter)ctx.filter=FILTERS[filter]||'none';
    const scale=(fit==='contain'?Math.min(w/src.w,h/src.h):Math.max(w/src.w,h/src.h))*(zoom||1);
    const dw=src.w*scale,dh=src.h*scale;
    const px=clamp(Number(positionX??.5),0,1),py=clamp(Number(positionY??.5),0,1);
    const dx=x+(w-dw)*px,dy=y+(h-dh)*py;
    ctx.drawImage(src.el,dx,dy,dw,dh);ctx.restore();return true;
  }
  function drawPlaceholder(ctx,w,h,scene,look,time) {
    const a=scene.backgroundColor||look.bg,b=scene.secondaryColor||'#28252B',accent=scene.accentColor||look.accent;
    ctx.fillStyle=gradient(ctx,w,h,a,b,true);ctx.fillRect(0,0,w,h);
    drawGlow(ctx,w*.78,h*.23,Math.max(w,h)*.43,accent,.24);
    drawGlow(ctx,w*.12,h*.78,Math.max(w,h)*.34,accent,.12);
    ctx.save();ctx.globalAlpha=.20;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(1,w*.0012);
    const step=Math.max(44,w*.085);for(let x=-h;x<w+h;x+=step){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-h,h);ctx.stroke();}ctx.restore();
    ctx.save();ctx.globalAlpha=.16;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(1,w*.0015);ctx.beginPath();ctx.arc(w*.5,h*.43,Math.min(w,h)*(.2+.012*Math.sin(time*1.5)),0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  function drawVignette(ctx,w,h,amount) { const g=ctx.createRadialGradient(w*.5,h*.48,Math.min(w,h)*.18,w*.5,h*.48,Math.max(w,h)*.76);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,`rgba(0,0,0,${amount})`);ctx.fillStyle=g;ctx.fillRect(0,0,w,h); }
  function motion(ctx,scene,t,w,h) {
    if(scene.motion==='static')return;
    const duration=Math.min(.95,Math.max(.24,(Number(scene.duration)||5)*.2)),p=ease(t/duration);
    ctx.globalAlpha*=p;
    if(scene.motion==='rise'){ctx.translate(0,(1-p)*h*.035);}
    else if(scene.motion==='slide'){ctx.translate((1-p)*-w*.08,0);}
    else if(scene.motion==='zoom'){ctx.translate(w/2,h/2);const s=.94+.06*p;ctx.scale(s,s);ctx.translate(-w/2,-h/2);}
  }
  function fontFace(scene) { return scene.font==='serif'?'Georgia, "Times New Roman", serif':scene.font==='bold'?'Arial Black, Impact, sans-serif':'Arial, Helvetica, sans-serif'; }
  function drawCopy(ctx,scene,box,scale,time,options={}) {
    const accent=scene.accentColor||'#D7B77F',ink=scene.textColor||'#FFFFFF',title=String(scene.headline||'Make your mark.').trim(),body=String(scene.body||'').trim(),cta=String(scene.cta||'').trim();
    const align=options.align||'left',face=fontFace(scene),titleSize=(options.titleSize||88)*scale,bodySize=(options.bodySize||28)*scale,pad=options.padding??0;
    const x=box.x+pad,y=box.y+pad,maxW=Math.max(120,box.w-pad*2);ctx.save();motion(ctx,scene,time,box.w,box.h);ctx.textAlign=align;ctx.textBaseline='top';ctx.fillStyle=options.titleColor||ink;ctx.shadowColor=options.shadow===false?'transparent':'rgba(0,0,0,.28)';ctx.shadowBlur=options.shadow===false?0:18*scale;ctx.shadowOffsetY=3*scale;
    const kicker=String(scene.eyebrow||scene.brand||'').trim();let top=y;
    if(kicker){ctx.font=`700 ${Math.max(13,18*scale)}px Arial, sans-serif`;ctx.letterSpacing=`${1.6*scale}px`;ctx.fillStyle=accent;ctx.fillText(kicker.toUpperCase(),x,top,maxW);top+=31*scale;ctx.letterSpacing='0px';}
    ctx.font=`${scene.font==='bold'?'900':'700'} ${titleSize}px ${face}`;
    const titleLines=wrap(ctx,title,maxW).slice(0,4),lh=titleSize*1.02;
    if(scene.motion==='type'){const ratio=clamp(time/Math.max(.25,(Number(scene.duration)||5)*.18),0,1);const partial=title.slice(0,Math.max(1,Math.floor(title.length*ratio)));titleLines.splice(0,titleLines.length,...wrap(ctx,partial,maxW).slice(0,4));}
    titleLines.forEach((line,i)=>ctx.fillText(line,x,top+i*lh,maxW));top+=titleLines.length*lh+Math.max(12,16*scale);
    if(body){ctx.shadowBlur=8*scale;ctx.font=`400 ${bodySize}px Arial, Helvetica, sans-serif`;ctx.fillStyle=options.bodyColor||ink;const lines=wrap(ctx,body,maxW*.95).slice(0,3);lines.forEach((line,i)=>ctx.fillText(line,x,top+i*bodySize*1.42,maxW*.95));top+=lines.length*bodySize*1.42+18*scale;}
    const offer=String(scene.offer||'').trim();
    if(offer){const labelW=Math.min(maxW,Math.max(150*scale,ctx.measureText(offer).width+44*scale)),labelH=46*scale;ctx.shadowBlur=0;roundRect(ctx,x,top,labelW,labelH,8*scale);ctx.fillStyle=accent;ctx.fill();ctx.fillStyle=options.offerInk||'#181613';ctx.font=`800 ${Math.max(16,22*scale)}px Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(offer,x+labelW/2,top+labelH/2,labelW-20*scale);top+=labelH+17*scale;}
    if(cta){const labelW=Math.min(maxW,Math.max(185*scale,ctx.measureText(cta).width+62*scale)),labelH=55*scale;ctx.shadowBlur=18*scale;ctx.shadowColor='rgba(0,0,0,.18)';roundRect(ctx,x,top,labelW,labelH,Math.min(13*scale,labelH/2));ctx.fillStyle=scene.ctaStyle==='outline'?'rgba(0,0,0,0)':accent;ctx.fill();if(scene.ctaStyle==='outline'){ctx.strokeStyle=accent;ctx.lineWidth=2*scale;ctx.stroke();}ctx.shadowBlur=0;ctx.fillStyle=scene.ctaStyle==='outline'?ink:(options.ctaInk||'#171512');ctx.font=`800 ${Math.max(15,20*scale)}px Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(cta,x+labelW/2,top+labelH/2,labelW-20*scale);}
    ctx.restore();
  }
  function drawTopMark(ctx,scene,w,h,scale,accent) {
    const brand=String(scene.brand||scene.eyebrow||'').trim();if(!brand)return;
    ctx.save();ctx.font=`700 ${Math.max(14,17*scale)}px Arial, sans-serif`;ctx.fillStyle=scene.textColor||'#fff';ctx.textBaseline='top';ctx.textAlign='left';ctx.letterSpacing=`${2.1*scale}px`;ctx.fillText(brand.toUpperCase(),w*.075,h*.055,w*.68);ctx.strokeStyle=accent;ctx.lineWidth=Math.max(1,1.4*scale);ctx.beginPath();ctx.moveTo(w*.075,h*.09);ctx.lineTo(w*.22,h*.09);ctx.stroke();ctx.restore();
  }
  function drawGraphic(ctx,scene,w,h,scale,time) {
    const a=scene.accentColor||'#D7B77F';ctx.save();ctx.strokeStyle=a;ctx.fillStyle=a;ctx.lineWidth=Math.max(1,2*scale);const pulse=1+.025*Math.sin(time*2.4);
    if(scene.layout==='poster'||scene.layout==='offer'){
      ctx.globalAlpha=.14;ctx.beginPath();ctx.arc(w*.88,h*.15,Math.min(w,h)*.21*pulse,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.65;
      for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(w*(.07+i*.025),h*.14);ctx.lineTo(w*(.07+i*.025),h*.21);ctx.stroke();}
    } else if(scene.layout==='editorial'){
      ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(w*.075,h*.17);ctx.lineTo(w*.075,h*.29);ctx.stroke();
      ctx.globalAlpha=.48;ctx.beginPath();ctx.arc(w*.86,h*.22,Math.min(w,h)*.075*pulse,0,Math.PI*2);ctx.stroke();
    } else if(scene.layout==='spotlight'){
      ctx.globalAlpha=.28;for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(w*.5,h*.48,(Math.min(w,h)*(.19+i*.025))*pulse,0,Math.PI*2);ctx.stroke();}
    }
    ctx.restore();
  }
  function drawLogo(ctx,media,scene,w,h) {
    const src=imageSource(media);if(!src)return;const maxW=w*.2,maxH=h*.075,s=Math.min(maxW/src.w,maxH/src.h),dw=src.w*s,dh=src.h*s,margin=w*.065,pos=scene.logoPosition||'top-left';
    const x=pos.endsWith('right')?w-margin-dw:margin,y=pos.startsWith('bottom')?h-margin-dh:margin;ctx.save();ctx.globalAlpha=.96;ctx.shadowColor='rgba(0,0,0,.25)';ctx.shadowBlur=14;ctx.drawImage(src.el,x,y,dw,dh);ctx.restore();
  }
  function drawEditorial(ctx,scene,media,w,h,scale,time,look) {
    const has=drawImageBox(ctx,media,0,0,w,h,scene.fit||'cover',1.035+.025*clamp(time/(scene.duration||5),0,1),scene.cropX,scene.cropY,0,scene.filter||look.filter);
    if(!has)drawPlaceholder(ctx,w,h,scene,look,time);
    const overlay=clamp((Number(scene.overlay??34))/100,0,.88);const shade=ctx.createLinearGradient(0,h*.30,0,h);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(.48,`rgba(0,0,0,${overlay})`);shade.addColorStop(1,`rgba(0,0,0,${Math.min(.93,overlay+.42)})`);ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);drawVignette(ctx,w,h,.20);
    drawTopMark(ctx,scene,w,h,scale,scene.accentColor||look.accent);drawGraphic(ctx,scene,w,h,scale,time);
    const box={x:w*.075,y:h*(scene.position==='upper'?.20:scene.position==='center'?.40:.60),w:w*.83,h:h*.35};drawCopy(ctx,scene,box,scale,time,{titleSize:scene.font==='serif'?91:84,bodySize:28,shadow:true});return has;
  }
  function drawSpotlight(ctx,scene,media,w,h,scale,time,look) {
    const accent=scene.accentColor||look.accent;drawPlaceholder(ctx,w,h,scene,look,time);drawGlow(ctx,w*.5,h*.43,Math.min(w,h)*.55,accent,.18);
    const vertical=h>=w;
    const imageBox=vertical?{x:w*.10,y:h*.20,w:w*.80,h:h*.47}:{x:w*.45,y:h*.13,w:w*.48,h:h*.72};
    ctx.save();ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=38*scale;ctx.shadowOffsetY=18*scale;roundRect(ctx,imageBox.x,imageBox.y,imageBox.w,imageBox.h,18*scale);ctx.fillStyle=scene.cardColor||'#F4F0E8';ctx.fill();ctx.restore();
    const has=drawImageBox(ctx,media,imageBox.x+9*scale,imageBox.y+9*scale,imageBox.w-18*scale,imageBox.h-18*scale,'contain',1,scene.cropX,scene.cropY,12*scale,scene.filter||'none');
    if(!has){ctx.save();ctx.fillStyle=rgba(accent,.08);roundRect(ctx,imageBox.x+9*scale,imageBox.y+9*scale,imageBox.w-18*scale,imageBox.h-18*scale,12*scale);ctx.fill();ctx.restore();}
    ctx.save();ctx.fillStyle=rgba(accent,.28);ctx.beginPath();ctx.ellipse(imageBox.x+imageBox.w/2,imageBox.y+imageBox.h+23*scale,imageBox.w*.35,12*scale,0,0,Math.PI*2);ctx.fill();ctx.restore();
    const copy=vertical?{x:w*.10,y:h*.72,w:w*.80,h:h*.23}:{x:w*.075,y:h*.20,w:w*.32,h:h*.65};drawCopy(ctx,scene,copy,scale,time,{titleSize:vertical?75:76,bodySize:26,shadow:false,titleColor:scene.textColor||'#FFFFFF',bodyColor:scene.textColor||'#F3F1EC'});drawGraphic(ctx,scene,w,h,scale,time);return has;
  }
  function drawSplit(ctx,scene,media,w,h,scale,time,look) {
    const vertical=h>=w;const accent=scene.accentColor||look.accent;const split=vertical?h*.59:w*.54;
    ctx.fillStyle=scene.backgroundColor||look.paper||'#ECE6DC';ctx.fillRect(0,0,w,h);
    const imageBox=vertical?{x:0,y:0,w,h:split}:{x:0,y:0,w:split,h};
    const has=drawImageBox(ctx,media,imageBox.x,imageBox.y,imageBox.w,imageBox.h,'cover',1.02,scene.cropX,scene.cropY,0,scene.filter||look.filter);
    if(!has){drawPlaceholder(ctx,imageBox.w,imageBox.h,scene,look,time);}
    ctx.fillStyle=accent;if(vertical)ctx.fillRect(0,split-5*scale,w,5*scale);else ctx.fillRect(split-5*scale,0,5*scale,h);
    const box=vertical?{x:w*.085,y:split+h*.045,w:w*.83,h:h-split-h*.07}:{x:split+w*.055,y:h*.14,w:w-split-w*.10,h:h*.72};
    drawCopy(ctx,scene,box,scale,time,{titleSize:vertical?82:72,bodySize:26,shadow:false,titleColor:scene.secondaryTextColor||look.ink,bodyColor:scene.secondaryTextColor||look.ink,offerInk:'#171512'});
    ctx.save();ctx.fillStyle=scene.secondaryTextColor||look.ink;ctx.globalAlpha=.6;ctx.font=`700 ${Math.max(12,14*scale)}px Arial`;ctx.letterSpacing=`${2*scale}px`;ctx.fillText(String(scene.brand||'').toUpperCase(),box.x,box.y+box.h-18*scale,box.w);ctx.restore();return has;
  }
  function drawOffer(ctx,scene,media,w,h,scale,time,look) {
    const has=drawImageBox(ctx,media,0,0,w,h,'cover',1.04,scene.cropX,scene.cropY,0,scene.filter||'vivid');if(!has)drawPlaceholder(ctx,w,h,scene,look,time);
    ctx.fillStyle=gradient(ctx,w,h,'rgba(13,16,22,.20)','rgba(13,16,22,.93)',true);ctx.fillRect(0,0,w,h);const accent=scene.accentColor||'#F3BD43';
    ctx.save();ctx.translate(w*.78,h*.23);ctx.rotate(.10);ctx.fillStyle=accent;ctx.beginPath();const r=Math.min(w,h)*.125;ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#171821';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`900 ${Math.max(18,30*scale)}px Arial Black,Arial`;const offer=String(scene.offer||'SPECIAL').split(' ');ctx.fillText(offer.slice(0,2).join(' '),0,-3*scale,r*1.45);ctx.font=`700 ${Math.max(10,13*scale)}px Arial`;ctx.fillText('LIMITED OFFER',0,r*.35,r*1.5);ctx.restore();
    const box={x:w*.075,y:h*.51,w:w*.82,h:h*.37};drawCopy(ctx,scene,box,scale,time,{titleSize:scene.font==='bold'?100:85,bodySize:27,shadow:true});drawGraphic(ctx,scene,w,h,scale,time);return has;
  }
  function drawPoster(ctx,scene,media,w,h,scale,time,look) {
    const accent=scene.accentColor||look.accent;drawPlaceholder(ctx,w,h,scene,look,time);
    const vertical=h>=w;const imageBox=vertical?{x:w*.12,y:h*.12,w:w*.76,h:h*.48}:{x:w*.48,y:h*.10,w:w*.42,h:h*.80};
    ctx.save();ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=30*scale;roundRect(ctx,imageBox.x,imageBox.y,imageBox.w,imageBox.h,8*scale);ctx.fillStyle='#F5F1E8';ctx.fill();ctx.restore();
    const has=drawImageBox(ctx,media,imageBox.x+8*scale,imageBox.y+8*scale,imageBox.w-16*scale,imageBox.h-16*scale,'cover',1.025,scene.cropX,scene.cropY,4*scale,scene.filter||'none');
    const box=vertical?{x:w*.11,y:h*.65,w:w*.78,h:h*.29}:{x:w*.075,y:h*.24,w:w*.34,h:h*.55};drawCopy(ctx,scene,box,scale,time,{titleSize:vertical?100:79,bodySize:24,shadow:false});
    ctx.save();ctx.strokeStyle=accent;ctx.lineWidth=3*scale;ctx.beginPath();ctx.moveTo(w*.08,h*.085);ctx.lineTo(w*.30,h*.085);ctx.stroke();ctx.globalAlpha=.45;ctx.strokeRect(w*.055,h*.055,w*.89,h*.89);ctx.restore();return has;
  }
  function drawShowcase(ctx,scene,media,w,h,scale,time,look) {
    const has=drawImageBox(ctx,media,0,0,w,h,'cover',1.025,scene.cropX,scene.cropY,0,scene.filter||look.filter);if(!has)drawPlaceholder(ctx,w,h,scene,look,time);
    const accent=scene.accentColor||look.accent;const vertical=h>=w;const panelY=vertical?h*.66:h*.58;ctx.fillStyle=gradient(ctx,w,h,'rgba(8,12,16,0)','rgba(8,12,16,.94)',true);ctx.fillRect(0,panelY,w,h-panelY);
    ctx.save();ctx.strokeStyle=accent;ctx.lineWidth=2*scale;ctx.strokeRect(w*.045,h*.035,w*.91,h*.93);ctx.restore();drawTopMark(ctx,scene,w,h,scale,accent);
    drawCopy(ctx,scene,{x:w*.075,y:panelY+h*.045,w:w*.82,h:h-panelY-h*.07},scale,time,{titleSize:vertical?86:76,bodySize:26,shadow:true});return has;
  }
  function drawMinimal(ctx,scene,media,w,h,scale,time,look) {
    const base=scene.backgroundColor||'#F0EEE9',accent=scene.accentColor||look.accent;ctx.fillStyle=base;ctx.fillRect(0,0,w,h);drawGlow(ctx,w*.5,h*.34,Math.min(w,h)*.44,accent,.12);
    const vertical=h>=w;const imageBox=vertical?{x:w*.12,y:h*.19,w:w*.76,h:h*.47}:{x:w*.39,y:h*.12,w:w*.54,h:h*.76};
    ctx.save();ctx.shadowColor='rgba(30,24,18,.16)';ctx.shadowBlur=42*scale;ctx.shadowOffsetY=18*scale;roundRect(ctx,imageBox.x,imageBox.y,imageBox.w,imageBox.h,13*scale);ctx.fillStyle='#fff';ctx.fill();ctx.restore();
    const has=drawImageBox(ctx,media,imageBox.x+7*scale,imageBox.y+7*scale,imageBox.w-14*scale,imageBox.h-14*scale,'contain',1,scene.cropX,scene.cropY,9*scale,'none');
    const box=vertical?{x:w*.10,y:h*.70,w:w*.80,h:h*.25}:{x:w*.075,y:h*.20,w:w*.27,h:h*.60};drawCopy(ctx,scene,box,scale,time,{titleSize:vertical?75:70,bodySize:25,shadow:false,bodyColor:scene.secondaryTextColor||'#29251F'});return has;
  }
  function drawAtmosphere(ctx,scene,w,h,scale,time) {
    const effect=scene.effect||'none';
    if(effect==='none')return;
    const accent=scene.accentColor||'#D7B77F';
    ctx.save();
    if(effect==='light-leak'){
      ctx.globalCompositeOperation='screen';
      const phase=(time*.16)%1,x=w*(.12+.76*phase),y=h*(.18+.10*Math.sin(time*.7));
      const glow=ctx.createRadialGradient(x,y,0,x,y,Math.max(w,h)*.43);
      glow.addColorStop(0,rgba(accent,.22));glow.addColorStop(.22,rgba(accent,.105));glow.addColorStop(1,rgba(accent,0));
      ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
      const beam=ctx.createLinearGradient(x-w*.16,0,x+w*.25,h);
      beam.addColorStop(0,'rgba(255,224,173,0)');beam.addColorStop(.48,'rgba(255,224,173,.055)');beam.addColorStop(.62,'rgba(255,244,219,.11)');beam.addColorStop(1,'rgba(255,224,173,0)');
      ctx.fillStyle=beam;ctx.fillRect(0,0,w,h);
    } else if(effect==='particles'){
      ctx.globalCompositeOperation='screen';
      for(let i=0;i<22;i++){
        const speed=.018+(i%5)*.004,phase=(time*speed+(i*.137))%1;
        const x=w*(.08+((i*37)%83)/100)+Math.sin(time*.42+i*1.7)*w*.018;
        const y=h*(1-phase),r=(2+(i%4)*1.45)*scale,alpha=.12+(.08*Math.sin(time*1.3+i));
        const g=ctx.createRadialGradient(x,y,0,x,y,r*4);g.addColorStop(0,rgba(accent,Math.max(.04,alpha)));g.addColorStop(1,rgba(accent,0));
        ctx.fillStyle=g;ctx.fillRect(x-r*4,y-r*4,r*8,r*8);
      }
    } else if(effect==='grain'){
      ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=.12;
      for(let i=0;i<280;i++){
        const x=((i*97+Math.sin(i*12.3)*23)%w+w)%w,y=((i*193+Math.cos(i*7.7)*31)%h+h)%h;
        const size=(i%3===0?2:1)*scale;ctx.fillStyle=i%2?'#fff':'#111';ctx.fillRect(x,y,size,size);
      }
      ctx.globalAlpha=.08;ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    } else if(effect==='prism'){
      ctx.globalCompositeOperation='screen';
      const x=w*(.72+.055*Math.sin(time*.5)),y=h*(.22+.035*Math.cos(time*.65)),r=Math.min(w,h)*.16;
      const flare=ctx.createRadialGradient(x,y,0,x,y,r*2.3);flare.addColorStop(0,'rgba(255,255,255,.24)');flare.addColorStop(.08,rgba(accent,.15));flare.addColorStop(.42,rgba('#8BC5E8',.045));flare.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=flare;ctx.fillRect(x-r*2.3,y-r*2.3,r*4.6,r*4.6);
      ctx.translate(x,y);ctx.rotate(-.20+Math.sin(time*.3)*.025);
      for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(0,0,r*(1+i*.24),r*(.18+i*.045),0,0,Math.PI*2);ctx.strokeStyle=i===0?'rgba(255,255,255,.18)':rgba(accent,.12);ctx.lineWidth=Math.max(1,1.5*scale);ctx.stroke();}
      ctx.restore();return;
    }
    ctx.restore();
  }

  function drawScene(ctx,scene,media,localTime,width,height,options) {
    const opts=options||{},look=LOOKS[scene.look]||LOOKS.luxe,scale=width/1080,layout=scene.layout||'editorial';
    const duration=Math.max(.1,Number(scene.duration)||5),rawTime=clamp(localTime,0,duration),transition=scene.transition||'fade';
    // A still preview should show the finished composition, not the invisible first instant of a text reveal.
    const revealTime=Math.min(.95,Math.max(.24,duration*.2));
    const t=opts.preview&&rawTime<=.001?revealTime:rawTime;
    const entry=transition==='cut'?1:transition==='zoom'||transition==='slide'?ease(t/.52):ease(t/.42);
    const sceneAlpha=opts.preview&&rawTime<=.001?1:(transition==='fade'?entry:1);
    ctx.save();ctx.globalAlpha=sceneAlpha;
    if(transition==='zoom'){
      const factor=1.08-.08*entry;ctx.translate(width/2,height/2);ctx.scale(factor,factor);ctx.translate(-width/2,-height/2);
    } else if(transition==='slide'){
      const factor=1.08-.08*entry;ctx.translate(-width*.04*(1-entry),0);ctx.translate(width/2,height/2);ctx.scale(factor,factor);ctx.translate(-width/2,-height/2);
    }
    let has=false;
    if(layout==='spotlight')has=drawSpotlight(ctx,scene,media,width,height,scale,t,look);
    else if(layout==='split')has=drawSplit(ctx,scene,media,width,height,scale,t,look);
    else if(layout==='offer')has=drawOffer(ctx,scene,media,width,height,scale,t,look);
    else if(layout==='poster')has=drawPoster(ctx,scene,media,width,height,scale,t,look);
    else if(layout==='showcase')has=drawShowcase(ctx,scene,media,width,height,scale,t,look);
    else if(layout==='minimal')has=drawMinimal(ctx,scene,media,width,height,scale,t,look);
    else has=drawEditorial(ctx,scene,media,width,height,scale,t,look);
    drawAtmosphere(ctx,scene,width,height,scale,t);
    drawLogo(ctx,opts.logoMedia,scene,width,height);
    if(scene.signature!==false){ctx.save();ctx.globalAlpha=.76;ctx.fillStyle=scene.signatureColor||'#fff';ctx.textAlign='right';ctx.textBaseline='bottom';ctx.font=`italic ${Math.max(19,width*.021)}px Georgia,serif`;ctx.shadowColor='rgba(0,0,0,.42)';ctx.shadowBlur=9;ctx.fillText('Pea',width-width*.065,height-height*.035);ctx.restore();}
    ctx.restore();return has;
  }
  function locateScene(project,time){let start=0;const scenes=project?.scenes||[];for(let i=0;i<scenes.length;i++){const duration=Math.max(1,Number(scenes[i].duration)||5);if(time<start+duration||i===scenes.length-1)return{scene:scenes[i],index:i,start,local:clamp(time-start,0,duration),duration};start+=duration;}return null;}
  function totalDuration(project){return(project?.scenes||[]).reduce((sum,scene)=>sum+Math.max(1,Number(scene.duration)||5),0);}
  window.PeaEngine={dimensions,drawScene,locateScene,totalDuration,LOOKS};
})();
