(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    csrf: document.querySelector('meta[name="csrf-token"]')?.content || '',
    onlineSession: false,
    offlineMode: false,
    project: null,
    projects: [],
    assets: [],
    resources: new Map(),
    urls: new Map(),
    currentSceneId: null,
    playhead: 0,
    playing: false,
    raf: 0,
    lastFrame: 0,
    saveTimer: 0,
    audioPreview: null,
    audioContext: null,
    exportCancelled: false,
    exportBusy: false,
    exportCanvas: null,
    exportFrame: 0
  };

  function id() {
    return (crypto.randomUUID ? crypto.randomUUID() : `pea-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function notify(message, type) {
    const target = $('exportMessage');
    if (target) {
      target.textContent = message;
      target.style.color = type === 'error' ? '#e58d88' : '#9fc9a7';
    }
  }

  async function apiSession() {
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return false;
      const data = await response.json();
      if (!data.authenticated) return false;
      state.csrf = data.csrf || state.csrf;
      state.onlineSession = true;
      return true;
    } catch (_) { return false; }
  }

  async function verifyOfflineCredentials(name, password) {
    if (!crypto?.subtle || !window.TextEncoder) throw new Error('This browser cannot verify offline access. Reconnect and sign in using a current browser.');
    let record;
    try { record = JSON.parse(localStorage.getItem('pea-offline-auth-v1') || 'null'); } catch (_) { record = null; }
    if (!record || !record.name || !record.salt || !record.hash) throw new Error('No offline sign-in is saved on this device. Connect and sign in once first.');
    const encoder = new TextEncoder();
    const hexToBytes = hex => new Uint8Array((hex.match(/.{1,2}/g) || []).map(part => parseInt(part, 16)));
    const key = await crypto.subtle.importKey('raw', encoder.encode(`${name.trim()}\u0000${password}`), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(record.salt), iterations: record.iterations || 210000, hash: 'SHA-256' }, key, 256);
    const calculated = Array.from(new Uint8Array(bits)).map(v => v.toString(16).padStart(2, '0')).join('');
    if (name.trim() !== record.name || calculated !== record.hash) throw new Error('Those credentials do not match the offline access saved on this device.');
    return true;
  }

  function showOfflineGate() {
    $('offlineGate').hidden = false;
    $('pea-studio').hidden = true;
    $('offlineName').focus();
  }

  async function init() {
    try {
      if (await apiSession()) {
        $('offlineGate').hidden = true;
        $('pea-studio').hidden = false;
        setConnection(true);
        await startStudio();
      } else {
        setConnection(false);
        showOfflineGate();
      }
    } catch (error) {
      console.error(error);
      showOfflineGate();
    }
  }

  $('offlineForm').addEventListener('submit', async event => {
    event.preventDefault();
    const errorBox = $('offlineError');
    errorBox.textContent = '';
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await verifyOfflineCredentials($('offlineName').value, $('offlinePassword').value);
      state.offlineMode = true;
      $('offlineGate').hidden = true;
      $('pea-studio').hidden = false;
      setConnection(false);
      await startStudio();
    } catch (error) {
      errorBox.textContent = error.message || 'Could not unlock offline studio.';
    } finally { button.disabled = false; }
  });

  function setConnection(online) {
    const target = $('connectionStatus');
    target.classList.toggle('offline', !online);
    target.querySelector('span').textContent = online ? 'Connected' : 'Offline ready';
    $('exportHint').textContent = online ? 'MP4 conversion is available. Keep this tab open while it renders.' : 'Offline editing is available. The finished video will download as WebM until the studio reconnects for MP4 conversion.';
  }

  function defaultScene(index) {
    return {
      id: id(), mediaId: null, duration: 5, headline: index === 0 ? 'A good idea deserves a great first frame.' : 'Make your mark.',
      body: index === 0 ? 'Build a story worth stopping for.' : 'Give people a reason to remember you.',
      cta: index === 0 ? 'Discover more' : 'Get in touch', look: 'luxe', motion: 'rise', transition: 'fade',
      position: 'lower', filter: 'cinematic', fit: 'cover', font: 'serif', overlay: 38,
      layout: 'editorial', effect: 'none', eyebrow: '', offer: '', brand: '', accentColor: '#D7B77F', backgroundColor: '#171512', secondaryColor: '#28252B',
      cropX: .5, cropY: .5, textColor: '#ffffff', signature: true
    };
  }

  function newProject(title) {
    return { id: id(), title: title || 'Untitled campaign', format: '9:16', brandName: '', campaignType: 'product', artDirection: 'luxe', scenes: [defaultScene(0)], audioId: '', volume: 70, createdAt: Date.now(), updatedAt: Date.now() };
  }

  async function startStudio() {
    try {
      await PeaStore.persist();
      state.assets = await PeaStore.all('assets');
      state.projects = await PeaStore.all('projects');
      if (!state.projects.length) {
        state.project = newProject('First campaign');
        await persistProject();
        state.projects = [state.project];
      } else {
        state.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        state.project = state.projects[0];
        if (!state.project.scenes?.length) state.project.scenes = [defaultScene(0)];
      }
      state.currentSceneId = state.project.scenes[0].id;
      for (const asset of state.assets) createResource(asset);
      setupControls();
      renderAssetList();
      renderProject();
      renderSceneList();
      renderInspector();
      setupAudio();
      await updateStorageEstimate();
      renderPreview();
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', () => { state.offlineMode = true; setConnection(false); });
    } catch (error) {
      console.error(error);
      alert(error.message || 'PEA Studio could not open local storage. Use a current Chrome or Edge browser and allow site storage.');
    }
  }

  function setupControls() {
    $('uploadButton').onclick = () => $('mediaInput').click();
    $('mediaInput').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
    $('assetFilter').addEventListener('change', renderAssetList);
    $('dropZone').addEventListener('dragover', event => { event.preventDefault(); $('dropZone').classList.add('dragover'); });
    $('dropZone').addEventListener('dragleave', event => { if (!event.relatedTarget || !$('dropZone').contains(event.relatedTarget)) $('dropZone').classList.remove('dragover'); });
    $('dropZone').addEventListener('drop', event => { event.preventDefault(); $('dropZone').classList.remove('dragover'); addFiles(event.dataTransfer.files); });
    const stage = $('previewStage');
    stage.addEventListener('dragover', event => { event.preventDefault(); stage.classList.add('drop-target'); });
    stage.addEventListener('dragleave', event => { if (!event.relatedTarget || !stage.contains(event.relatedTarget)) stage.classList.remove('drop-target'); });
    stage.addEventListener('drop', event => {
      event.preventDefault(); stage.classList.remove('drop-target');
      const assetId = event.dataTransfer.getData('application/x-pea-asset');
      if (assetId) assignMedia(assetId);
      else if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files, state.currentSceneId);
    });
    $('projectTitle').addEventListener('input', () => { state.project.title = $('projectTitle').value.slice(0, 70); scheduleSave(); renderProjectOptions(); });
    $('newProjectBtn').onclick = createProject;
    $('projectSelect').addEventListener('change', () => switchProject($('projectSelect').value));
    $('formatSelect').addEventListener('change', () => { state.project.format = $('formatSelect').value; configureCanvas(); scheduleSave(); renderPreview(); });
    $('focusCanvasButton').onclick = () => { const active=$('pea-studio').querySelector('.workspace').classList.toggle('focus-canvas'); $('focusCanvasButton').setAttribute('aria-pressed',String(active)); $('focusCanvasButton').textContent=active?'⤡ Exit focus':'⤢ Focus canvas'; };
    $('addSceneButton').onclick = addScene;
    $('applyTemplateButton').onclick = applyStoryTemplate;
    $('quickAddMediaButton').onclick = () => $('mediaInput').click();
    $('briefAddMediaButton').onclick = () => $('mediaInput').click();
    $('quickBriefButton').onclick = openBrief;
    $('quickExportButton').onclick = openExportModal;
    $('buildAdButton').onclick = openAiModal;
    $('openBriefButton').onclick = openBrief;
    $('quickCreateInlineButton').onclick = openBrief;
    $('closeBrief').onclick = closeBrief;
    $('briefModal').addEventListener('click', event => { if (event.target === $('briefModal')) closeBrief(); });
    $('generateAdButton').onclick = generateAdvertisement;
    $('styleChoices').querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
      $('styleChoices').querySelectorAll('[data-style]').forEach(item => item.classList.toggle('selected', item === button));
    }));
    $('deleteSceneButton').onclick = deleteScene;
    $('moveSceneUp').onclick = () => moveScene(-1);
    $('moveSceneDown').onclick = () => moveScene(1);
    $('playButton').onclick = togglePlay;
    $('stopButton').onclick = stopPlayback;
    $('timelineScrubber').addEventListener('input', event => { state.playhead = Number(event.target.value); stopPlayback(false); renderPreview(); updateTimeUI(); });
    $('durationInput').addEventListener('input', () => { currentScene().duration = Number($('durationInput').value); $('durationValue').textContent = `${currentScene().duration} sec`; updateTimelineRange(); renderSceneList(); scheduleSave(); renderPreview(); });
    bindText('eyebrowInput', 'eyebrow'); bindText('headlineInput', 'headline'); bindText('bodyInput', 'body'); bindText('offerInput', 'offer'); bindText('ctaInput', 'cta');
    bindSelect('layoutSelect', 'layout'); bindSelect('effectSelect', 'effect');
    bindSelect('lookSelect', 'look', value => {
      const look = PeaEngine.LOOKS[value]; if (look) {
        currentScene().overlay = Math.round(look.overlay * 100); currentScene().filter = look.filter; currentScene().font = look.font;
        currentScene().accentColor = look.accent; currentScene().backgroundColor = look.bg;
        $('overlayInput').value = currentScene().overlay; $('overlayValue').textContent = `${currentScene().overlay}%`;
        $('fontSelect').value = currentScene().font; $('filterSelect').value = currentScene().filter; $('accentColorInput').value = currentScene().accentColor;
      }
    });
    bindSelect('motionSelect', 'motion'); bindSelect('transitionSelect', 'transition'); bindSelect('positionSelect', 'position'); bindSelect('filterSelect', 'filter'); bindSelect('fontSelect', 'font'); bindSelect('fitSelect', 'fit');
    $('overlayInput').addEventListener('input', () => { currentScene().overlay = Number($('overlayInput').value); $('overlayValue').textContent = `${currentScene().overlay}%`; scheduleSave(); renderPreview(); });
    $('textColorInput').addEventListener('input', () => { currentScene().textColor = $('textColorInput').value; scheduleSave(); renderPreview(); });
    $('accentColorInput').addEventListener('input', () => { currentScene().accentColor = $('accentColorInput').value; scheduleSave(); renderPreview(); });
    $('signatureToggle').addEventListener('change', () => { currentScene().signature = $('signatureToggle').checked; scheduleSave(); renderPreview(); });
    $('logoSelect').addEventListener('change', () => { currentScene().logoId = $('logoSelect').value || ''; scheduleSave(); renderPreview(); });
    $('logoPositionSelect').addEventListener('change', () => { currentScene().logoPosition = $('logoPositionSelect').value; scheduleSave(); renderPreview(); });
    $('audioSelect').addEventListener('change', () => { state.project.audioId = $('audioSelect').value; setupAudio(); scheduleSave(); });
    $('volumeInput').addEventListener('input', () => { state.project.volume = Number($('volumeInput').value); $('volumeValue').textContent = `${state.project.volume}%`; if (state.audioPreview) state.audioPreview.volume = state.project.volume / 100; scheduleSave(); });
    $('backupBtn').onclick = backupProject;
    $('backupInput').addEventListener('change', event => { importProject(event.target.files[0]); event.target.value = ''; });
    $('exportBtn').onclick = openExportModal;
    $('exportBtn').querySelector('span:first-child').textContent = 'Export advert';
    $('closeExport').onclick = closeExportModal;
    $('cancelExport').onclick = closeExportModal;
    $('startExport').onclick = exportProject;
    $('logoutBtn').onclick = logout;
    window.addEventListener('beforeunload', () => { if (state.playing) stopPlayback(); });
    setupAiStudio();
  }

  function bindText(elementId, key) {
    $(elementId).addEventListener('input', () => { currentScene()[key] = $(elementId).value; scheduleSave(); renderSceneList(); renderPreview(); });
  }
  function bindSelect(elementId, key, after) {
    $(elementId).addEventListener('change', () => { currentScene()[key] = $(elementId).value; if (after) after($(elementId).value); scheduleSave(); renderPreview(); });
  }
  function currentScene() { return state.project.scenes.find(scene => scene.id === state.currentSceneId) || state.project.scenes[0]; }

  function createResource(asset) {
    if (!asset || state.resources.has(asset.id)) return state.resources.get(asset.id);
    const url = URL.createObjectURL(asset.blob);
    state.urls.set(asset.id, url);
    let resource;
    if (asset.kind === 'image') {
      const image = new Image();
      resource = { element: image, ready: false, kind: 'image' };
      image.onload = () => { resource.ready = true; renderPreview(); };
      image.onerror = () => { resource.failed = true; renderPreview(); };
      image.src = url;
    } else if (asset.kind === 'video') {
      const video = document.createElement('video');
      video.src = url; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
      resource = { element: video, ready: false, kind: 'video' };
      video.addEventListener('loadeddata', () => { resource.ready = true; renderPreview(); }, { once: true });
      video.addEventListener('error', () => { resource.failed = true; renderPreview(); }, { once: true });
    } else resource = { element: null, ready: true, kind: 'audio' };
    state.resources.set(asset.id, resource);
    return resource;
  }

  async function addFiles(fileList, targetSceneId) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let added = 0;
    const newlyAdded = [];
    for (const file of files) {
      let kind = '';
      if (file.type.startsWith('image/')) kind = 'image';
      else if (file.type.startsWith('video/')) kind = 'video';
      else if (file.type.startsWith('audio/')) kind = 'audio';
      if (!kind) continue;
      const asset = { id: id(), name: file.name, type: file.type, size: file.size, kind, blob: file, addedAt: Date.now() };
      try {
        await PeaStore.put('assets', asset);
        state.assets.push(asset);
        newlyAdded.push(asset);
        createResource(asset);
        added += 1;
      } catch (error) {
        alert(`Could not save ${file.name}. Your browser may be running low on storage. Export a project backup or remove unused media and try again.\n\n${error.message || ''}`);
        break;
      }
    }
    renderAssetList(); setupAudioOptions();
    if ($('aiSourceImage')) renderAiImageOptions();
    if (added) {
      if (!$('briefModal').hidden) {
        const ready = state.assets.filter(item => item.kind === 'image' || item.kind === 'video').length;
        $('briefMediaNote').textContent = `${ready} visual item${ready === 1 ? '' : 's'} ready. PEA will distribute your media across the scenes.`;
      }
      $('storageStatus').textContent = `${added} file${added === 1 ? '' : 's'} added to this device.`;
      const visual = [...state.assets].reverse().find(item => item.kind !== 'audio');
      if (visual) { if (targetSceneId) state.currentSceneId = targetSceneId; assignMedia(visual.id); }
      renderSceneList(); renderPreview();
    }
    await updateStorageEstimate();
    return added;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const power = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, power)).toFixed(power ? 1 : 0)} ${units[power]}`;
  }

  function renderAssetList() {
    const filter = $('assetFilter').value;
    const assets = state.assets.filter(asset => filter === 'all' || asset.kind === filter);
    $('assetCount').textContent = String(state.assets.length);
    setupLogoOptions();
    if (!assets.length) {
      $('assetList').innerHTML = `<div class="empty-state"><span>✳</span><b>${state.assets.length ? 'Nothing in this filter' : 'Your library starts here'}</b><small>${state.assets.length ? 'Choose another media filter.' : 'Add product photos, phone clips, logos and music to give PEA raw material for an advert.'}</small></div>`;
      return;
    }
    $('assetList').innerHTML = assets.map(asset => {
      const resource = state.resources.get(asset.id);
      const url = state.urls.get(asset.id);
      const active = currentScene()?.mediaId === asset.id;
      const thumb = asset.kind === 'image' ? `<img src="${url}" alt="">` : asset.kind === 'video' ? (resource?.ready ? `<video src="${url}" muted playsinline></video>` : '<span class="asset-glyph">▶</span>') : '<span class="asset-glyph">♫</span>';
      return `<article class="asset-card ${active ? 'is-placed' : ''}" data-asset-id="${asset.id}" draggable="${asset.kind !== 'audio'}" title="${escapeHtml(asset.name)}"><div class="asset-thumb">${thumb}<span class="asset-placed-mark">✓ IN SCENE</span></div><div class="asset-name">${escapeHtml(asset.name)}</div><div class="asset-kind">${asset.kind} · ${formatBytes(asset.size)}</div><button class="asset-remove" type="button" data-remove-asset="${asset.id}" aria-label="Remove ${escapeHtml(asset.name)}">×</button></article>`;
    }).join('');
    $('assetList').querySelectorAll('.asset-card').forEach(card => {
      card.addEventListener('click', event => {
        if (event.target.closest('[data-remove-asset]')) return;
        const asset = state.assets.find(item => item.id === card.dataset.assetId);
        if (asset?.kind === 'audio') { state.project.audioId = asset.id; $('audioSelect').value = asset.id; setupAudio(); scheduleSave(); }
        else assignMedia(asset.id);
      });
      card.addEventListener('dragstart', event => {
        if (card.dataset.assetId && state.assets.find(item => item.id === card.dataset.assetId)?.kind !== 'audio') {
          event.dataTransfer.setData('application/x-pea-asset', card.dataset.assetId);
          event.dataTransfer.setData('text/plain', card.dataset.assetId);
          event.dataTransfer.effectAllowed = 'copy';
          card.classList.add('dragging');
        }
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    $('assetList').querySelectorAll('[data-remove-asset]').forEach(button => button.addEventListener('click', async event => {
      event.stopPropagation(); await removeAsset(button.dataset.removeAsset);
    }));
  }

  async function removeAsset(assetId) {
    const asset = state.assets.find(item => item.id === assetId);
    if (!asset) return;
    if (!confirm(`Remove “${asset.name}” from your local media library? Scenes using it will show a placeholder.`)) return;
    await persistProject();
    await PeaStore.remove('assets', assetId);
    state.assets = state.assets.filter(item => item.id !== assetId);
    const projects = await PeaStore.all('projects');
    for (const project of projects) {
      project.scenes.forEach(scene => { if (scene.mediaId === assetId) scene.mediaId = null; if (scene.logoId === assetId) scene.logoId = ''; });
      if (project.audioId === assetId) project.audioId = '';
      await PeaStore.put('projects', project);
    }
    state.projects = await PeaStore.all('projects');
    state.project = await PeaStore.get('projects', state.project.id);
    const url = state.urls.get(assetId); if (url) URL.revokeObjectURL(url);
    state.urls.delete(assetId); state.resources.delete(assetId);
    renderAssetList(); setupAudio(); renderProjectOptions(); renderInspector(); renderSceneList(); renderPreview(); scheduleSave();
  }

  function assignMedia(assetId) {
    const asset = state.assets.find(item => item.id === assetId);
    if (!asset || asset.kind === 'audio') return;
    currentScene().mediaId = assetId;
    renderAssetList(); renderInspector(); renderSceneList(); renderPreview(); scheduleSave();
  }


  function renderProjectOptions() {
    const select = $('projectSelect');
    if (!select || !state.project) return;
    const items = [...state.projects];
    if (!items.some(item => item.id === state.project.id)) items.push(state.project);
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    select.innerHTML = '<option value="">Open project…</option>' + items.map(item => `<option value="${item.id}">${escapeHtml(item.title || 'Untitled campaign')}</option>`).join('');
    select.value = state.project.id;
  }

  async function createProject() {
    await persistProject();
    state.project = newProject(`Campaign ${new Date().toLocaleDateString()}`);
    state.projects.push(state.project);
    state.currentSceneId = state.project.scenes[0].id;
    state.playhead = 0;
    await persistProject();
    renderProject(); renderAssetList(); renderSceneList(); renderInspector(); setupAudio(); renderPreview();
  }

  async function switchProject(projectId) {
    if (!projectId) { renderProjectOptions(); return; }
    if (projectId === state.project.id) return;
    await persistProject();
    const next = await PeaStore.get('projects', projectId);
    if (!next) return;
    state.project = next;
    if (!state.project.scenes?.length) state.project.scenes = [defaultScene(0)];
    state.currentSceneId = state.project.scenes[0].id;
    state.playhead = 0; stopPlayback(false);
    renderProject(); renderAssetList(); renderSceneList(); renderInspector(); setupAudio(); renderPreview();
  }

  function renderProject() {
    $('projectTitle').value = state.project.title || 'Untitled campaign';
    renderProjectOptions();
    $('formatSelect').value = state.project.format || '9:16';
    $('volumeInput').value = state.project.volume ?? 70;
    $('volumeValue').textContent = `${state.project.volume ?? 70}%`;
    configureCanvas(); updateTimelineRange(); setupAudioOptions();
  }

  function configureCanvas() {
    const canvas = $('previewCanvas');
    const dims = PeaEngine.dimensions(state.project.format, true);
    if (canvas.width !== dims[0] || canvas.height !== dims[1]) { canvas.width = dims[0]; canvas.height = dims[1]; }
    $('previewCanvas').parentElement.style.aspectRatio = `${dims[0]} / ${dims[1]}`;
    const full = PeaEngine.dimensions(state.project.format, false);
    $('previewFormatTag').textContent = `${full[0]} × ${full[1]}`;
    $('exportFormat').textContent = `${state.project.format} ${state.project.format === '9:16' ? 'vertical' : state.project.format === '16:9' ? 'landscape' : 'feed'}`;
  }

  function renderInspector() {
    const scene = currentScene();
    $('durationInput').value = scene.duration || 5; $('durationValue').textContent = `${scene.duration || 5} sec`;
    $('eyebrowInput').value = scene.eyebrow || scene.brand || ''; $('headlineInput').value = scene.headline || ''; $('bodyInput').value = scene.body || ''; $('offerInput').value = scene.offer || ''; $('ctaInput').value = scene.cta || '';
    $('layoutSelect').value = scene.layout || 'editorial'; $('effectSelect').value = scene.effect || 'none'; $('lookSelect').value = scene.look || 'luxe'; $('motionSelect').value = scene.motion || 'rise'; $('transitionSelect').value = scene.transition || 'fade';
    $('positionSelect').value = scene.position || 'lower'; $('filterSelect').value = scene.filter || 'cinematic'; $('fontSelect').value = scene.font || 'serif'; $('fitSelect').value = scene.fit || 'cover';
    $('overlayInput').value = scene.overlay ?? 38; $('overlayValue').textContent = `${scene.overlay ?? 38}%`;
    $('textColorInput').value = scene.textColor || '#ffffff'; $('accentColorInput').value = scene.accentColor || PeaEngine.LOOKS[scene.look || 'luxe'].accent; $('signatureToggle').checked = scene.signature !== false;
    setupLogoOptions(); $('logoSelect').value = scene.logoId || ''; $('logoPositionSelect').value = scene.logoPosition || 'top-left';
    $('deleteSceneButton').disabled = state.project.scenes.length <= 1;
    const index = state.project.scenes.findIndex(item => item.id === scene.id);
    $('moveSceneUp').disabled = index <= 0; $('moveSceneDown').disabled = index >= state.project.scenes.length - 1;
  }

  function renderSceneList() {
    $('sceneList').innerHTML = state.project.scenes.map((scene, index) => {
      const media = state.assets.find(item => item.id === scene.mediaId);
      const url = media ? state.urls.get(media.id) : '';
      const thumb = media?.kind === 'image' ? `<img src="${url}" alt="">` : media?.kind === 'video' ? '<span>▶</span>' : '<span>✦</span>';
      return `<button class="scene-card ${scene.id === state.currentSceneId ? 'active' : ''} ${media ? 'has-media' : ''}" type="button" data-scene-id="${scene.id}" draggable="true"><span class="scene-thumb">${thumb}</span><span class="scene-copy"><span class="scene-number">${String(index + 1).padStart(2, '0')}</span><span class="scene-name" title="${escapeHtml(scene.headline || media?.name || 'Untitled scene')}">${escapeHtml((scene.headline || media?.name || 'Untitled scene').slice(0, 22))}</span><span class="scene-duration">${Number(scene.duration || 5).toFixed(1)} sec</span></span></button>`;
    }).join('');
    $('sceneList').querySelectorAll('[data-scene-id]').forEach(button => {
      button.addEventListener('click', () => selectScene(button.dataset.sceneId));
      button.addEventListener('dragstart', event => {
        event.dataTransfer.setData('application/x-pea-scene', button.dataset.sceneId);
        event.dataTransfer.effectAllowed = 'move'; button.classList.add('dragging');
      });
      button.addEventListener('dragend', () => { button.classList.remove('dragging'); $('sceneList').querySelectorAll('.scene-card').forEach(item => item.classList.remove('drop-before','drop-after')); });
      button.addEventListener('dragover', event => {
        event.preventDefault(); const types=Array.from(event.dataTransfer.types||[]); const hasAsset=types.includes('application/x-pea-asset'); const rect=button.getBoundingClientRect(); const after=event.clientX>=rect.left+rect.width/2;
        button.classList.toggle('drop-asset', hasAsset); button.classList.toggle('drop-before', !hasAsset && !after); button.classList.toggle('drop-after', !hasAsset && after);
      });
      button.addEventListener('dragleave', () => button.classList.remove('drop-asset','drop-before','drop-after'));
      button.addEventListener('drop', event => {
        event.preventDefault(); event.stopPropagation(); button.classList.remove('drop-asset','drop-before','drop-after');
        const assetId=event.dataTransfer.getData('application/x-pea-asset');
        if(assetId){ const scene=state.project.scenes.find(item=>item.id===button.dataset.sceneId); if(scene){scene.mediaId=assetId;state.currentSceneId=scene.id;renderAssetList();renderInspector();renderSceneList();renderPreview();scheduleSave();} }
        else if(event.dataTransfer.files?.length){state.currentSceneId=button.dataset.sceneId;addFiles(event.dataTransfer.files,button.dataset.sceneId);}
        else {const movingId=event.dataTransfer.getData('application/x-pea-scene');if(movingId&&movingId!==button.dataset.sceneId)reorderScene(movingId,button.dataset.sceneId,event.clientX>=button.getBoundingClientRect().left+button.clientWidth/2);}
      });
    });
    const index = state.project.scenes.findIndex(scene => scene.id === state.currentSceneId);
    $('sceneCounter').textContent = `SCENE ${String(index + 1).padStart(2, '0')} / ${String(state.project.scenes.length).padStart(2, '0')}`;
  }

  function reorderScene(sourceId, targetId, after) {
    const from=state.project.scenes.findIndex(scene=>scene.id===sourceId),to=state.project.scenes.findIndex(scene=>scene.id===targetId);
    if(from<0||to<0||from===to)return;
    const [scene]=state.project.scenes.splice(from,1);let insertion=to+(after?1:0);if(from<to)insertion-=1;
    state.project.scenes.splice(clamp(insertion,0,state.project.scenes.length),0,scene);
    renderSceneList();updateTimelineRange();scheduleSave();renderPreview();
  }

  function selectScene(sceneId) {
    const start = state.project.scenes.slice(0, state.project.scenes.findIndex(scene => scene.id === sceneId)).reduce((sum, scene) => sum + Number(scene.duration || 5), 0);
    state.currentSceneId = sceneId;
    stopPlayback(false); state.playhead = start;
    renderInspector(); renderAssetList(); renderSceneList(); updateTimeUI(); renderPreview();
  }


  function openBrief() {
    $('briefBrand').value = state.project.brandName || '';
    $('briefProduct').value = state.project.campaignProduct || (state.project.title && state.project.title !== 'First campaign' ? state.project.title : '');
    $('briefBenefit').value = state.project.campaignBenefit || '';
    $('briefOffer').value = state.project.campaignOffer || '';
    $('briefCta').value = state.project.campaignCta || 'Discover more';
    $('briefFormat').value = state.project.format || '9:16';
    $('briefType').value = $('templateSelect').value || state.project.campaignType || 'product';
    const direction = state.project.artDirection || 'luxe';
    $('styleChoices').querySelectorAll('[data-style]').forEach(button => button.classList.toggle('selected', button.dataset.style === direction));
    const usable = state.assets.filter(asset => asset.kind === 'image' || asset.kind === 'video').length;
    $('briefMediaNote').textContent = usable ? `${usable} visual item${usable === 1 ? '' : 's'} ready. PEA will distribute your media across the scenes.` : 'No photos yet. You can still create a designed text-led advert, then drop in images later.';
    $('briefModal').hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => $('briefBrand').focus(), 50);
  }

  function closeBrief() {
    $('briefModal').hidden = true;
    document.body.classList.remove('modal-open');
  }

  const ART_DIRECTIONS = {
    luxe: { looks:['luxe','editorial','luxe'], layouts:['editorial','spotlight','showcase'], effects:['light-leak','particles','light-leak'], accent:'#D7B77F', font:'serif', text:'#FFFFFF', motion:'rise' },
    product: { looks:['clean','editorial','clean'], layouts:['spotlight','minimal','showcase'], effects:['prism','none','prism'], accent:'#A9916F', font:'sans', text:'#29251F', motion:'zoom' },
    bold: { looks:['bold','bold','bold'], layouts:['poster','offer','split'], effects:['prism','particles','prism'], accent:'#F3BD43', font:'bold', text:'#FFFFFF', motion:'slide' },
    editorial: { looks:['editorial','luxe','editorial'], layouts:['editorial','split','poster'], effects:['grain','light-leak','grain'], accent:'#B99465', font:'serif', text:'#FFFFFF', motion:'rise' },
    warm: { looks:['warm','editorial','warm'], layouts:['spotlight','editorial','offer'], effects:['particles','light-leak','particles'], accent:'#E8AE78', font:'serif', text:'#FFFFFF', motion:'fade' },
    tech: { looks:['corporate','clean','corporate'], layouts:['split','minimal','showcase'], effects:['prism','none','prism'], accent:'#91C6E2', font:'sans', text:'#FFFFFF', motion:'slide' }
  };

  function buildCopy(type, brand, product, benefit, offer, cta) {
    const label = product.trim() || ({fashion:'The new collection',food:'A taste worth coming back for',property:'A place to call yours',business:'A better way to get things done',event:'An experience worth being part of',app:'A simpler digital experience',sale:'An offer worth a closer look'}[type] || 'Something worth discovering');
    const supporting = benefit.trim() || 'Thoughtfully made, carefully selected and ready to be discovered.';
    const brandLine = brand.trim();
    const hook = ({
      fashion:'A new mood. A new point of view.', food:'Good taste starts here.', property:'Find your next place.', sale:'The right moment. The right offer.',
      business:'Good work deserves to be seen.', event:'Make room for a moment worth remembering.', app:'A smarter way starts here.', sale:'The right moment to make it yours.'
    })[type] || 'A closer look changes everything.';
    const middle = ({
      fashion:'Made to move with you.', food:'The details are worth savouring.', property:'See the space. Picture the life.', sale:'A little extra reason to choose.',
      business:'Clear thinking. Thoughtful service.', event:'The details make the experience.', app:'Simple by design. Useful by nature.'
    })[type] || 'Made for the details.';
    const finish = offer.trim() ? 'A good moment to make your move.' : 'Your next favourite is waiting.';
    return [
      { eyebrow:brandLine, headline:label, body:supporting, offer:'', cta:'' },
      { eyebrow:brandLine || 'THE DETAILS', headline:middle, body:supporting, offer:'', cta:'' },
      { eyebrow:brandLine || 'MAKE IT YOURS', headline:finish, body:hook, offer:offer.trim(), cta:cta.trim() || 'Get in touch' }
    ];
  }

  async function generateAdvertisement() {
    const brand=$('briefBrand').value.trim();
    const product=$('briefProduct').value.trim();
    const benefit=$('briefBenefit').value.trim();
    const offer=$('briefOffer').value.trim();
    const cta=$('briefCta').value.trim();
    const type=$('briefType').value;
    const format=$('briefFormat').value;
    const style=$('styleChoices').querySelector('.style-choice.selected')?.dataset.style || 'luxe';
    if (!product && !benefit) { $('briefMessage').textContent='Add the product, service or experience you want people to notice.'; $('briefProduct').focus(); return; }
    const existing=state.project.scenes.some(scene => scene.mediaId || scene.headline !== 'A good idea deserves a great first frame.' || scene.offer);
    if (existing && !window.confirm('Replace this project’s current scene sequence with the new advert? Your media library and saved projects will remain untouched.')) return;
    const direction=ART_DIRECTIONS[style] || ART_DIRECTIONS.luxe;
    const copy=buildCopy(type,brand,product,benefit,offer,cta);
    const visuals=state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video');
    const projectName=product || brand || 'New campaign';
    state.project.title=projectName.slice(0,70);
    state.project.brandName=brand;state.project.campaignProduct=product;state.project.campaignBenefit=benefit;state.project.campaignOffer=offer;state.project.campaignCta=cta;state.project.campaignType=type;state.project.artDirection=style;state.project.format=format;
    state.project.scenes=copy.map((row,index)=>{
      const scene=defaultScene(index),lookName=direction.looks[index],look=PeaEngine.LOOKS[lookName];
      scene.eyebrow=row.eyebrow;scene.brand=brand;scene.headline=row.headline;scene.body=row.body;scene.offer=row.offer;scene.cta=row.cta;
      scene.look=lookName;scene.layout=direction.layouts[index];scene.effect=direction.effects?.[index]||'none';scene.accentColor=direction.accent;scene.backgroundColor=look.bg;scene.secondaryColor=look.ink;
      scene.textColor=direction.text;scene.secondaryTextColor=look.ink;scene.font=direction.font;scene.motion=direction.motion;
      scene.transition=['fade','zoom','slide'][index];scene.position=index===0?'lower':index===1?'center':'lower';
      scene.filter=look.filter;scene.overlay=Math.round(look.overlay*100);scene.fit=scene.layout==='spotlight'||scene.layout==='minimal'?'contain':'cover';
      scene.duration=index===1?4.5:4.2;scene.signature=true;scene.ctaStyle=style==='editorial'?'outline':'solid';
      if(visuals.length)scene.mediaId=visuals[index % visuals.length].id;
      scene.cropX=[.46,.54,.5][index];scene.cropY=[.5,.46,.54][index];
      return scene;
    });
    state.currentSceneId=state.project.scenes[0].id;state.playhead=0;stopPlayback(false);
    $('projectTitle').value=state.project.title;$('formatSelect').value=format;$('templateSelect').value=type;
    closeBrief();renderProject();renderAssetList();renderSceneList();renderInspector();renderPreview();setupAudio();scheduleSave();
    $('storageStatus').textContent=visuals.length?`PEA composed 3 scenes using ${visuals.length} visual item${visuals.length===1?'':'s'}.`:'PEA composed a text-led campaign. Drop in product media to complete the visuals.';
    if(!visuals.length) $('previewHint').classList.remove('visible');
  }

  const STORY_TEMPLATES = {
    product: [
      ['Meet the new favourite.', 'A closer look at something made to stand out.', 'Discover it', 'luxe'],
      ['Made for the details.', 'Thoughtful design. Beautiful finish. Made to be noticed.', 'Explore the features', 'editorial'],
      ['Ready when you are.', 'Bring something exceptional into your everyday.', 'Shop now', 'luxe']
    ],
    fashion: [
      ['A new mood. A new collection.', 'Fresh pieces. Distinctive style. Your next favourite.', 'View the collection', 'editorial'],
      ['Wear your point of view.', 'Explore the textures, the cut and the little details.', 'Find your fit', 'luxe'],
      ['Your next look is waiting.', 'Discover the latest arrivals today.', 'Shop the edit', 'editorial']
    ],
    sale: [
      ['This is the moment.', 'A special offer worth taking a closer look at.', 'See the offer', 'bold'],
      ['More of what you love.', 'Selected favourites. A limited-time price.', 'Explore the deals', 'bold'],
      ["Don't leave it too late.", 'Offer available for a limited time. Terms apply.', 'Shop the offer', 'bold']
    ],
    food: [
      ['Good taste starts here.', 'Freshly prepared. Beautifully served. Ready for you.', 'See the menu', 'warm'],
      ['Take a moment. Take a bite.', 'A table, a favourite dish and a little something special.', 'Visit us today', 'warm'],
      ['Your next meal is sorted.', 'Come hungry. Leave happy.', 'Book a table', 'warm']
    ],
    property: [
      ['A place to call yours.', 'Step inside a space designed for living.', 'Explore this property', 'clean'],
      ['Space for the next chapter.', 'Discover the rooms, the setting and the possibilities.', 'View the details', 'editorial'],
      ["Let's get you home.", 'Arrange a viewing and see it for yourself.', 'Enquire today', 'clean']
    ],
    business: [
      ['Good work deserves to be seen.', 'Meet a team focused on doing things differently.', 'Get to know us', 'corporate'],
      ['Built around what matters.', 'Clear service. Thoughtful solutions. People first.', 'See what we do', 'corporate'],
      ["Let's make something happen.", 'Talk to us about your next project.', 'Contact our team', 'corporate']
    ],
    event: [
      ['Save the date.', 'A special gathering is coming. Be part of it.', 'Get the details', 'bold'],
      ['A moment worth showing up for.', 'The people, the atmosphere and the experience.', 'See the programme', 'luxe'],
      ["We'll see you there.", 'Check the details and secure your place.', 'Register now', 'bold']
    ],
    app: [
      ['A simpler way to get things done.', 'Meet a digital experience designed around you.', 'Take a look', 'corporate'],
      ['Everything in one place.', 'Explore the features that make everyday work easier.', 'Explore the app', 'clean'],
      ['Ready when you are.', 'Start using the service today.', 'Get started', 'corporate']
    ]
  };

  function applyStoryTemplate() {
    const kind = $('templateSelect').value;
    const rows = STORY_TEMPLATES[kind] || STORY_TEMPLATES.product;
    const hasExistingWork = state.project.scenes.length > 1 || state.project.scenes.some(scene => scene.mediaId || scene.logoId || (scene.headline && scene.headline !== defaultScene(0).headline));
    if (hasExistingWork && !confirm('Replace this project’s current scene sequence with the selected 3-scene starter? Your uploaded media library will remain untouched.')) return;
    state.project.scenes = rows.map((row, index) => {
      const scene = defaultScene(index);
      scene.headline = row[0]; scene.body = row[1]; scene.cta = row[2]; scene.look = row[3];
      scene.duration = index === 1 ? 4.5 : 4;
      scene.transition = index === 0 ? 'fade' : index === 1 ? 'zoom' : 'slide';
      scene.position = index === 1 ? 'center' : 'lower';
      scene.overlay = PeaEngine.LOOKS[scene.look].overlay * 100;
      scene.filter = PeaEngine.LOOKS[scene.look].filter;
      scene.font = PeaEngine.LOOKS[scene.look].font;
      scene.layout = kind === 'sale' ? ['poster','offer','split'][index] : kind === 'property' ? ['showcase','split','editorial'][index] : kind === 'food' ? ['spotlight','editorial','offer'][index] : ['editorial','spotlight','showcase'][index];
      const visuals = state.assets.filter(asset => asset.kind === 'image' || asset.kind === 'video');
      if (visuals.length) scene.mediaId = visuals[index % visuals.length].id;
      scene.accentColor = PeaEngine.LOOKS[scene.look].accent;
      return scene;
    });
    state.currentSceneId = state.project.scenes[0].id; state.playhead = 0; stopPlayback(false);
    renderAssetList(); renderInspector(); renderSceneList(); updateTimelineRange(); renderPreview(); scheduleSave();
  }

  function addScene() {
    const scene = defaultScene(state.project.scenes.length);
    scene.headline = 'And there is more.';
    scene.body = 'Show them what makes your brand worth choosing.';
    scene.cta = 'Find out more';
    state.project.scenes.push(scene);
    state.currentSceneId = scene.id;
    state.playhead = PeaEngine.totalDuration({ scenes: state.project.scenes.slice(0, -1) });
    renderInspector(); renderSceneList(); updateTimelineRange(); renderPreview(); scheduleSave();
  }

  function deleteScene() {
    if (state.project.scenes.length <= 1) return;
    const index = state.project.scenes.findIndex(scene => scene.id === state.currentSceneId);
    state.project.scenes.splice(index, 1);
    const next = state.project.scenes[Math.max(0, index - 1)];
    state.currentSceneId = next.id;
    state.playhead = 0;
    renderInspector(); renderSceneList(); updateTimelineRange(); renderPreview(); scheduleSave();
  }

  function moveScene(direction) {
    const index = state.project.scenes.findIndex(scene => scene.id === state.currentSceneId);
    const next = index + direction;
    if (next < 0 || next >= state.project.scenes.length) return;
    const [item] = state.project.scenes.splice(index, 1);
    state.project.scenes.splice(next, 0, item);
    renderSceneList(); renderInspector(); updateTimelineRange(); scheduleSave(); renderPreview();
  }

  function updateTimelineRange() {
    const total = Math.max(1, PeaEngine.totalDuration(state.project));
    $('timelineScrubber').max = total;
    $('totalTime').textContent = formatTime(total);
    state.playhead = clamp(state.playhead, 0, total);
    updateTimeUI();
  }
  function updateTimeUI() {
    const total = PeaEngine.totalDuration(state.project);
    $('timelineScrubber').value = String(clamp(state.playhead, 0, total));
    $('currentTime').textContent = formatTime(state.playhead);
    $('totalTime').textContent = formatTime(total);
  }

  function renderAt(time, canvas) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const located = PeaEngine.locateScene(state.project, time);
    if (!located) return;
    const scene = located.scene;
    const asset = state.assets.find(item => item.id === scene.mediaId);
    const resource = asset ? state.resources.get(asset.id) : null;
    const width = canvas.width; const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const logoResource = scene.logoId ? state.resources.get(scene.logoId) : null;
    const drawn = PeaEngine.drawScene(ctx, scene, resource, located.local, width, height, { format: state.project.format, logoMedia: logoResource, preview: true });
    const hint = $('previewHint');
    if (hint) {
      const hasAssignedMedia = !!scene.mediaId;
      const hasDesignedCampaign = !!(state.project.campaignProduct || state.project.campaignBenefit || state.project.scenes.length > 1);
      const mediaFailed = !!resource?.failed;
      const mediaPending = hasAssignedMedia && !resource?.ready && !mediaFailed;
      hint.classList.toggle('visible', mediaPending || mediaFailed || (!hasAssignedMedia && !hasDesignedCampaign));
      const title = hint.querySelector('b'); const detail = hint.querySelector('small');
      if (title && detail) {
        title.textContent = mediaFailed ? 'This file could not be opened.' : mediaPending ? 'Preparing your media…' : 'Your advert is taking shape.';
        detail.textContent = mediaFailed ? 'Try another image or video format, then place it in this scene again.' : mediaPending ? 'PEA is loading your file into the art-directed composition.' : 'Drop a photo or video here, or build a complete advert from a brief.';
      }
    }
  }

  function renderPreview() {
    if (!state.project) return;
    renderAt(state.playhead, $('previewCanvas'));
    updateTimeUI();
  }

  function syncVideo(time, allowPlay) {
    const located = PeaEngine.locateScene(state.project, time);
    const currentAssetId = located?.scene?.mediaId;
    for (const [assetId, resource] of state.resources.entries()) {
      if (resource.kind !== 'video' || !resource.ready) continue;
      const video = resource.element;
      if (assetId !== currentAssetId) { if (!video.paused) video.pause(); continue; }
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const desired = located.local % duration;
      if (Math.abs(video.currentTime - desired) > (allowPlay ? 1.15 : .16)) {
        try { video.currentTime = desired; } catch (_) { /* Browser is still preparing the clip. */ }
      }
      if (allowPlay && video.paused) video.play().catch(() => {});
      if (!allowPlay && !video.paused) video.pause();
    }
  }

  function setupLogoOptions() {
    const select = $('logoSelect');
    if (!select) return;
    const current = currentScene()?.logoId || '';
    select.innerHTML = '<option value="">No logo selected</option>' + state.assets.filter(asset => asset.kind === 'image').map(asset => `<option value="${asset.id}">${escapeHtml(asset.name)}</option>`).join('');
    select.value = state.assets.some(asset => asset.id === current && asset.kind === 'image') ? current : '';
  }

  function setupAudioOptions() {
    const select = $('audioSelect');
    const current = state.project?.audioId || '';
    select.innerHTML = '<option value="">No soundtrack selected</option>' + state.assets.filter(asset => asset.kind === 'audio').map(asset => `<option value="${asset.id}">${escapeHtml(asset.name)}</option>`).join('');
    select.value = state.assets.some(asset => asset.id === current && asset.kind === 'audio') ? current : '';
    if (state.project && select.value !== current) state.project.audioId = select.value;
  }

  function setupAudio() {
    setupAudioOptions();
    if (state.audioPreview) { state.audioPreview.pause(); state.audioPreview.src = ''; state.audioPreview = null; }
    const asset = state.assets.find(item => item.id === state.project.audioId && item.kind === 'audio');
    if (!asset) return;
    const audio = new Audio(state.urls.get(asset.id));
    audio.loop = true; audio.preload = 'auto'; audio.volume = (state.project.volume ?? 70) / 100;
    state.audioPreview = audio;
    if (state.playing) audio.play().catch(() => {});
  }

  function togglePlay() { if (state.playing) stopPlayback(); else startPlayback(); }
  function startPlayback() {
    if (state.playhead >= PeaEngine.totalDuration(state.project)) state.playhead = 0;
    state.playing = true; state.lastFrame = performance.now();
    $('playButton').textContent = 'Ⅱ'; $('playButton').setAttribute('aria-label', 'Pause preview');
    if (state.audioPreview) { state.audioPreview.currentTime = state.playhead % (state.audioPreview.duration || 999999); state.audioPreview.play().catch(() => {}); }
    syncVideo(state.playhead, true);
    const tick = now => {
      if (!state.playing) return;
      const delta = Math.min(.12, (now - state.lastFrame) / 1000);
      state.lastFrame = now;
      state.playhead += delta;
      if (state.playhead >= PeaEngine.totalDuration(state.project)) { state.playhead = 0; stopPlayback(false); renderPreview(); return; }
      syncVideo(state.playhead, true); renderPreview();
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }
  function stopPlayback(render = true) {
    state.playing = false; cancelAnimationFrame(state.raf);
    $('playButton').textContent = '▶'; $('playButton').setAttribute('aria-label', 'Play preview');
    if (state.audioPreview) state.audioPreview.pause();
    syncVideo(state.playhead, false);
    if (render) renderPreview();
  }

  let saveQueued = false;
  function scheduleSave() {
    if (!state.project) return;
    state.project.updatedAt = Date.now();
    $('saveStatus').classList.add('saving');
    $('saveStatus').innerHTML = '<i></i> Saving locally';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persistProject, 450);
  }
  async function persistProject() {
    if (!state.project) return;
    try {
      state.project.updatedAt = Date.now();
      await PeaStore.put('projects', state.project);
      state.projects = await PeaStore.all('projects');
      renderProjectOptions();
      $('saveStatus').classList.remove('saving');
      $('saveStatus').innerHTML = '<i></i> Saved locally';
    } catch (error) {
      $('saveStatus').classList.remove('saving');
      $('saveStatus').innerHTML = '<i></i> Save issue';
      $('saveStatus').title = error.message || 'Could not save this project';
      $('storageStatus').textContent = 'Storage is full or unavailable. Download a project backup now.';
    }
  }

  async function updateStorageEstimate() {
    const estimate = await PeaStore.estimate();
    if (estimate && estimate.quota) {
      const used = estimate.usage || 0;
      $('storageStatus').textContent = `${formatBytes(used)} used in this browser · ${formatBytes(estimate.quota)} available quota`;
    } else $('storageStatus').textContent = 'Your projects are saved on this device. Download regular backups.';
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not package a media file.'));
      reader.readAsDataURL(blob);
    });
  }
  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = head.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
    const binary = atob(body || ''); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  async function backupProject() {
    await persistProject();
    const relatedIds = new Set(state.project.scenes.map(scene => scene.mediaId).filter(Boolean));
    if (state.project.audioId) relatedIds.add(state.project.audioId);
    // Include the complete library to make the backup useful for future scenes too.
    const media = [];
    try {
      for (const asset of state.assets) media.push({ id: asset.id, name: asset.name, type: asset.type, size: asset.size, kind: asset.kind, data: await blobToDataUrl(asset.blob) });
      const backup = { format: 'PEA-STUDIO-PROJECT', version: 1, exportedAt: new Date().toISOString(), project: state.project, assets: media };
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      downloadBlob(blob, `${safeFilename(state.project.title)}.pea`);
      $('storageStatus').textContent = `Backup created with ${media.length} media file${media.length === 1 ? '' : 's'}.`;
    } catch (error) { alert(`Backup could not be created: ${error.message || error}`); }
  }
  async function importProject(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'PEA-STUDIO-PROJECT' || !data.project || !Array.isArray(data.assets)) throw new Error('This is not a valid PEA Studio backup.');
      if (!confirm(`Import “${data.project.title || 'Untitled campaign'}” and ${data.assets.length} media files? Existing projects will be kept.`)) return;
      for (const item of data.assets) {
        const blob = dataUrlToBlob(item.data);
        const asset = { id: item.id || id(), name: item.name || 'Imported media', type: item.type || blob.type, size: blob.size, kind: item.kind || (blob.type.startsWith('image/') ? 'image' : blob.type.startsWith('video/') ? 'video' : 'audio'), blob, addedAt: Date.now() };
        await PeaStore.put('assets', asset);
      }
      const project = data.project;
      if (!project.id) project.id = id();
      project.id = `${project.id}-import-${Date.now()}`;
      project.title = `${project.title || 'Imported project'} (imported)`;
      project.updatedAt = Date.now();
      await PeaStore.put('projects', project);
      window.location.reload();
    } catch (error) { alert(`Could not import that backup. ${error.message || ''}`); }
  }
  function safeFilename(value) { return String(value || 'pea-advert').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'pea-advert'; }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function openExportModal() {
    stopPlayback(false); updateExportSpecs(); $('exportMessage').textContent = '';
    $('exportProgress').hidden = true; $('startExport').disabled = false; $('startExport').textContent = 'Render MP4 ↗';
    $('exportModal').hidden = false;
  }
  function updateExportSpecs() {
    $('exportFormat').textContent = `${state.project.format} · ${state.project.format === '9:16' ? 'vertical' : state.project.format === '16:9' ? 'landscape' : 'feed'}`;
  }
  function closeExportModal() {
    if (state.exportBusy && !confirm('An export is currently running. Close this window and let the render finish in the background?')) return;
    $('exportModal').hidden = true;
  }

  async function renderRecording() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser does not support video recording. Please use the latest Chrome or Edge on your computer.');
    const dims = PeaEngine.dimensions(state.project.format, false);
    const canvas = document.createElement('canvas'); canvas.width = dims[0]; canvas.height = dims[1];
    const ctx = canvas.getContext('2d', { alpha: false });
    const stream = canvas.captureStream(30);
    let audioContext = null; let audio = null;
    const audioAsset = state.assets.find(item => item.id === state.project.audioId && item.kind === 'audio');
    if (audioAsset) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();
        audio = new Audio(state.urls.get(audioAsset.id)); audio.loop = true; audio.volume = 1;
        const source = audioContext.createMediaElementSource(audio);
        const gain = audioContext.createGain(); gain.gain.value = (state.project.volume ?? 70) / 100;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(gain); gain.connect(destination);
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        await audio.play();
      } catch (error) {
        if (audioContext) await audioContext.close().catch(() => {});
        throw new Error(`Could not prepare the soundtrack: ${error.message || error}`);
      }
    }
    const mimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    let recorder;
    try { recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8000000 } : { videoBitsPerSecond: 8000000 }); }
    catch (error) { stream.getTracks().forEach(track => track.stop()); if (audioContext) await audioContext.close(); throw new Error(`Could not start the video encoder: ${error.message || error}`); }
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    const finished = new Promise((resolve, reject) => {
      recorder.onerror = event => reject(event.error || new Error('The browser video encoder stopped unexpectedly.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    });
    const duration = PeaEngine.totalDuration(state.project);
    let startedAt = 0;
    $('exportProgress').hidden = false;
    $('exportStage').textContent = 'Rendering scenes';
    $('exportHint').textContent = 'Keep this tab open. Full HD rendering uses your computer.';
    $('exportPercent').textContent = '0%'; $('exportProgressBar').style.width = '0%';
    recorder.start(500);
    state.exportBusy = true; state.exportCancelled = false; state.exportCanvas = canvas;
    startedAt = performance.now();
    const drawLoop = () => {
      if (state.exportCancelled) { if (recorder.state !== 'inactive') recorder.stop(); return; }
      const elapsed = Math.min(duration, (performance.now() - startedAt) / 1000);
      const located = PeaEngine.locateScene(state.project, elapsed);
      syncVideo(elapsed, true);
      const scene = located?.scene;
      const asset = scene && state.assets.find(item => item.id === scene.mediaId);
      const resource = asset && state.resources.get(asset.id);
      const logoResource = scene?.logoId ? state.resources.get(scene.logoId) : null;
      PeaEngine.drawScene(ctx, scene || defaultScene(0), resource, located?.local || 0, canvas.width, canvas.height, { format: state.project.format, logoMedia: logoResource });
      const percent = Math.min(100, Math.round(elapsed / duration * 100));
      $('exportPercent').textContent = `${percent}%`; $('exportProgressBar').style.width = `${percent}%`;
      if (elapsed >= duration) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      state.exportFrame = requestAnimationFrame(drawLoop);
    };
    drawLoop();
    let blob;
    try { blob = await finished; }
    finally {
      state.exportBusy = false;
      cancelAnimationFrame(state.exportFrame);
      stream.getTracks().forEach(track => track.stop());
      if (audio) { audio.pause(); audio.src = ''; }
      if (audioContext) await audioContext.close().catch(() => {});
      for (const resource of state.resources.values()) if (resource.kind === 'video' && !resource.element.paused) resource.element.pause();
      state.exportCanvas = null;
    }
    if (state.exportCancelled) throw new Error('Export cancelled.');
    if (!blob || !blob.size) throw new Error('The browser created an empty video. Please try again.');
    return blob;
  }

  async function exportProject() {
    if (state.exportBusy) return;
    $('startExport').disabled = true; $('cancelExport').disabled = true;
    $('exportMessage').textContent = '';
    try {
      const webm = await renderRecording();
      $('exportStage').textContent = 'Preparing your MP4'; $('exportPercent').textContent = '100%'; $('exportProgressBar').style.width = '100%';
      if (navigator.onLine && state.onlineSession && state.csrf) {
        try {
          const form = new FormData();
          form.append('video', webm, `${safeFilename(state.project.title)}.webm`);
          const response = await fetch('/api/export/mp4', { method: 'POST', body: form, headers: { 'X-CSRF-Token': state.csrf }, credentials: 'same-origin' });
          if (!response.ok) {
            let problem = 'MP4 conversion was not available.';
            try { const data = await response.json(); problem = data.error || problem; } catch (_) {}
            throw new Error(problem);
          }
          const mp4 = await response.blob();
          downloadBlob(mp4, `${safeFilename(state.project.title)}.mp4`);
          $('exportStage').textContent = 'Your MP4 is ready'; $('exportHint').textContent = 'Full HD H.264 video exported successfully.';
          notify('Your MP4 has been downloaded. That is one more advert ready for the world.', 'success');
        } catch (error) {
          downloadBlob(webm, `${safeFilename(state.project.title)}.webm`);
          $('exportStage').textContent = 'WebM downloaded'; $('exportHint').textContent = 'MP4 conversion could not be reached. Your rendered video was saved as WebM instead.';
          notify(`${error.message || 'MP4 conversion failed'} Your video is safe as a WebM download. Reconnect and render MP4 again.`, 'error');
        }
      } else {
        downloadBlob(webm, `${safeFilename(state.project.title)}.webm`);
        $('exportStage').textContent = 'Offline video downloaded';
        $('exportHint').textContent = 'Your offline render is WebM. Reconnect to PEA Studio to convert it to MP4.';
        notify('Offline render saved as WebM. MP4 conversion becomes available when connected to the studio.', 'success');
      }
    } catch (error) {
      $('exportStage').textContent = 'Export stopped';
      notify(error.message || 'The export could not be completed. Your project is still saved locally.', 'error');
    } finally {
      $('startExport').disabled = false; $('cancelExport').disabled = false;
      $('startExport').textContent = 'Render again ↗';
    }
  }


  // -------------------------------------------------------------------------
  // AI Studio: direct, private ComfyUI queue integration (no public demo queue)
  // -------------------------------------------------------------------------
  const aiState = {
    engineUrl: 'http://127.0.0.1:8188',
    workflowRaw: '',
    workflowName: '',
    promptCandidates: [],
    imageCandidates: [],
    jobId: '',
    outputs: [],
    lastRequest: null,
    polling: false,
    connected: false,
    generationStartedAt: 0,
    pendingSubmissionKey: '',
  };
  const AI_SETTINGS_KEY = 'pea-ai-local-settings-v1';

  function loadAiSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        aiState.engineUrl = saved.engineUrl || aiState.engineUrl;
        aiState.workflowRaw = saved.workflowRaw || '';
        aiState.workflowName = saved.workflowName || '';
      }
    } catch (_) { /* A broken local setting is safely ignored. */ }
    $('aiEngineUrl').value = aiState.engineUrl;
    if (aiState.workflowRaw && !aiState.promptCandidates.length) {
      try { importAiWorkflowText(aiState.workflowRaw, aiState.workflowName || 'Saved workflow.json', false); }
      catch (error) { setAiWorkflowMessage(error.message || 'Saved workflow could not be loaded.', 'bad'); }
    } else if (aiState.workflowName) {
      $('aiWorkflowFilename').textContent = aiState.workflowName;
    }
  }

  function saveAiSettings() {
    try {
      localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
        engineUrl: aiState.engineUrl,
        workflowRaw: aiState.workflowRaw,
        workflowName: aiState.workflowName,
      }));
    } catch (error) {
      // Keep the workflow for this session even if the browser storage quota is low.
      setAiWorkflowMessage('Workflow loaded for this session, but the browser could not save it permanently. Keep the API JSON file somewhere safe.', 'bad');
    }
  }

  function setAiWorkflowMessage(message, kind = '') {
    const target = $('aiWorkflowMessage');
    target.textContent = message;
    target.className = `ai-status-message${kind ? ` ${kind}` : ''}`;
  }

  function setAiConnectionMessage(message, kind = '') {
    const target = $('aiConnectionMessage');
    target.textContent = message;
    target.className = `ai-status-message${kind ? ` ${kind}` : ''}`;
  }

  function renderAiImageOptions() {
    const select = $('aiSourceImage');
    if (!select) return;
    const previous = select.value;
    const photos = state.assets.filter(asset => asset.kind === 'image');
    select.innerHTML = '<option value="">No reference photo · create from text</option>';
    photos.forEach(asset => {
      const option = document.createElement('option');
      option.value = asset.id;
      option.textContent = asset.name;
      select.appendChild(option);
    });
    if (photos.some(asset => asset.id === previous)) select.value = previous;
    else if (photos.length) select.value = photos[photos.length - 1].id;
    renderAiSelectedImage();
  }

  function renderAiSelectedImage() {
    const box = $('aiImagePreview');
    const asset = state.assets.find(item => item.id === $('aiSourceImage').value && item.kind === 'image');
    if (!asset) { box.hidden = true; box.replaceChildren(); return; }
    const url = state.urls.get(asset.id);
    if (!url) { box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren();
    const img = document.createElement('img');
    img.src = url;
    img.alt = asset.name;
    box.appendChild(img);
  }

  function optionLabel(candidate) {
    return `${candidate.title} · ${candidate.input}`;
  }

  function fillAiMappingSelect(selectId, candidates, includeNone, preferredId) {
    const select = $(selectId);
    select.innerHTML = '';
    if (includeNone) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'No image input · text-to-video';
      select.appendChild(none);
    }
    candidates.forEach(candidate => {
      const option = document.createElement('option');
      option.value = `${candidate.node_id}|${candidate.input}`;
      option.textContent = optionLabel(candidate);
      select.appendChild(option);
    });
    if (preferredId && Array.from(select.options).some(option => option.value === preferredId)) select.value = preferredId;
  }

  async function importAiWorkflowText(raw, filename, persist = true) {
    let workflow;
    try { workflow = JSON.parse(raw); }
    catch (_) { throw new Error('That file is not valid JSON. Export the workflow again from ComfyUI.'); }
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || Array.isArray(workflow.nodes)) {
      throw new Error('This is not a ComfyUI API export. In ComfyUI use File → Export Workflow (API), not Save.');
    }
    const response = await fetch('/api/ai/inspect-workflow', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
      body: JSON.stringify({ workflow }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'PEA could not read this workflow.');
    aiState.workflowRaw = raw;
    aiState.workflowName = filename || 'ComfyUI workflow.json';
    aiState.promptCandidates = data.prompts || [];
    aiState.imageCandidates = data.images || [];
    $('aiWorkflowFilename').textContent = aiState.workflowName;
    const positivePrompts = aiState.promptCandidates.filter(item => !item.negative);
    fillAiMappingSelect('aiPromptNode', positivePrompts, false, positivePrompts[0] ? `${positivePrompts[0].node_id}|${positivePrompts[0].input}` : '');
    const firstImageInput = aiState.imageCandidates[0] ? `${aiState.imageCandidates[0].node_id}|${aiState.imageCandidates[0].input}` : '';
    fillAiMappingSelect('aiImageNode', aiState.imageCandidates, true, firstImageInput);
    $('aiMappingFields').hidden = false;
    $('aiWorkflowMessage').textContent = data.note || `PEA recognised ${data.node_count} workflow nodes.`;
    $('aiWorkflowMessage').className = 'ai-status-message good';
    updateAiGenerateAvailability();
    if (persist) saveAiSettings();
  }

  async function checkAiConnection(showMessage = true) {
    if (!state.onlineSession || !navigator.onLine) {
      if (showMessage) setAiConnectionMessage('Connect to the PEA server first. Local ComfyUI generation is started through the PEA server, not directly from the browser.', 'bad');
      aiState.connected = false;
      updateAiGenerateAvailability();
      return false;
    }
    const entered = $('aiEngineUrl').value.trim() || 'http://127.0.0.1:8188';
    if (showMessage) setAiConnectionMessage('Checking ComfyUI…');
    $('aiCheckButton').disabled = true;
    try {
      const response = await fetch('/api/ai/status', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
        body: JSON.stringify({ engine_url: entered }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'The AI engine could not be reached.');
      aiState.engineUrl = entered.replace(/\/$/, '');
      aiState.connected = true;
      saveAiSettings();
      const deviceText = (data.devices || []).map(device => {
        const total = Number(device.vram_total || 0);
        const free = Number(device.vram_free || 0);
        const vram = total ? ` · ${(total / 1024 / 1024 / 1024).toFixed(1)} GB VRAM (${(free / 1024 / 1024 / 1024).toFixed(1)} GB free)` : '';
        return `${device.name}${vram}`;
      }).join(' · ');
      $('aiDeviceInfo').textContent = `${deviceText || 'ComfyUI is responding'} · Queue: ${data.queue_running} running, ${data.queue_pending} waiting`;
      $('aiDeviceInfo').hidden = false;
      if (showMessage) setAiConnectionMessage(data.message || 'AI engine connected.', 'good');
      updateAiGenerateAvailability();
      return true;
    } catch (error) {
      aiState.connected = false;
      $('aiDeviceInfo').hidden = true;
      if (showMessage) setAiConnectionMessage(error.message || 'Connection failed.', 'bad');
      updateAiGenerateAvailability();
      return false;
    } finally { $('aiCheckButton').disabled = false; }
  }

  function updateAiGenerateAvailability() {
    const hasWorkflow = !!aiState.workflowRaw && aiState.promptCandidates.length > 0;
    const hasPrompt = !!$('aiPromptNode')?.value;
    $('aiGenerateButton').disabled = !state.onlineSession || !aiState.connected || !hasWorkflow || !hasPrompt || aiState.polling;
  }

  function openAiModal() {
    loadAiSettings();
    renderAiImageOptions();
    $('aiModal').hidden = false;
    $('aiWanPrompt').focus();
    if (navigator.onLine && state.onlineSession) checkAiConnection(false).then(connected => {
      if (!connected) setAiConnectionMessage('Not connected. Start ComfyUI on the same computer as PEA, then press Connect.');
    });
    updateAiGenerateAvailability();
  }

  function closeAiModal() {
    $('aiModal').hidden = true;
  }

  function setupAiStudio() {
    loadAiSettings();
    renderAiImageOptions();
    $('closeAiModal').onclick = closeAiModal;
    $('aiModal').addEventListener('click', event => { if (event.target === $('aiModal')) closeAiModal(); });
    $('aiEngineUrl').addEventListener('change', () => { aiState.connected = false; aiState.engineUrl = $('aiEngineUrl').value.trim(); updateAiGenerateAvailability(); });
    $('aiCheckButton').onclick = () => checkAiConnection(true);
    $('aiWorkflowFile').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setAiWorkflowMessage('Reading and checking your ComfyUI workflow…');
      try { await importAiWorkflowText(await file.text(), file.name); }
      catch (error) { aiState.workflowRaw = ''; aiState.promptCandidates = []; aiState.imageCandidates = []; $('aiMappingFields').hidden = true; updateAiGenerateAvailability(); setAiWorkflowMessage(error.message || 'Workflow import failed.', 'bad'); }
    });
    $('aiWanCopyPrompt').addEventListener('click', async () => {
      const prompt = $('aiWanPrompt').value.trim();
      if (!prompt) {
        $('aiWanPromptMessage').textContent = 'Write a shot description first.';
        $('aiWanPrompt').focus();
        return;
      }
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(prompt);
        } else {
          $('aiWanPrompt').focus();
          $('aiWanPrompt').select();
          const copied = document.execCommand('copy');
          if (!copied) throw new Error('Clipboard unavailable');
        }
        $('aiWanPromptMessage').textContent = 'Prompt copied. Paste it into the notebook’s Create your clip cell.';
        $('aiWanPromptMessage').className = 'ai-small-note good';
      } catch (_) {
        $('aiWanPrompt').focus();
        $('aiWanPrompt').select();
        $('aiWanPromptMessage').textContent = 'Select and copy the prompt above, then paste it into the notebook.';
        $('aiWanPromptMessage').className = 'ai-small-note';
      }
    });
    $('aiWanImportVideo').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('video/')) {
        $('aiWanImportMessage').textContent = 'Choose a video file such as MP4 or WebM.';
        $('aiWanImportMessage').className = 'ai-status-message bad';
        return;
      }
      $('aiWanImportMessage').textContent = 'Importing your finished clip into the PEA Media Library…';
      $('aiWanImportMessage').className = 'ai-status-message';
      try {
        const added = await addFiles([file], state.currentSceneId);
        if (!added) throw new Error('PEA could not save the clip. Check available browser storage and try a smaller file.');
        $('storageStatus').textContent = `Open-source AI clip added: ${file.name}`;
        $('aiWanImportMessage').textContent = `Added to your selected scene: ${file.name}`;
        $('aiWanImportMessage').className = 'ai-status-message good';
        closeAiModal();
      } catch (error) {
        $('aiWanImportMessage').textContent = error.message || 'PEA could not import that clip. Try a smaller MP4 file.';
        $('aiWanImportMessage').className = 'ai-status-message bad';
      }
    });
    $('aiPromptNode').addEventListener('change', updateAiGenerateAvailability);
    $('aiImageNode').addEventListener('change', updateAiGenerateAvailability);
    $('aiSourceImage').addEventListener('change', renderAiSelectedImage);
    $('aiUploadSource').addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      const image = files.find(file => file.type.startsWith('image/'));
      if (!image) { setAiWorkflowMessage('Choose a photo (JPG, PNG or WEBP) for image-to-video.', 'bad'); return; }
      await addFiles([image], state.currentSceneId);
      const newest = [...state.assets].reverse().find(asset => asset.kind === 'image' && asset.name === image.name);
      renderAiImageOptions();
      if (newest) { $('aiSourceImage').value = newest.id; renderAiSelectedImage(); }
    });
    $('aiUsePromptAssist').onclick = () => {
      const text = $('aiPrompt').value.trim();
      if (!text) { $('aiPrompt').focus(); return; }
      const reminder = 'Create a polished commercial-quality moving image. Treat the supplied reference photo as the source of truth: preserve the product identity, shape, colour, packaging, label and visible brand marks. Use deliberate natural motion, controlled camera movement, beautiful lighting, realistic reflections and a clean premium composition. Avoid invented text, extra logos, warped products, flicker and unnecessary scene changes.';
      if (!/preserve|source of truth|identity/i.test(text)) $('aiPrompt').value = `${text}\n\n${reminder}`;
      else $('aiPrompt').value = `${text}\n\nKeep the movement smooth and the product visually consistent throughout the shot. Avoid extra text or invented logos.`;
    };
    $('aiGenerateButton').onclick = () => submitAiGeneration(false);
    $('aiRetryButton').onclick = () => submitAiGeneration(true);
    $('aiCancelButton').onclick = cancelAiGeneration;
    updateAiGenerateAvailability();
    restoreLatestAiJob();
  }

  async function restoreLatestAiJob() {
    if (!state.onlineSession) return;
    try {
      const response = await fetch('/api/ai/jobs/latest', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.job) return;
      const job = data.job;
      aiState.jobId = job.id;
      aiState.outputs = job.outputs || [];
      aiState.lastRequest = {
        engineUrl: job.engine_url || aiState.engineUrl,
        workflowRaw: aiState.workflowRaw,
        promptNodeId: job.prompt_node_id || '', promptInput: job.prompt_input || '',
        imageNodeId: job.image_node_id || '', imageInput: job.image_input || '',
        prompt: job.prompt || '', sourceAssetId: job.source_asset_id || '', submissionKey: '',
      };
      $('aiJobPanel').hidden = false;
      $('aiJobTitle').textContent = job.status === 'complete' ? 'Your AI scene is ready' : job.status === 'failed' ? 'Your last scene needs attention' : 'Resuming your AI scene';
      $('aiJobState').textContent = job.status || 'Saved';
      $('aiJobMessage').textContent = job.message || 'PEA restored your last generation record.';
      $('aiJobError').hidden = !job.error;
      $('aiJobError').textContent = job.error || '';
      if (job.status === 'complete') {
        $('aiProgressBar').style.width = '100%';
        renderAiResults();
      } else if (['queued', 'running'].includes(job.status)) {
        aiState.polling = true;
        $('aiProgressBar').style.width = job.status === 'running' ? '68%' : '24%';
        $('aiCancelButton').hidden = false;
        pollAiJob();
      } else if (job.status === 'failed') {
        $('aiProgressBar').style.width = '0%';
        $('aiRetryButton').hidden = false;
      }
      updateAiGenerateAvailability();
    } catch (_) { /* A missing or unavailable AI engine does not block the editor. */ }
  }

  async function submitAiGeneration(retry) {
    if (aiState.polling) return;
    if (!aiState.workflowRaw) { setAiWorkflowMessage('Load an LTX ComfyUI API workflow before generating.', 'bad'); return; }
    if (!aiState.connected && !(await checkAiConnection(true))) return;
    const previousRequest = retry && aiState.lastRequest ? aiState.lastRequest : null;
    const promptValue = previousRequest ? previousRequest.prompt : $('aiPrompt').value.trim();
    if (!promptValue) { $('aiPrompt').focus(); $('aiJobError').hidden = false; $('aiJobError').textContent = 'Describe what should move in this scene.'; return; }
    const selectedPrompt = previousRequest ? [previousRequest.promptNodeId, previousRequest.promptInput] : $('aiPromptNode').value.split('|');
    if (selectedPrompt.length !== 2 || !selectedPrompt[0] || !selectedPrompt[1]) { setAiWorkflowMessage('Select the positive prompt input from your workflow.', 'bad'); return; }
    const selectedImage = previousRequest ? [previousRequest.imageNodeId || '', previousRequest.imageInput || ''] : $('aiImageNode').value.split('|');
    const sourceAssetId = previousRequest ? previousRequest.sourceAssetId : $('aiSourceImage').value;
    const sourceAsset = state.assets.find(item => item.id === sourceAssetId && item.kind === 'image');
    if (sourceAssetId && !sourceAsset) { setAiWorkflowMessage('The photo used for this generation is no longer in the current media library. Restore the matching .pea backup before retrying.', 'bad'); return; }
    if (sourceAsset && selectedImage.length !== 2) { setAiWorkflowMessage('This workflow has no image input. Import an LTX image-to-video workflow to use your photo.', 'bad'); return; }

    const requestSnapshot = previousRequest ? { ...previousRequest, workflowRaw: aiState.workflowRaw || previousRequest.workflowRaw } : {
      engineUrl: aiState.engineUrl,
      workflowRaw: aiState.workflowRaw,
      promptNodeId: selectedPrompt[0], promptInput: selectedPrompt[1],
      imageNodeId: selectedImage[0] || '', imageInput: selectedImage[1] || '',
      prompt: promptValue, sourceAssetId: sourceAsset?.id || '',
    };
    requestSnapshot.submissionKey = retry && aiState.jobId ? crypto.randomUUID() : (aiState.pendingSubmissionKey || requestSnapshot.submissionKey || crypto.randomUUID());
    aiState.pendingSubmissionKey = requestSnapshot.submissionKey;
    if (!retry) aiState.jobId = '';
    if (previousRequest && !requestSnapshot.workflowRaw) {
      setAiWorkflowMessage('Reload the saved LTX API workflow before retrying this scene.', 'bad');
      return;
    }
    aiState.lastRequest = requestSnapshot;
    aiState.polling = true;
    aiState.outputs = [];
    $('aiJobPanel').hidden = false;
    $('aiJobTitle').textContent = retry ? 'Retrying your scene' : 'Preparing your scene';
    $('aiJobState').textContent = 'Submitting';
    $('aiJobMessage').textContent = 'Sending your prompt and selected source photo to your own ComfyUI engine.';
    $('aiJobError').hidden = true;
    $('aiResultList').replaceChildren();
    $('aiProgressBar').style.width = '8%';
    $('aiGenerateButton').disabled = true;
    $('aiCancelButton').hidden = false;
    $('aiRetryButton').hidden = true;
    $('aiCancelButton').disabled = false;
    $('aiGenerateButton').textContent = 'Generating…';
    updateAiGenerateAvailability();
    try {
      const form = new FormData();
      form.append('engine_url', requestSnapshot.engineUrl);
      form.append('workflow_json', requestSnapshot.workflowRaw);
      form.append('prompt_node_id', requestSnapshot.promptNodeId);
      form.append('prompt_input', requestSnapshot.promptInput);
      form.append('image_node_id', requestSnapshot.imageNodeId);
      form.append('image_input', requestSnapshot.imageInput);
      form.append('prompt', requestSnapshot.prompt);
      form.append('source_asset_id', requestSnapshot.sourceAssetId || '');
      form.append('client_request_id', requestSnapshot.submissionKey);
      if (sourceAsset) form.append('image', sourceAsset.blob, sourceAsset.name);
      const response = await fetch('/api/ai/generate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-CSRF-Token': state.csrf }, body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'PEA could not submit the generation.');
      aiState.jobId = data.job_id;
      aiState.pendingSubmissionKey = '';
      aiState.lastRequest = { ...requestSnapshot, submissionKey: '' };
      aiState.generationStartedAt = Date.now();
      $('aiJobTitle').textContent = 'Your scene is in production';
      $('aiJobState').textContent = 'Queued';
      $('aiJobMessage').textContent = data.message || 'The AI engine has accepted your generation.';
      $('aiProgressBar').style.width = '22%';
      pollAiJob();
    } catch (error) {
      finishAiFailure(error.message || 'Generation could not be submitted.');
    }
  }

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function pollAiJob() {
    if (!aiState.jobId) return;
    const started = Date.now();
    while (aiState.polling && Date.now() - started < 90 * 60 * 1000) {
      await wait(3000);
      if (!aiState.polling) return;
      try {
        const response = await fetch(`/api/ai/jobs/${encodeURIComponent(aiState.jobId)}`, { credentials: 'same-origin', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'The generation status could not be checked.');
        if (data.status === 'checking') {
          $('aiJobState').textContent = 'Reconnecting';
          $('aiJobMessage').textContent = data.message || 'The engine is temporarily unavailable. PEA will check again.';
          continue;
        }
        if (data.status === 'queued') {
          $('aiJobState').textContent = 'Waiting';
          $('aiJobMessage').textContent = 'Your request is safely queued by ComfyUI. The GPU will start it when available.';
          $('aiProgressBar').style.width = '24%';
        } else if (data.status === 'running') {
          $('aiJobState').textContent = 'Generating';
          $('aiJobMessage').textContent = 'LTX is generating the scene on your connected AI engine. This can take several minutes depending on your GPU and the workflow.';
          $('aiProgressBar').style.width = '68%';
        } else if (data.status === 'complete') {
          aiState.outputs = data.outputs || [];
          aiState.polling = false;
          $('aiJobTitle').textContent = 'Your AI scene is ready';
          $('aiJobState').textContent = 'Complete';
          $('aiJobMessage').textContent = 'Choose Add to advert to bring the generated clip or image into your PEA media library and selected scene.';
          $('aiProgressBar').style.width = '100%';
          $('aiCancelButton').hidden = true;
          $('aiGenerateButton').textContent = 'Generate another scene';
          $('aiRetryButton').hidden = true;
          renderAiResults();
          updateAiGenerateAvailability();
          return;
        } else if (data.status === 'failed') {
          finishAiFailure(data.error || 'The AI workflow failed. Check the ComfyUI console for the node that reported the error.');
          return;
        } else if (data.status === 'cancelled') {
          aiState.polling = false;
          $('aiJobState').textContent = 'Cancelled';
          $('aiJobMessage').textContent = data.message || 'Generation cancelled.';
          $('aiCancelButton').hidden = true;
          $('aiGenerateButton').textContent = 'Generate scene';
          updateAiGenerateAvailability();
          return;
        }
      } catch (error) {
        $('aiJobState').textContent = 'Checking';
        $('aiJobMessage').textContent = `${error.message || 'Temporary connection issue.'} PEA will retry the status check; it will not submit a duplicate job.`;
      }
    }
    if (aiState.polling) finishAiFailure('PEA stopped polling after 90 minutes. The ComfyUI job may still be running; check the ComfyUI queue before submitting another copy.');
  }

  function finishAiFailure(message) {
    aiState.polling = false;
    $('aiJobTitle').textContent = 'This scene did not finish';
    $('aiJobState').textContent = 'Needs attention';
    $('aiJobMessage').textContent = 'Your original photo, prompt and PEA project are still safe.';
    $('aiJobError').textContent = message;
    $('aiJobError').hidden = false;
    $('aiProgressBar').style.width = '0%';
    $('aiCancelButton').hidden = true;
    $('aiGenerateButton').textContent = 'Generate scene';
    $('aiRetryButton').hidden = !aiState.lastRequest;
    updateAiGenerateAvailability();
  }

  function renderAiResults() {
    const list = $('aiResultList');
    list.replaceChildren();
    aiState.outputs.forEach((output, index) => {
      const row = document.createElement('div');
      row.className = 'ai-result-item';
      const label = document.createElement('span');
      label.textContent = `${output.kind === 'video' ? 'Video' : output.kind === 'image' ? 'Image' : 'Audio'} · ${output.filename}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-outline';
      button.textContent = output.kind === 'video' || output.kind === 'image' ? 'Add to advert' : 'Download';
      button.addEventListener('click', () => importAiResult(index));
      row.append(label, button);
      list.appendChild(row);
    });
  }

  async function importAiResult(index) {
    const output = aiState.outputs[index];
    if (!output) return;
    const rows = $('aiResultList').querySelectorAll('button');
    if (rows[index]) rows[index].disabled = true;
    try {
      const response = await fetch(`/api/ai/jobs/${encodeURIComponent(aiState.jobId)}/output/${index}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'PEA could not download that result from ComfyUI.');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The generated output was empty. Check the ComfyUI output folder.');
      const file = new File([blob], output.filename, { type: output.mime_type || blob.type || 'application/octet-stream' });
      if (output.kind === 'audio') downloadBlob(blob, output.filename);
      else {
        await addFiles([file], state.currentSceneId);
        $('storageStatus').textContent = `AI result added to your media library: ${output.filename}`;
        closeAiModal();
      }
    } catch (error) {
      $('aiJobError').hidden = false;
      $('aiJobError').textContent = error.message || 'The result could not be imported.';
    } finally { if (rows[index]) rows[index].disabled = false; }
  }

  async function cancelAiGeneration() {
    if (!aiState.jobId) return;
    $('aiCancelButton').disabled = true;
    try {
      const response = await fetch(`/api/ai/jobs/${encodeURIComponent(aiState.jobId)}/cancel`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-CSRF-Token': state.csrf },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'The AI job could not be cancelled.');
      aiState.polling = false;
      $('aiJobState').textContent = 'Cancelled';
      $('aiJobMessage').textContent = 'Generation cancelled. Your uploaded files and existing campaign remain safe.';
      $('aiCancelButton').hidden = true;
      $('aiGenerateButton').textContent = 'Generate scene';
      updateAiGenerateAvailability();
    } catch (error) {
      $('aiJobError').hidden = false;
      $('aiJobError').textContent = error.message || 'Could not cancel generation.';
    } finally { $('aiCancelButton').disabled = false; }
  }

  async function logout() {
    if (!confirm('Lock PEA Studio on this device? Your locally saved projects and media will remain here.')) return;
    try {
      if (state.onlineSession && state.csrf) {
        await fetch('/logout', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf }, credentials: 'same-origin' });
      }
    } catch (_) { /* The local lock still happens if the network is gone. */ }
    localStorage.removeItem('pea-offline-auth-v1');
    window.location.replace('/login');
  }

  async function handleOnline() {
    if (await apiSession()) {
      state.offlineMode = false; setConnection(true);
    } else {
      state.offlineMode = true; setConnection(false);
    }
  }

  init();
})();
