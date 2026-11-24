// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Runtime WCAG 2.2 theme contrast solver for Visual Studio Code webviews.
 *
 * Reads `--vscode-*` custom properties with `getComputedStyle` and clamps sRGB
 * lightness to `4.5:1` for text and `3:1` for controls and strokes.
 * Writes `--ghidra-*` custom properties to `:root` in `document.styleSheets[0]`.
 */

/** Base `:root` rule at the start of each webview stylesheet. */
export const contrastStyles = ':root{}';

/** Client script that calculates and updates `--ghidra-*` contrast tokens. */
export const contrastScript = String.raw`(()=>{
  const clampNum=(v,lo,hi)=>v<lo?lo:v>hi?hi:v;
  let canvasCtx,canvasChecked=false,canvasOk=false;
  const hslToRgb=(h,s,l)=>{
    const c=(1-Math.abs(2*l-1))*s,hp=((h%360)+360)%360/60,x=c*(1-Math.abs(hp%2-1)),m=l-c/2;
    let r=0,g=0,b=0;
    if(hp<1){r=c;g=x}else if(hp<2){r=x;g=c}else if(hp<3){g=c;b=x}else if(hp<4){g=x;b=c}else if(hp<5){r=x;b=c}else{r=c;b=x}
    return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
  };
  const rgbToHsl=([r8,g8,b8])=>{
    const r=r8/255,g=g8/255,b=b8/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
    if(!d){return [0,0,l]}
    const s=d/(1-Math.abs(2*l-1));
    let h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
    h=h*60;if(h<0){h+=360}
    return [h,clampNum(s,0,1),clampNum(l,0,1)];
  };
  const parseAlpha=raw=>{
    if(raw===undefined||raw===''){return 1}
    const t=raw.trim();
    const n=t.endsWith('%')?parseFloat(t)/100:parseFloat(t);
    return Number.isFinite(n)?clampNum(n,0,1):1;
  };
  const parseColor=raw=>{
    const s=String(raw||'').trim().toLowerCase();
    if(!s||s==='none'||s==='initial'||s==='inherit'||s==='unset'){return null}
    if(s==='transparent'){return [0,0,0,0]}
    const hex=/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if(hex){
      const h=hex[1];
      if(h.length<=4){
        return [parseInt(h[0]+h[0],16),parseInt(h[1]+h[1],16),parseInt(h[2]+h[2],16),h.length===4?parseInt(h[3]+h[3],16)/255:1];
      }
      return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),h.length===8?parseInt(h.slice(6,8),16)/255:1];
    }
    const rgb=/^rgba?\(\s*([^)]+)\)$/.exec(s);
    if(rgb){
      const body=rgb[1].trim();
      let parts,alpha;
      if(body.includes(',')){
        parts=body.split(/\s*,\s*/);alpha=parts[3];
      }else{
        const slash=body.split('/');parts=slash[0].trim().split(/\s+/);alpha=slash[1];
      }
      if(parts.length>=3){
        const ch=t=>{const v=t.endsWith('%')?parseFloat(t)*2.55:parseFloat(t);return Number.isFinite(v)?clampNum(v,0,255):NaN};
        const r=ch(parts[0]),g=ch(parts[1]),b=ch(parts[2]);
        if([r,g,b].every(Number.isFinite)){return [r,g,b,parseAlpha(alpha)]}
      }
    }
    const srgb=/^color\(\s*srgb\s+([^)]+)\)$/.exec(s);
    if(srgb){
      const slash=srgb[1].trim().split('/'),parts=slash[0].trim().split(/\s+/);
      if(parts.length>=3){
        const ch=t=>{const v=t.endsWith('%')?parseFloat(t)*2.55:parseFloat(t)*255;return Number.isFinite(v)?clampNum(v,0,255):NaN};
        const r=ch(parts[0]),g=ch(parts[1]),b=ch(parts[2]);
        if([r,g,b].every(Number.isFinite)){return [r,g,b,parseAlpha(slash[1])]}
      }
    }
    const hsl=/^hsla?\(\s*([^)]+)\)$/.exec(s);
    if(hsl){
      const body=hsl[1].trim();
      let parts,alpha;
      if(body.includes(',')){parts=body.split(/\s*,\s*/);alpha=parts[3]}
      else{const slash=body.split('/');parts=slash[0].trim().split(/\s+/);alpha=slash[1]}
      if(parts.length>=3){
        const h=parseFloat(parts[0]),sat=parseFloat(parts[1])/100,lit=parseFloat(parts[2])/100;
        if([h,sat,lit].every(Number.isFinite)){
          const [r,g,b]=hslToRgb(h,clampNum(sat,0,1),clampNum(lit,0,1));
          return [r,g,b,parseAlpha(alpha)];
        }
      }
    }
    if(!canvasChecked){
      canvasChecked=true;
      try{
        const el=document.createElement('canvas');el.width=1;el.height=1;
        canvasCtx=el.getContext('2d',{willReadFrequently:true});
        if(canvasCtx){
          canvasCtx.clearRect(0,0,1,1);canvasCtx.fillStyle='#123456';canvasCtx.fillRect(0,0,1,1);
          const d=canvasCtx.getImageData(0,0,1,1).data;
          canvasOk=d[0]===0x12&&d[1]===0x34&&d[2]===0x56&&d[3]===255;
        }
      }catch{canvasOk=false}
    }
    if(canvasOk&&canvasCtx){
      try{
        canvasCtx.clearRect(0,0,1,1);canvasCtx.fillStyle='#000000';canvasCtx.fillStyle=s;canvasCtx.fillRect(0,0,1,1);
        const d=canvasCtx.getImageData(0,0,1,1).data;
        return [d[0],d[1],d[2],d[3]/255];
      }catch{return null}
    }
    return null;
  };
  const over=(fg,bg)=>{
    const a=fg.length>3?clampNum(fg[3],0,1):1;
    return [Math.round(fg[0]*a+bg[0]*(1-a)),Math.round(fg[1]*a+bg[1]*(1-a)),Math.round(fg[2]*a+bg[2]*(1-a))];
  };
  const mix=(c1,pct1,c2,baseBg)=>{
    const p1=clampNum(pct1/100,0,1),p2=1-p1,a1=c1.length>3?c1[3]:1,a2=c2.length>3?c2[3]:1,a=a1*p1+a2*p2;
    return [
      Math.round(c1[0]*a1*p1+c2[0]*a2*p2+baseBg[0]*(1-a)),
      Math.round(c1[1]*a1*p1+c2[1]*a2*p2+baseBg[1]*(1-a)),
      Math.round(c1[2]*a1*p1+c2[2]*a2*p2+baseBg[2]*(1-a)),
    ];
  };
  const toHex=([r,g,b])=>'#'+[r,g,b].map(v=>clampNum(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');
  const lin=v=>{const s=clampNum(Math.round(v),0,255)/255;return s<=0.04045?s/12.92:Math.pow((s+0.055)/1.055,2.4)};
  const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
  const solveRgb=(rawFg,surfaceBg,minRatio,forceDir)=>{
    const bg=[Math.round(surfaceBg[0]),Math.round(surfaceBg[1]),Math.round(surfaceBg[2])];
    const fg=over(rawFg,bg);
    if(forceDir===undefined&&ratio(fg,bg)>=minRatio){return fg}
    const [h,s,l]=rgbToHsl(fg),lFg=lum(fg),lBg=lum(bg);
    const whiteRatio=1.05/(lBg+0.05),blackRatio=(lBg+0.05)/0.05;
    const goLight=forceDir!==undefined?forceDir:whiteRatio>=minRatio&&blackRatio<minRatio?true:blackRatio>=minRatio&&whiteRatio<minRatio?false:lFg===lBg?whiteRatio>=blackRatio:lFg>lBg;
    if(forceDir!==undefined&&ratio(fg,bg)>=minRatio&&(goLight?lFg>=lBg:lFg<=lBg)){return fg}
    const target=Math.min(goLight?whiteRatio:blackRatio,minRatio+0.06);
    let lo=goLight?l:0,hi=goLight?1:l;
    for(let i=0;i<24;i++){
      const mid=(lo+hi)/2,cand=hslToRgb(h,s,mid);
      if(ratio(cand,bg)>=target){if(goLight){hi=mid}else{lo=mid}}
      else{if(goLight){lo=mid}else{hi=mid}}
    }
    let best=hslToRgb(h,s,goLight?hi:lo);
    const pole=goLight?[255,255,255]:[0,0,0];
    for(let step=1;step<=16&&ratio(best,bg)<minRatio;step++){
      const t=step/16;
      best=[Math.round(best[0]+(pole[0]-best[0])*t),Math.round(best[1]+(pole[1]-best[1])*t),Math.round(best[2]+(pole[2]-best[2])*t)];
    }
    return ratio(best,bg)>=minRatio?best:pole;
  };
  const clamp=(rawFg,surfaceBg,minRatio)=>toHex(solveRgb(rawFg,surfaceBg,minRatio));
  const clampDual=(rawFg,bg1,bg2,minRatio)=>{
    const c1=over(rawFg,bg1),c2=over(rawFg,bg2);
    if(ratio(c1,bg1)>=minRatio&&ratio(c2,bg2)>=minRatio){return toHex(c1)}
    const l1=lum(bg1),l2=lum(bg2),lo=Math.min(l1,l2),hi=Math.max(l1,l2);
    const canDark=(lo+0.05)/0.05>=minRatio,canLight=1.05/(hi+0.05)>=minRatio;
    if(canDark&&(!canLight||lo>0.18)){return toHex(solveRgb(rawFg,l1<l2?bg1:bg2,minRatio,false))}
    if(canLight){return toHex(solveRgb(rawFg,l1>l2?bg1:bg2,minRatio,true))}
    return clamp(rawFg,bg1,minRatio);
  };
  const findRootSheet=()=>{
    const sheet=document.styleSheets[0];
    if(!sheet){return null}
    try{
      for(let i=0;i<sheet.cssRules.length;i++){
        const r=sheet.cssRules[i];
        if(r&&r.type===1&&r.selectorText===':root'){return {sheet,rootRule:r}}
      }
      const idx=sheet.insertRule(':root{}',sheet.cssRules.length);
      return {sheet,rootRule:sheet.cssRules[idx]};
    }catch{return null}
  };
  const withInstantUpdate=(sheet,host,fn)=>{
    let freezeIdx=-1;
    try{freezeIdx=sheet.insertRule('*,*::before,*::after{transition:none!important}',sheet.cssRules.length)}catch{freezeIdx=-1}
    try{
      fn();
      void host.offsetHeight;
    }finally{
      if(freezeIdx>=0){try{sheet.deleteRule(freezeIdx)}catch{}}
    }
  };
  const applied=new Set();
  let solving=false;
  const forcedMedia=typeof window.matchMedia==='function'?window.matchMedia('(forced-colors: active)'):null;
  const solve=()=>{
    if(solving){return}
    solving=true;
    try{
      const found=findRootSheet();
      if(!found){return}
      const {sheet,rootRule}=found;
      const host=document.body||document.documentElement;
      if(forcedMedia&&forcedMedia.matches){
        if(applied.size){
          withInstantUpdate(sheet,host,()=>{
            for(const key of applied){rootRule.style.removeProperty(key)}
            applied.clear();
          });
        }
        return;
      }
      const cs=getComputedStyle(host);
      const isLight=!!(document.body&&(document.body.classList.contains('vscode-light')||document.body.classList.contains('vscode-high-contrast-light')));
      const read=(names,fallback)=>{
        for(const name of names){
          const parsed=parseColor(cs.getPropertyValue(name));
          if(parsed){return parsed}
        }
        return fallback;
      };
      const rawBg=read(['--vscode-editor-background'],isLight?[255,255,255,1]:[30,30,30,1]);
      const editorBg=over(rawBg,isLight?[255,255,255]:[30,30,30]);
      const fg=read(['--vscode-foreground','--vscode-editor-foreground'],isLight?[59,59,59,1]:[204,204,204,1]);
      const editorFg=read(['--vscode-editor-foreground'],fg);
      const muted=read(['--vscode-descriptionForeground'],isLight?[113,113,113,1]:[157,157,157,1]);
      const focus=read(['--vscode-focusBorder'],isLight?[0,144,241,1]:[0,127,212,1]);
      const panelBorder=read(['--vscode-panel-border'],isLight?[229,229,229,1]:[68,68,68,1]);
      const widgetBorder=read(['--vscode-editorWidget-border'],panelBorder);
      const sideBg=over(read(['--vscode-sideBar-background'],editorBg),editorBg);
      const inputBg=over(read(['--vscode-input-background'],editorBg),editorBg);
      const inputFg=read(['--vscode-input-foreground'],fg);
      const placeholderFg=read(['--vscode-input-placeholderForeground'],muted);
      const dropdownBg=over(read(['--vscode-dropdown-background'],inputBg),editorBg);
      const dropdownFg=read(['--vscode-dropdown-foreground'],inputFg);
      const hoverBg=over(read(['--vscode-list-hoverBackground'],editorBg),editorBg);
      const btnBg=over(read(['--vscode-button-background'],focus),editorBg);
      const btnFg=read(['--vscode-button-foreground'],[255,255,255,1]);
      const btnHoverBg=over(read(['--vscode-button-hoverBackground','--vscode-list-hoverBackground'],btnBg),editorBg);
      const btnSecBg=over(read(['--vscode-button-secondaryBackground'],inputBg),editorBg);
      const btnSecFg=read(['--vscode-button-secondaryForeground'],fg);
      const btnSecHoverBg=over(read(['--vscode-button-secondaryHoverBackground','--vscode-list-hoverBackground'],hoverBg),editorBg);
      const menuBg=over(read(['--vscode-menu-background'],editorBg),editorBg);
      const menuFg=read(['--vscode-menu-foreground'],fg);
      const menuSelBg=over(read(['--vscode-menu-selectionBackground','--vscode-list-hoverBackground'],hoverBg),menuBg);
      const menuSelFg=read(['--vscode-menu-selectionForeground'],menuFg);
      const inactiveSelBg=over(read(['--vscode-list-inactiveSelectionBackground'],hoverBg),editorBg);
      const inactiveSelFg=read(['--vscode-list-inactiveSelectionForeground'],fg);
      const activeSelBg=over(read(['--vscode-list-activeSelectionBackground'],focus),editorBg);
      const activeSelFg=read(['--vscode-list-activeSelectionForeground'],[255,255,255,1]);
      const rawToolbarActive=read(['--vscode-toolbar-activeBackground'],hoverBg);
      const toolbarPressedBg=over(rawToolbarActive,editorBg);
      const menuPressedBg=over(rawToolbarActive,menuBg);
      const linkFg=read(['--vscode-textLink-foreground'],focus);
      const linkActiveFg=read(['--vscode-textLink-activeForeground'],linkFg);
      const errorFg=read(['--vscode-errorForeground'],isLight?[161,38,13,1]:[244,135,113,1]);
      const errorBorder=over(read(['--vscode-inputValidation-errorBorder'],errorFg),editorBg);
      const warningFg=read(['--vscode-editorWarning-foreground'],[204,167,0,1]);
      const successFg=read(['--vscode-testing-iconPassed'],isLight?[56,138,52,1]:[115,201,145,1]);
      const tokMnemonic=read(['--vscode-symbolIcon-keywordForeground'],fg);
      const tokRegister=read(['--vscode-symbolIcon-variableForeground'],fg);
      const tokNumber=read(['--vscode-debugTokenExpression-number'],fg);
      const tokString=read(['--vscode-debugTokenExpression-string'],fg);
      const tokSymbol=read(['--vscode-symbolIcon-functionForeground'],fg);

      const tokens={};
      const put=(k,v)=>{tokens[k]=v};
      put('--ghidra-bg',toHex(editorBg));
      put('--ghidra-fg',clamp(fg,editorBg,4.5));
      put('--ghidra-editor-fg',clamp(editorFg,editorBg,4.5));
      put('--ghidra-muted',clamp(muted,editorBg,4.5));
      put('--ghidra-link',clamp(linkFg,editorBg,4.5));
      put('--ghidra-link-active',clamp(linkActiveFg,editorBg,4.5));
      put('--ghidra-error',clamp(errorFg,editorBg,4.5));
      put('--ghidra-success',clamp(successFg,editorBg,4.5));
      put('--ghidra-focus-border',clamp(focus,editorBg,3));
      put('--ghidra-tok-mnemonic',clamp(tokMnemonic,editorBg,4.5));
      put('--ghidra-tok-register',clamp(tokRegister,editorBg,4.5));
      put('--ghidra-tok-number',clamp(tokNumber,editorBg,4.5));
      put('--ghidra-tok-string',clamp(tokString,editorBg,4.5));
      put('--ghidra-tok-keyword',clamp(muted,editorBg,4.5));
      put('--ghidra-tok-symbol',clamp(tokSymbol,editorBg,4.5));
      put('--ghidra-tok-scope',clamp(muted,editorBg,4.5));
      put('--ghidra-tok-name',clamp(fg,editorBg,4.5));

      put('--ghidra-input-bg',toHex(inputBg));
      put('--ghidra-input-fg',clamp(inputFg,inputBg,4.5));
      put('--ghidra-input-placeholder',clamp(placeholderFg,inputBg,4.5));
      put('--ghidra-input-readonly',clamp(muted,inputBg,4.5));
      put('--ghidra-dropdown-bg',toHex(dropdownBg));
      put('--ghidra-dropdown-fg',clamp(dropdownFg,dropdownBg,4.5));

      put('--ghidra-btn-bg',toHex(btnBg));
      put('--ghidra-btn-fg',clamp(btnFg,btnBg,4.5));
      put('--ghidra-btn-hover-bg',toHex(btnHoverBg));
      put('--ghidra-btn-hover-fg',clamp(btnFg,btnHoverBg,4.5));
      put('--ghidra-btn-sec-bg',toHex(btnSecBg));
      put('--ghidra-btn-sec-fg',clamp(btnSecFg,btnSecBg,4.5));
      put('--ghidra-btn-sec-hover-bg',toHex(btnSecHoverBg));
      put('--ghidra-btn-sec-hover-fg',clamp(btnSecFg,btnSecHoverBg,4.5));
      put('--ghidra-btn-danger-fg',clamp(errorFg,btnSecBg,4.5));
      put('--ghidra-btn-danger-submit-bg',toHex(errorBorder));
      put('--ghidra-btn-danger-submit-fg',clamp(btnFg,errorBorder,4.5));

      put('--ghidra-menu-bg',toHex(menuBg));
      put('--ghidra-menu-fg',clamp(menuFg,menuBg,4.5));
      put('--ghidra-menu-muted',clamp(muted,menuBg,4.5));
      put('--ghidra-menu-danger',clamp(errorFg,menuBg,4.5));
      put('--ghidra-menu-sel-bg',toHex(menuSelBg));
      put('--ghidra-menu-sel-fg',clamp(menuSelFg,menuSelBg,4.5));

      put('--ghidra-sidebar-bg',toHex(sideBg));
      put('--ghidra-sidebar-fg',clamp(fg,sideBg,4.5));
      put('--ghidra-sidebar-muted',clamp(muted,sideBg,4.5));
      put('--ghidra-sidebar-link',clamp(linkFg,sideBg,4.5));

      put('--ghidra-status-bg',toHex(sideBg));
      put('--ghidra-status-fg',clamp(muted,sideBg,4.5));
      put('--ghidra-status-dirty-fg',clamp(warningFg,sideBg,4.5));
      put('--ghidra-status-dirty-border',clamp(warningFg,sideBg,3));
      put('--ghidra-status-saving-fg',clamp(focus,sideBg,4.5));
      put('--ghidra-status-saving-border',clamp(focus,sideBg,3));

      const kindBg=mix(focus,16,editorBg,editorBg);
      put('--ghidra-kind-badge-bg',toHex(kindBg));
      put('--ghidra-kind-badge-fg',clamp(fg,kindBg,4.5));
      put('--ghidra-kind-badge-border',clamp(focus,editorBg,3));
      const roKindBg=mix(muted,12,editorBg,editorBg);
      put('--ghidra-kind-readonly-bg',toHex(roKindBg));
      put('--ghidra-kind-readonly-fg',clamp(muted,roKindBg,4.5));

      const errBg=mix(errorFg,6,editorBg,editorBg);
      put('--ghidra-error-bg',toHex(errBg));
      put('--ghidra-error-on-tint',clamp(errorFg,errBg,4.5));

      const newFieldBg=mix(editorBg,70,sideBg,editorBg);
      put('--ghidra-type-new-bg',toHex(newFieldBg));
      put('--ghidra-type-new-fg',clamp(inputFg,newFieldBg,4.5));
      put('--ghidra-type-new-placeholder',clamp(muted,newFieldBg,4.5));

      const inspCardBg=mix(sideBg,75,editorBg,editorBg);
      put('--ghidra-inspector-card-bg',toHex(inspCardBg));
      put('--ghidra-inspector-card-fg',clamp(fg,inspCardBg,4.5));
      put('--ghidra-inspector-card-muted',clamp(muted,inspCardBg,4.5));
      put('--ghidra-inspector-card-link',clamp(linkFg,inspCardBg,4.5));

      const pillActiveBg=mix(focus,16,editorBg,editorBg);
      put('--ghidra-pill-bg',toHex(sideBg));
      put('--ghidra-pill-fg',clamp(linkFg,sideBg,4.5));
      put('--ghidra-pill-border',clampDual(panelBorder,editorBg,sideBg,3));
      put('--ghidra-pill-active-bg',toHex(pillActiveBg));
      put('--ghidra-pill-active-fg',clamp(linkFg,pillActiveBg,4.5));
      put('--ghidra-pill-active-border',clampDual(focus,editorBg,pillActiveBg,3));

      const switchActiveRgb=solveRgb(btnBg,sideBg,3);
      put('--ghidra-switch-bg',toHex(sideBg));
      put('--ghidra-switch-border',clampDual(panelBorder,editorBg,sideBg,3));
      put('--ghidra-switch-fg',clamp(muted,sideBg,4.5));
      put('--ghidra-switch-active-bg',toHex(switchActiveRgb));
      put('--ghidra-switch-active-fg',clamp(btnFg,switchActiveRgb,4.5));
      put('--ghidra-switch-active-border',clampDual(focus,sideBg,switchActiveRgb,3));
      put('--ghidra-direction-active-bg',toHex(inactiveSelBg));
      put('--ghidra-direction-active-fg',clamp(fg,inactiveSelBg,4.5));
      put('--ghidra-direction-active-border',clampDual(focus,sideBg,inactiveSelBg,3));

      const pvPressedBg=mix(focus,14,editorBg,editorBg);
      put('--ghidra-pv-pressed-bg',toHex(pvPressedBg));
      put('--ghidra-pv-pressed-fg',clamp(focus,pvPressedBg,4.5));
      put('--ghidra-pressed-border',clampDual(focus,editorBg,pvPressedBg,3));
      put('--ghidra-toolbar-pressed-bg',toHex(toolbarPressedBg));
      put('--ghidra-toolbar-pressed-fg',clamp(focus,toolbarPressedBg,4.5));
      put('--ghidra-toolbar-pressed-border',clampDual(focus,editorBg,toolbarPressedBg,3));
      put('--ghidra-menu-pressed-bg',toHex(menuPressedBg));
      put('--ghidra-menu-pressed-fg',clamp(focus,menuPressedBg,4.5));
      put('--ghidra-menu-pressed-border',clampDual(focus,menuBg,menuPressedBg,3));

      const listingSelBg=mix(focus,14,inactiveSelBg,editorBg);
      const listingFocusBg=mix(focus,22,activeSelBg,editorBg);
      const hexSelBg=mix(focus,12,inactiveSelBg,editorBg);
      const hexCellSelBg=mix(focus,28,activeSelBg,editorBg);
      const cfgHeaderBg=mix(fg,7,editorBg,editorBg);
      const cfgHeaderSelBg=mix(focus,10,editorBg,editorBg);

      const surfaces=[
        ['hover',hoverBg,fg],
        ['inactive-sel',inactiveSelBg,inactiveSelFg],
        ['active-sel',activeSelBg,activeSelFg],
        ['listing-sel',listingSelBg,fg],
        ['listing-focus',listingFocusBg,activeSelFg],
        ['hex-sel',hexSelBg,fg],
        ['hex-cell-sel',hexCellSelBg,activeSelFg],
        ['cfg-header',cfgHeaderBg,fg],
        ['cfg-header-sel',cfgHeaderSelBg,fg],
      ];
      for(const [name,surf,baseFg] of surfaces){
        put('--ghidra-'+name+'-bg',toHex(surf));
        put('--ghidra-'+name+'-fg',clamp(baseFg,surf,4.5));
        put('--ghidra-'+name+'-muted',clamp(muted,surf,4.5));
        put('--ghidra-'+name+'-link',clamp(linkFg,surf,4.5));
        put('--ghidra-'+name+'-tok-mnemonic',clamp(tokMnemonic,surf,4.5));
        put('--ghidra-'+name+'-tok-register',clamp(tokRegister,surf,4.5));
        put('--ghidra-'+name+'-tok-number',clamp(tokNumber,surf,4.5));
        put('--ghidra-'+name+'-tok-string',clamp(tokString,surf,4.5));
        put('--ghidra-'+name+'-tok-keyword',clamp(muted,surf,4.5));
        put('--ghidra-'+name+'-tok-symbol',clamp(tokSymbol,surf,4.5));
        put('--ghidra-'+name+'-tok-scope',clamp(muted,surf,4.5));
        put('--ghidra-'+name+'-tok-name',clamp(baseFg,surf,4.5));
      }

      put('--ghidra-node-border',clamp(widgetBorder,editorBg,3));
      put('--ghidra-branch-stroke',clamp(mix(fg,32,editorBg,editorBg),editorBg,3));
      put('--ghidra-branch-expanded-stroke',clamp(mix(focus,55,editorBg,editorBg),editorBg,3));
      put('--ghidra-branch-hover-stroke',clamp(mix(fg,32,hoverBg,hoverBg),hoverBg,3));
      put('--ghidra-branch-hover-expanded-stroke',clamp(mix(focus,55,hoverBg,hoverBg),hoverBg,3));
      put('--ghidra-branch-sel-stroke',clamp(mix(inactiveSelFg,36,inactiveSelBg,inactiveSelBg),inactiveSelBg,3));
      put('--ghidra-branch-sel-expanded-stroke',clamp(mix(focus,55,inactiveSelBg,inactiveSelBg),inactiveSelBg,3));
      put('--ghidra-branch-sel-active',clamp(inactiveSelFg,inactiveSelBg,4.5));
      put('--ghidra-branch-root-stroke',clamp(mix(activeSelFg,36,activeSelBg,activeSelBg),activeSelBg,3));
      put('--ghidra-branch-root-expanded-stroke',clamp(mix(activeSelFg,38,activeSelBg,activeSelBg),activeSelBg,3));
      put('--ghidra-branch-root-active',clamp(activeSelFg,activeSelBg,4.5));

      withInstantUpdate(sheet,host,()=>{
        for(const [k,v] of Object.entries(tokens)){
          rootRule.style.setProperty(k,v);
          applied.add(k);
        }
      });
    }finally{solving=false}
  };
  solve();
  const observer=new MutationObserver(solve);
  if(document.documentElement){observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-vscode-theme-kind','data-vscode-theme-name']})}
  if(document.body){observer.observe(document.body,{attributes:true,attributeFilter:['class','style','data-vscode-theme-kind','data-vscode-theme-name']})}
  if(document.head){observer.observe(document.head,{childList:true,subtree:true,characterData:true})}
  if(forcedMedia&&typeof forcedMedia.addEventListener==='function'){forcedMedia.addEventListener('change',solve)}
})();`;
