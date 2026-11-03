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
      textColor: '#ffffff', signature: true
    };
  }

  function newProject(title) {
    return { id: id(), title: title || 'Untitled campaign', format: '9:16', scenes: [defaultScene(0)], audioId: '', volume: 70, createdAt: Date.now(), updatedAt: Date.now() };
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
    $('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('dragover'));
    $('dropZone').addEventListener('drop', event => { event.preventDefault(); $('dropZone').classList.remove('dragover'); addFiles(event.dataTransfer.files); });
    $('projectTitle').addEventListener('input', () => { state.project.title = $('projectTitle').value.slice(0, 70); scheduleSave(); renderProjectOptions(); });
    $('newProjectBtn').onclick = createProject;
    $('projectSelect').addEventListener('change', () => switchProject($('projectSelect').value));
    $('formatSelect').addEventListener('change', () => { state.project.format = $('formatSelect').value; configureCanvas(); scheduleSave(); renderPreview(); });
    $('addSceneButton').onclick = addScene;
    $('applyTemplateButton').onclick = applyStoryTemplate;
    $('deleteSceneButton').onclick = deleteScene;
    $('moveSceneUp').onclick = () => moveScene(-1);
    $('moveSceneDown').onclick = () => moveScene(1);
    $('playButton').onclick = togglePlay;
    $('stopButton').onclick = stopPlayback;
    $('timelineScrubber').addEventListener('input', event => { state.playhead = Number(event.target.value); stopPlayback(false); renderPreview(); updateTimeUI(); });
    $('durationInput').addEventListener('input', () => { currentScene().duration = Number($('durationInput').value); $('durationValue').textContent = `${currentScene().duration} sec`; updateTimelineRange(); renderSceneList(); scheduleSave(); renderPreview(); });
    bindText('headlineInput', 'headline'); bindText('bodyInput', 'body'); bindText('ctaInput', 'cta');
    bindSelect('lookSelect', 'look', value => { const look = PeaEngine.LOOKS[value]; if (look) { currentScene().overlay = Math.round(look.overlay * 100); currentScene().filter = look.filter; currentScene().font = look.font; $('overlayInput').value = currentScene().overlay; $('overlayValue').textContent = `${currentScene().overlay}%`; $('fontSelect').value = currentScene().font; $('filterSelect').value = currentScene().filter; } });
    bindSelect('motionSelect', 'motion'); bindSelect('transitionSelect', 'transition'); bindSelect('positionSelect', 'position'); bindSelect('filterSelect', 'filter'); bindSelect('fontSelect', 'font'); bindSelect('fitSelect', 'fit');
    $('overlayInput').addEventListener('input', () => { currentScene().overlay = Number($('overlayInput').value); $('overlayValue').textContent = `${currentScene().overlay}%`; scheduleSave(); renderPreview(); });
    $('textColorInput').addEventListener('input', () => { currentScene().textColor = $('textColorInput').value; scheduleSave(); renderPreview(); });
    $('signatureToggle').addEventListener('change', () => { currentScene().signature = $('signatureToggle').checked; scheduleSave(); renderPreview(); });
    $('logoSelect').addEventListener('change', () => { currentScene().logoId = $('logoSelect').value || ''; scheduleSave(); renderPreview(); });
    $('logoPositionSelect').addEventListener('change', () => { currentScene().logoPosition = $('logoPositionSelect').value; scheduleSave(); renderPreview(); });
    $('audioSelect').addEventListener('change', () => { state.project.audioId = $('audioSelect').value; setupAudio(); scheduleSave(); });
    $('volumeInput').addEventListener('input', () => { state.project.volume = Number($('volumeInput').value); $('volumeValue').textContent = `${state.project.volume}%`; if (state.audioPreview) state.audioPreview.volume = state.project.volume / 100; scheduleSave(); });
    $('backupBtn').onclick = backupProject;
    $('backupInput').addEventListener('change', event => { importProject(event.target.files[0]); event.target.value = ''; });
    $('exportBtn').onclick = openExportModal;
    $('closeExport').onclick = closeExportModal;
    $('cancelExport').onclick = closeExportModal;
    $('startExport').onclick = exportProject;
    $('logoutBtn').onclick = logout;
    window.addEventListener('beforeunload', () => { if (state.playing) stopPlayback(); });
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
      image.onerror = () => { resource.failed = true; };
      image.src = url;
    } else if (asset.kind === 'video') {
      const video = document.createElement('video');
      video.src = url; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
      resource = { element: video, ready: false, kind: 'video' };
      video.addEventListener('loadeddata', () => { resource.ready = true; renderPreview(); }, { once: true });
      video.addEventListener('error', () => { resource.failed = true; }, { once: true });
    } else resource = { element: null, ready: true, kind: 'audio' };
    state.resources.set(asset.id, resource);
    return resource;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let added = 0;
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
        createResource(asset);
        added += 1;
      } catch (error) {
        alert(`Could not save ${file.name}. Your browser may be running low on storage. Export a project backup or remove unused media and try again.\n\n${error.message || ''}`);
        break;
      }
    }
    renderAssetList(); setupAudioOptions();
    if (added) {
      $('storageStatus').textContent = `${added} file${added === 1 ? '' : 's'} added to this device.`;
      const visual = state.assets.filter(item => item.kind !== 'audio').at(-1);
      if (visual) assignMedia(visual.id);
    }
    await updateStorageEstimate();
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
      $('assetList').innerHTML = `<div class="empty-state"><span>✳</span><b>${state.assets.length ? 'Nothing in this filter' : 'Your library starts here'}</b><small>${state.assets.length ? 'Choose another media filter.' : 'Add product images, phone clips, logos and music.'}</small></div>`;
      return;
    }
    $('assetList').innerHTML = assets.map(asset => {
      const resource = state.resources.get(asset.id);
      const url = state.urls.get(asset.id);
      const thumb = asset.kind === 'image' ? `<img src="${url}" alt="">` : asset.kind === 'video' ? (resource?.ready ? `<video src="${url}" muted playsinline></video>` : '<span class="asset-glyph">▶</span>') : '<span class="asset-glyph">♫</span>';
      return `<article class="asset-card" data-asset-id="${asset.id}" title="${escapeHtml(asset.name)}"><div class="asset-thumb">${thumb}</div><div class="asset-name">${escapeHtml(asset.name)}</div><div class="asset-kind">${asset.kind} · ${formatBytes(asset.size)}</div><button class="asset-remove" type="button" data-remove-asset="${asset.id}" aria-label="Remove ${escapeHtml(asset.name)}">×</button></article>`;
    }).join('');
    $('assetList').querySelectorAll('.asset-card').forEach(card => card.addEventListener('click', event => {
      if (event.target.closest('[data-remove-asset]')) return;
      const asset = state.assets.find(item => item.id === card.dataset.assetId);
      if (asset?.kind === 'audio') { state.project.audioId = asset.id; $('audioSelect').value = asset.id; setupAudio(); scheduleSave(); }
      else assignMedia(asset.id);
    }));
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
    renderInspector(); renderSceneList(); renderPreview(); scheduleSave();
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
    renderProject(); renderSceneList(); renderInspector(); setupAudio(); renderPreview();
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
    renderProject(); renderSceneList(); renderInspector(); setupAudio(); renderPreview();
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
    $('headlineInput').value = scene.headline || ''; $('bodyInput').value = scene.body || ''; $('ctaInput').value = scene.cta || '';
    $('lookSelect').value = scene.look || 'luxe'; $('motionSelect').value = scene.motion || 'rise'; $('transitionSelect').value = scene.transition || 'fade';
    $('positionSelect').value = scene.position || 'lower'; $('filterSelect').value = scene.filter || 'cinematic'; $('fontSelect').value = scene.font || 'serif'; $('fitSelect').value = scene.fit || 'cover';
    $('overlayInput').value = scene.overlay ?? 38; $('overlayValue').textContent = `${scene.overlay ?? 38}%`;
    $('textColorInput').value = scene.textColor || '#ffffff'; $('signatureToggle').checked = scene.signature !== false;
    setupLogoOptions(); $('logoSelect').value = scene.logoId || ''; $('logoPositionSelect').value = scene.logoPosition || 'top-left';
    $('deleteSceneButton').disabled = state.project.scenes.length <= 1;
    const index = state.project.scenes.findIndex(item => item.id === scene.id);
    $('moveSceneUp').disabled = index <= 0; $('moveSceneDown').disabled = index >= state.project.scenes.length - 1;
  }

  function renderSceneList() {
    $('sceneList').innerHTML = state.project.scenes.map((scene, index) => {
      const media = state.assets.find(item => item.id === scene.mediaId);
      return `<button class="scene-card ${scene.id === state.currentSceneId ? 'active' : ''}" type="button" data-scene-id="${scene.id}"><span class="scene-number">${String(index + 1).padStart(2, '0')}</span><span style="min-width:0"><span class="scene-name" title="${escapeHtml(media?.name || scene.headline || 'Untitled scene')}">${escapeHtml((scene.headline || media?.name || 'Untitled scene').slice(0, 22))}</span><span class="scene-duration">${Number(scene.duration || 5).toFixed(1)} sec</span></span></button>`;
    }).join('');
    $('sceneList').querySelectorAll('[data-scene-id]').forEach(button => button.addEventListener('click', () => selectScene(button.dataset.sceneId)));
    const index = state.project.scenes.findIndex(scene => scene.id === state.currentSceneId);
    $('sceneCounter').textContent = `SCENE ${String(index + 1).padStart(2, '0')} / ${String(state.project.scenes.length).padStart(2, '0')}`;
  }

  function selectScene(sceneId) {
    const start = state.project.scenes.slice(0, state.project.scenes.findIndex(scene => scene.id === sceneId)).reduce((sum, scene) => sum + Number(scene.duration || 5), 0);
    state.currentSceneId = sceneId;
    stopPlayback(false); state.playhead = start;
    renderInspector(); renderSceneList(); updateTimeUI(); renderPreview();
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
      return scene;
    });
    state.currentSceneId = state.project.scenes[0].id; state.playhead = 0; stopPlayback(false);
    renderInspector(); renderSceneList(); updateTimelineRange(); renderPreview(); scheduleSave();
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
    const drawn = PeaEngine.drawScene(ctx, scene, resource, located.local, width, height, { format: state.project.format, logoMedia: logoResource });
    if (!drawn && $('previewHint')) $('previewHint').classList.add('visible');
    else if ($('previewHint')) $('previewHint').classList.remove('visible');
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
