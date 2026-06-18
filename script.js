(() => {
  'use strict';

  // ============================================================
  // DOM
  // ============================================================
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });

  const fileInput = document.getElementById('fileInput');
  const speedRange = document.getElementById('speedRange');
  const brushRange = document.getElementById('brushRange');

  const speedValue = document.getElementById('speedValue');
  const brushValue = document.getElementById('brushValue');

  const btnDraw = document.getElementById('btnDraw');
  const btnErase = document.getElementById('btnErase');
  const btnToggleSim = document.getElementById('btnToggleSim');
  const btnClear = document.getElementById('btnClear');

  const controls = document.querySelector('.controls');

  // ============================================================
  // Размеры
  // ============================================================
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  const CSS_W = 1200;
  const CSS_H = 720;

  const W = Math.floor(CSS_W * DPR);
  const H = Math.floor(CSS_H * DPR);

  canvas.width = W;
  canvas.height = H;

  // ============================================================
  // Конфиг
  // ============================================================
  const fieldCellSize = Math.max(30 * DPR, 24);
  const gridW = Math.ceil(W / fieldCellSize);
  const gridH = Math.ceil(H / fieldCellSize);
  const cellCount = gridW * gridH;

  const MAX_PARTICLES = 2600;
  const DEFAULT_WIND_ANGLE = 0;

  // ============================================================
  // Лейеры
  // brushCanvas  - ручные рисунки/ластик
  // imageCanvas  - уже размещённые картинки
  // maskCanvas   - общий финальный слой для показа и коллизий
  // ============================================================
  const brushCanvas = document.createElement('canvas');
  const brushCtx = brushCanvas.getContext('2d', { willReadFrequently: true });
  brushCanvas.width = W;
  brushCanvas.height = H;

  const imageCanvas = document.createElement('canvas');
  const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
  imageCanvas.width = W;
  imageCanvas.height = H;

  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  maskCanvas.width = W;
  maskCanvas.height = H;

  let maskData = new Uint8ClampedArray(W * H * 4);
  let maskDirty = true;

  // ============================================================
  // Низкочастотная карта препятствий
  // ============================================================
  const occ = new Float32Array(cellCount);
  const occTmp = new Float32Array(cellCount);

  // ============================================================
  // Поле ветра
  // ============================================================
  const fieldVX = new Float32Array(cellCount);
  const fieldVY = new Float32Array(cellCount);

  // ============================================================
  // Следы потока
  // ============================================================
  const trailCanvas = document.createElement('canvas');
  const trailCtx = trailCanvas.getContext('2d');
  trailCanvas.width = W;
  trailCanvas.height = H;

  // ============================================================
  // UI state
  // ============================================================
  let flowSpeed = 1;
  let brush = 14 * DPR;
  let tool = 'draw';
  let running = true;

  let windAngleDeg = DEFAULT_WIND_ANGLE;
  let vortexStrength = 1.4;
  let gustStrength = 0.85;
  let wakeStrength = 1.15;
  let trailFade = 0.10;

  let windUx = 1;
  let windUy = 0;

  speedValue.textContent = flowSpeed.toFixed(2);
  brushValue.textContent = String(Math.round(brush / DPR));

  // ============================================================
  // Редактор картинок
  // ============================================================
  const placedImages = [];
  let editorObject = null;
  let editorCropMode = false;
  let draggingEditor = false;
  let draggingObject = false;
  let cropDragStart = null;
  let dragStart = null;
  let selectedIndex = -1;

  const keysDown = new Set();

  // ============================================================
  // Вспомогательные функции
  // ============================================================
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function clampInt(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function normalizeDeg(v) {
    let x = v % 360;
    if (x < 0) x += 360;
    return x;
  }

  function setWindVectorFromAngle() {
    const a = windAngleDeg * Math.PI / 180;
    windUx = Math.cos(a);
    windUy = Math.sin(a);
  }

  function setActiveTool(name) {
    tool = name;
    btnDraw.classList.toggle('is-active', tool === 'draw');
    btnErase.classList.toggle('is-active', tool === 'erase');
    canvas.style.cursor = tool === 'erase' ? 'not-allowed' : 'crosshair';
  }

  function setSpeed(v) {
    flowSpeed = clamp(+v, 0.2, 4);
    speedRange.value = String(flowSpeed);
    speedValue.textContent = flowSpeed.toFixed(2);
  }

  function setBrush(v) {
    brush = clamp(+v, 2, 60) * DPR;
    brushRange.value = String(Math.round(brush / DPR));
    brushValue.textContent = String(Math.round(brush / DPR));
  }

  function setWindAngle(v) {
    windAngleDeg = normalizeDeg(+v);
    if (angleRange) angleRange.value = String(Math.round(windAngleDeg));
    if (angleValue) angleValue.textContent = `${Math.round(windAngleDeg)}°`;
    setWindVectorFromAngle();
  }

  function setVortexStrength(v) {
    vortexStrength = clamp(+v, 0, 3);
    if (vortexRange) vortexRange.value = String(vortexStrength);
    if (vortexValue) vortexValue.textContent = vortexStrength.toFixed(2);
  }

  function setGustStrength(v) {
    gustStrength = clamp(+v, 0, 2.5);
    if (gustRange) gustRange.value = String(gustStrength);
    if (gustValue) gustValue.textContent = gustStrength.toFixed(2);
  }

  function setWakeStrength(v) {
    wakeStrength = clamp(+v, 0, 3);
    if (wakeRange) wakeRange.value = String(wakeStrength);
    if (wakeValue) wakeValue.textContent = wakeStrength.toFixed(2);
  }

  function setTrailFade(v) {
    trailFade = clamp(+v, 0.03, 0.24);
    if (trailRange) trailRange.value = String(trailFade);
    if (trailValue) trailValue.textContent = trailFade.toFixed(2);
  }

  function clearTrails() {
    trailCtx.save();
    trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    trailCtx.clearRect(0, 0, W, H);
    trailCtx.restore();
  }

  function markMaskDirty() {
    maskDirty = true;
  }

  // ============================================================
  // Динамические контролы
  // ============================================================
  let angleRange = null;
  let angleValue = null;
  let vortexRange = null;
  let vortexValue = null;
  let gustRange = null;
  let gustValue = null;
  let wakeRange = null;
  let wakeValue = null;
  let trailRange = null;
  let trailValue = null;

  function createSliderBlock({
    title,
    valueText,
    inputId,
    min,
    max,
    step,
    value,
    hint
  }) {
    const block = document.createElement('div');
    block.className = 'slider-block';
    block.innerHTML = `
      <div class="slider-head">
        <label class="slider-label" for="${inputId}">${title}</label>
        <div class="slider-value" id="${inputId}Value">${valueText}</div>
      </div>
      <input id="${inputId}" class="slider" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
      <div class="slider-meta">${hint}</div>
    `;
    return block;
  }

  function createPresetGrid() {
    const wrap = document.createElement('div');
    wrap.className = 'tool-grid';

    const btnLaminar = document.createElement('button');
    btnLaminar.className = 'tool-btn';
    btnLaminar.type = 'button';
    btnLaminar.textContent = 'Ламинар';

    const btnStorm = document.createElement('button');
    btnStorm.className = 'tool-btn';
    btnStorm.type = 'button';
    btnStorm.textContent = 'Шторм';

    const btnReverse = document.createElement('button');
    btnReverse.className = 'tool-btn';
    btnReverse.type = 'button';
    btnReverse.textContent = 'Развернуть';

    const btnRandom = document.createElement('button');
    btnRandom.className = 'tool-btn';
    btnRandom.type = 'button';
    btnRandom.textContent = 'Случайный';

    wrap.appendChild(btnLaminar);
    wrap.appendChild(btnStorm);
    wrap.appendChild(btnReverse);
    wrap.appendChild(btnRandom);

    return { wrap, btnLaminar, btnStorm, btnReverse, btnRandom };
  }

  function createImageTools() {
    const wrap = document.createElement('div');
    wrap.className = 'tool-grid';

    const btnCommit = document.createElement('button');
    btnCommit.className = 'tool-btn tool-btn--primary';
    btnCommit.type = 'button';
    btnCommit.textContent = 'Разместить';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'tool-btn tool-btn--danger';
    btnCancel.type = 'button';
    btnCancel.textContent = 'Отмена';

    const btnCrop = document.createElement('button');
    btnCrop.className = 'tool-btn';
    btnCrop.type = 'button';
    btnCrop.textContent = 'Обрезка';

    const btnBg = document.createElement('button');
    btnBg.className = 'tool-btn';
    btnBg.type = 'button';
    btnBg.textContent = 'Фон: авто';

    wrap.appendChild(btnCommit);
    wrap.appendChild(btnCancel);
    wrap.appendChild(btnCrop);
    wrap.appendChild(btnBg);

    return { wrap, btnCommit, btnCancel, btnCrop, btnBg };
  }

  let angleBlock = null;
  let vortexBlock = null;
  let gustBlock = null;
  let wakeBlock = null;
  let trailBlock = null;
  let imageTools = null;

  if (controls) {
    const fragment = document.createDocumentFragment();

    angleBlock = createSliderBlock({
      title: 'Угол ветра',
      valueText: `${Math.round(windAngleDeg)}°`,
      inputId: 'windAngleRange',
      min: 0,
      max: 360,
      step: 1,
      value: windAngleDeg,
      hint: '0° — слева направо. Угол меняет направление потока.'
    });

    vortexBlock = createSliderBlock({
      title: 'Сила вихрей',
      valueText: vortexStrength.toFixed(2),
      inputId: 'vortexRange',
      min: 0,
      max: 3,
      step: 0.01,
      value: vortexStrength,
      hint: 'Усиливает закрутку за объектами и на кромках.'
    });

    gustBlock = createSliderBlock({
      title: 'Порывы',
      valueText: gustStrength.toFixed(2),
      inputId: 'gustRange',
      min: 0,
      max: 2.5,
      step: 0.01,
      value: gustStrength,
      hint: 'Мягкие широкие колебания без хаоса.'
    });

    wakeBlock = createSliderBlock({
      title: 'След за объектом',
      valueText: wakeStrength.toFixed(2),
      inputId: 'wakeRange',
      min: 0,
      max: 3,
      step: 0.01,
      value: wakeStrength,
      hint: 'Усиливает рваный шлейф за препятствием.'
    });

    trailBlock = createSliderBlock({
      title: 'Шлейф',
      valueText: trailFade.toFixed(2),
      inputId: 'trailRange',
      min: 0.03,
      max: 0.24,
      step: 0.01,
      value: trailFade,
      hint: 'Меньше — длиннее следы. Больше — чище картинка.'
    });

    const presetGrid = createPresetGrid();
    imageTools = createImageTools();

    fragment.appendChild(angleBlock);
    fragment.appendChild(vortexBlock);
    fragment.appendChild(gustBlock);
    fragment.appendChild(wakeBlock);
    fragment.appendChild(trailBlock);
    fragment.appendChild(imageTools.wrap);
    fragment.appendChild(presetGrid.wrap);

    const tips = controls.querySelector('.tips');
    if (tips) controls.insertBefore(fragment, tips);
    else controls.appendChild(fragment);

    angleRange = angleBlock.querySelector('input');
    angleValue = angleBlock.querySelector('.slider-value');

    vortexRange = vortexBlock.querySelector('input');
    vortexValue = vortexBlock.querySelector('.slider-value');

    gustRange = gustBlock.querySelector('input');
    gustValue = gustBlock.querySelector('.slider-value');

    wakeRange = wakeBlock.querySelector('input');
    wakeValue = wakeBlock.querySelector('.slider-value');

    trailRange = trailBlock.querySelector('input');
    trailValue = trailBlock.querySelector('.slider-value');

    angleRange.addEventListener('input', (e) => setWindAngle(+e.target.value));
    vortexRange.addEventListener('input', (e) => setVortexStrength(+e.target.value));
    gustRange.addEventListener('input', (e) => setGustStrength(+e.target.value));
    wakeRange.addEventListener('input', (e) => setWakeStrength(+e.target.value));
    trailRange.addEventListener('input', (e) => setTrailFade(+e.target.value));

    presetGrid.btnLaminar.addEventListener('click', () => {
      setSpeed(0.9);
      setWindAngle(0);
      setVortexStrength(0.35);
      setGustStrength(0.18);
      setWakeStrength(0.35);
      setTrailFade(0.16);
    });

    presetGrid.btnStorm.addEventListener('click', () => {
      setSpeed(1.35);
      setVortexStrength(2.1);
      setGustStrength(1.35);
      setWakeStrength(1.85);
      setTrailFade(0.07);
    });

    presetGrid.btnReverse.addEventListener('click', () => {
      setWindAngle(windAngleDeg + 180);
    });

    presetGrid.btnRandom.addEventListener('click', () => {
      setWindAngle(Math.random() * 360);
    });

    imageTools.btnCommit.addEventListener('click', () => commitEditorObject());
    imageTools.btnCancel.addEventListener('click', () => cancelEditorObject());
    imageTools.btnCrop.addEventListener('click', () => toggleCropMode());
    imageTools.btnBg.addEventListener('click', () => {
      if (!editorObject) return;
      editorObject.bgMode = editorObject.bgMode === 'auto' ? 'white' : editorObject.bgMode === 'white' ? 'green' : 'auto';
      imageTools.btnBg.textContent = `Фон: ${editorObject.bgMode}`;
    });

    updateImageToolsVisibility();
  }

  // ============================================================
  // Основные кнопки
  // ============================================================
  btnDraw.addEventListener('click', () => setActiveTool('draw'));
  btnErase.addEventListener('click', () => setActiveTool('erase'));

  btnToggleSim.addEventListener('click', () => {
    running = !running;
    btnToggleSim.textContent = running ? 'Пауза' : 'Старт';
  });

  btnClear.addEventListener('click', () => {
    clearAllObstacles();
  });

  speedRange.addEventListener('input', (e) => setSpeed(+e.target.value));
  brushRange.addEventListener('input', (e) => setBrush(+e.target.value));

  // ============================================================
  // Ручное рисование
  // ============================================================
  let drawing = false;
  let lastPaintPos = null;

  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    return { x, y };
  }

  function drawDotToBrushLayer(x, y) {
    brushCtx.save();
    brushCtx.globalCompositeOperation = tool === 'draw' ? 'source-over' : 'destination-out';
    brushCtx.fillStyle = '#ffffff';
    brushCtx.beginPath();
    brushCtx.arc(x, y, brush, 0, Math.PI * 2);
    brushCtx.fill();
    brushCtx.restore();
    markMaskDirty();
  }

  function paintSegment(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(brush * 0.32, 1);
    const count = Math.max(1, Math.ceil(dist / step));

    for (let i = 0; i <= count; i++) {
      const t = i / count;
      drawDotToBrushLayer(x0 + dx * t, y0 + dy * t);
    }
  }

  function paintAt(e) {
    const { x, y } = getPointerPos(e);

    if (!lastPaintPos) {
      drawDotToBrushLayer(x, y);
    } else {
      paintSegment(lastPaintPos.x, lastPaintPos.y, x, y);
    }

    lastPaintPos = { x, y };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const pos = getPointerPos(e);

    if (editorObject) {
      // Если открыт редактор картинки, мышь управляет им
      handleEditorPointerDown(e, pos.x, pos.y);
      return;
    }

    const hit = hitTestCommittedImages(pos.x, pos.y);
    if (hit >= 0) {
      selectedIndex = hit;
      draggingObject = true;
      dragStart = {
        x: pos.x,
        y: pos.y,
        objX: placedImages[selectedIndex].x,
        objY: placedImages[selectedIndex].y
      };
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    if (tool === 'draw' || tool === 'erase') {
      drawing = true;
      canvas.setPointerCapture?.(e.pointerId);
      lastPaintPos = null;
      paintAt(e);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const pos = getPointerPos(e);

    if (editorObject) {
      handleEditorPointerMove(e, pos.x, pos.y);
      return;
    }

    if (draggingObject && selectedIndex >= 0 && dragStart) {
      const obj = placedImages[selectedIndex];
      obj.x = dragStart.objX + (pos.x - dragStart.x);
      obj.y = dragStart.objY + (pos.y - dragStart.y);
      markMaskDirty();
      return;
    }

    if (!drawing) return;
    paintAt(e);
  });

  window.addEventListener('pointerup', () => {
    drawing = false;
    lastPaintPos = null;
    draggingObject = false;
    dragStart = null;
    finishEditorPointer();
  });

  canvas.addEventListener('pointerleave', () => {
    drawing = false;
    lastPaintPos = null;
    draggingObject = false;
    dragStart = null;
    finishEditorPointer();
  });

  canvas.addEventListener('wheel', (e) => {
    if (editorObject || selectedIndex >= 0) {
      e.preventDefault();
      const target = editorObject || placedImages[selectedIndex];
      const factor = e.deltaY < 0 ? 1.05 : 0.95;
      target.scale = clamp(target.scale * factor, 0.1, 12);
      markMaskDirty();
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    keysDown.add(e.key.toLowerCase());

    if (e.key === 'Escape') {
      if (editorObject) {
        cancelEditorObject();
      } else {
        selectedIndex = -1;
      }
    }

    if (e.key === 'Enter') {
      if (editorObject) {
        commitEditorObject();
      }
    }

    if (e.key.toLowerCase() === 'q') {
      const target = editorObject || (selectedIndex >= 0 ? placedImages[selectedIndex] : null);
      if (target) {
        target.rotation -= 0.08;
        markMaskDirty();
      }
    }

    if (e.key.toLowerCase() === 'e') {
      const target = editorObject || (selectedIndex >= 0 ? placedImages[selectedIndex] : null);
      if (target) {
        target.rotation += 0.08;
        markMaskDirty();
      }
    }

    if (e.key.toLowerCase() === 'c') {
      if (editorObject) toggleCropMode();
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIndex >= 0) {
        placedImages.splice(selectedIndex, 1);
        selectedIndex = -1;
        rebuildFinalMask();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.key.toLowerCase());
  });

  function clearAllObstacles() {
    brushCtx.clearRect(0, 0, W, H);
    imageCtx.clearRect(0, 0, W, H);
    placedImages.length = 0;
    selectedIndex = -1;
    editorObject = null;
    editorCropMode = false;
    updateImageToolsVisibility();
    rebuildFinalMask();
    clearTrails();
  }

  // ============================================================
  // Загрузка и подготовка картинки
  // ============================================================
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const img = await fileToImage(file);
    editorObject = await createEditorObject(img);
    editorCropMode = false;
    selectedIndex = -1;
    updateImageToolsVisibility();
    fileInput.value = '';
  });

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось загрузить изображение'));
      };

      img.src = url;
    });
  }

  function getBackgroundSample(imageData) {
    const { data, width, height } = imageData;
    const pts = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ];

    let r = 0, g = 0, b = 0, n = 0;
    for (const [x, y] of pts) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 10) continue;
      r += data[i + 0];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }

    if (n === 0) return { r: 255, g: 255, b: 255 };
    return { r: r / n, g: g / n, b: b / n };
  }

  function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr + dg * dg + db * db;
  }

  function removeBackgroundFromImageSource(srcCanvas, bgMode = 'auto') {
    const temp = document.createElement('canvas');
    temp.width = srcCanvas.width;
    temp.height = srcCanvas.height;
    const tctx = temp.getContext('2d', { willReadFrequently: true });
    tctx.clearRect(0, 0, temp.width, temp.height);
    tctx.drawImage(srcCanvas, 0, 0);

    const img = tctx.getImageData(0, 0, temp.width, temp.height);
    const data = img.data;
    const bg = getBackgroundSample(img);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i + 0];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 10) continue;

      const nearWhite = r > 235 && g > 235 && b > 235;
      const nearGreen = g > 95 && g > r + 20 && g > b + 20;
      const nearBg = colorDistSq(r, g, b, bg.r, bg.g, bg.b) < 38 * 38;

      let remove = false;

      if (bgMode === 'white') remove = nearWhite || nearBg;
      else if (bgMode === 'green') remove = nearGreen || nearBg;
      else remove = nearWhite || nearGreen || nearBg;

      if (remove) {
        data[i + 3] = 0;
      }
    }

    tctx.putImageData(img, 0, 0);
    return temp;
  }

  async function createEditorObject(img) {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = img.width;
    sourceCanvas.height = img.height;
    const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true });

    sctx.clearRect(0, 0, img.width, img.height);
    sctx.drawImage(img, 0, 0);

    const processed = removeBackgroundFromImageSource(sourceCanvas, 'auto');

    const scale = Math.min(W / processed.width, H / processed.height) * 0.55;
    return {
      sourceCanvas: processed,
      x: W * 0.5,
      y: H * 0.5,
      scale,
      rotation: 0,
      crop: {
        x: 0,
        y: 0,
        w: processed.width,
        h: processed.height
      },
      bgMode: 'auto',
      committed: false
    };
  }

  // ============================================================
  // Image object render / hit-test
  // ============================================================
  function drawImageObject(ctx2, obj, alpha = 1) {
    ctx2.save();
    ctx2.translate(obj.x, obj.y);
    ctx2.rotate(obj.rotation);
    ctx2.scale(obj.scale, obj.scale);
    ctx2.globalAlpha = alpha;

    const c = obj.crop;
    ctx2.drawImage(
      obj.sourceCanvas,
      c.x, c.y, c.w, c.h,
      -c.w / 2, -c.h / 2, c.w, c.h
    );

    ctx2.restore();
  }

  function localFromWorld(obj, x, y) {
    const dx = (x - obj.x) / obj.scale;
    const dy = (y - obj.y) / obj.scale;
    const c = Math.cos(-obj.rotation);
    const s = Math.sin(-obj.rotation);

    return {
      x: dx * c - dy * s,
      y: dx * s + dy * c
    };
  }

  function worldFromLocal(obj, lx, ly) {
    const c = Math.cos(obj.rotation);
    const s = Math.sin(obj.rotation);

    return {
      x: obj.x + (lx * c - ly * s) * obj.scale,
      y: obj.y + (lx * s + ly * c) * obj.scale
    };
  }

  function hitTestImageObject(obj, x, y) {
    const p = localFromWorld(obj, x, y);
    const cw = obj.crop.w;
    const ch = obj.crop.h;

    if (p.x < -cw / 2 || p.x > cw / 2 || p.y < -ch / 2 || p.y > ch / 2) return false;

    const sx = Math.floor(obj.crop.x + p.x + cw / 2);
    const sy = Math.floor(obj.crop.y + p.y + ch / 2);

    if (sx < 0 || sy < 0 || sx >= obj.sourceCanvas.width || sy >= obj.sourceCanvas.height) return false;

    const c = document.createElement('canvas');
    c.width = obj.sourceCanvas.width;
    c.height = obj.sourceCanvas.height;
    const cctx = c.getContext('2d');
    cctx.drawImage(obj.sourceCanvas, 0, 0);
    const pixel = cctx.getImageData(sx, sy, 1, 1).data;
    return pixel[3] > 20;
  }

  function hitTestCommittedImages(x, y) {
    for (let i = placedImages.length - 1; i >= 0; i--) {
      if (hitTestImageObject(placedImages[i], x, y)) return i;
    }
    return -1;
  }

  // ============================================================
  // Редактор картинки: перемещение / масштаб / поворот / обрезка
  // ============================================================
  function updateImageToolsVisibility() {
    if (!imageTools) return;
    const show = !!editorObject;
    imageTools.wrap.style.display = show ? 'grid' : 'none';

    if (show) {
      imageTools.btnBg.textContent = `Фон: ${editorObject.bgMode}`;
    }
  }

  function toggleCropMode() {
    if (!editorObject) return;
    editorCropMode = !editorCropMode;
    if (imageTools) imageTools.btnCrop.classList.toggle('is-active', editorCropMode);
  }

  function commitEditorObject() {
    if (!editorObject) return;
    editorObject.committed = true;
    placedImages.push(editorObject);
    selectedIndex = placedImages.length - 1;
    editorObject = null;
    editorCropMode = false;
    updateImageToolsVisibility();
    rebuildFinalMask();
  }

  function cancelEditorObject() {
    editorObject = null;
    editorCropMode = false;
    updateImageToolsVisibility();
  }

  function finishEditorPointer() {
    draggingEditor = false;
    cropDragStart = null;
  }

  function handleEditorPointerDown(e, x, y) {
    if (!editorObject) return;

    if (editorCropMode) {
      cropDragStart = localFromWorld(editorObject, x, y);
      draggingEditor = true;
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    draggingEditor = true;
    dragStart = {
      x,
      y,
      objX: editorObject.x,
      objY: editorObject.y
    };
    canvas.setPointerCapture?.(e.pointerId);
  }

  function handleEditorPointerMove(e, x, y) {
    if (!editorObject) return;

    if (editorCropMode && draggingEditor && cropDragStart) {
      const end = localFromWorld(editorObject, x, y);

      const fullW = editorObject.sourceCanvas.width;
      const fullH = editorObject.sourceCanvas.height;

      const ax = cropDragStart.x + fullW / 2;
      const ay = cropDragStart.y + fullH / 2;
      const bx = end.x + fullW / 2;
      const by = end.y + fullH / 2;

      let x0 = clamp(Math.min(ax, bx), 0, fullW - 1);
      let y0 = clamp(Math.min(ay, by), 0, fullH - 1);
      let x1 = clamp(Math.max(ax, bx), 1, fullW);
      let y1 = clamp(Math.max(ay, by), 1, fullH);

      editorObject.crop = {
        x: x0,
        y: y0,
        w: Math.max(1, x1 - x0),
        h: Math.max(1, y1 - y0)
      };

      markMaskDirty();
      return;
    }

    if (draggingEditor && dragStart) {
      editorObject.x = dragStart.objX + (x - dragStart.x);
      editorObject.y = dragStart.objY + (y - dragStart.y);
      markMaskDirty();
    }
  }

  // ============================================================
  // Обновление финальной маски
  // ============================================================
  function rebuildFinalMask() {
    maskCtx.clearRect(0, 0, W, H);
    maskCtx.drawImage(imageCanvas, 0, 0);
    maskCtx.drawImage(brushCanvas, 0, 0);
    maskData = maskCtx.getImageData(0, 0, W, H).data;
    maskDirty = false;
  }

  function refreshMask() {
    if (maskDirty) rebuildFinalMask();
  }

  function alphaAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const i = ((y | 0) * W + (x | 0)) * 4;
    return maskData[i + 3];
  }

  function solidAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const ix = x | 0;
    const iy = y | 0;
    const i = (iy * W + ix) * 4;
    return maskData[i + 3] > 16;
  }

  function edgeNormalAt(x, y) {
    const x0 = Math.max(0, Math.min(W - 1, x | 0));
    const y0 = Math.max(0, Math.min(H - 1, y | 0));

    const left = alphaAt(x0 - 1, y0);
    const right = alphaAt(x0 + 1, y0);
    const up = alphaAt(x0, y0 - 1);
    const down = alphaAt(x0, y0 + 1);

    let nx = right - left;
    let ny = down - up;

    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;

    return { nx, ny };
  }

  function sampleOccGrid(x, y) {
    const fx = x / fieldCellSize;
    const fy = y / fieldCellSize;

    let x0 = Math.floor(fx);
    let y0 = Math.floor(fy);

    if (x0 < 0 || y0 < 0 || x0 >= gridW || y0 >= gridH) return 0;

    let x1 = x0 + 1;
    let y1 = y0 + 1;

    x0 = clampInt(x0, 0, gridW - 1);
    y0 = clampInt(y0, 0, gridH - 1);
    x1 = clampInt(x1, 0, gridW - 1);
    y1 = clampInt(y1, 0, gridH - 1);

    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);

    const i00 = y0 * gridW + x0;
    const i10 = y0 * gridW + x1;
    const i01 = y1 * gridW + x0;
    const i11 = y1 * gridW + x1;

    const v0 = lerp(occ[i00], occ[i10], tx);
    const v1 = lerp(occ[i01], occ[i11], tx);

    return lerp(v0, v1, ty);
  }

  function buildObstacleField() {
    refreshMask();

    for (let gy = 0; gy < gridH; gy++) {
      const py = gy * fieldCellSize + fieldCellSize * 0.5;

      for (let gx = 0; gx < gridW; gx++) {
        const px = gx * fieldCellSize + fieldCellSize * 0.5;
        const idx = gy * gridW + gx;
        occ[idx] = alphaAt(px, py) / 255;
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          const idx = gy * gridW + gx;

          const xm = gx > 0 ? gx - 1 : gx;
          const xp = gx < gridW - 1 ? gx + 1 : gx;
          const ym = gy > 0 ? gy - 1 : gy;
          const yp = gy < gridH - 1 ? gy + 1 : gy;

          const iL = gy * gridW + xm;
          const iR = gy * gridW + xp;
          const iU = ym * gridW + gx;
          const iD = yp * gridW + gx;

          const center = occ[idx];
          const avg = (center * 4 + occ[iL] + occ[iR] + occ[iU] + occ[iD]) / 8;
          occTmp[idx] = avg;
        }
      }
      occ.set(occTmp);
    }
  }

  // ============================================================
  // Ветер
  // ============================================================
  function noise2D(x, y, t) {
    const a = Math.sin(x * 0.008 + t * 0.7);
    const b = Math.cos(y * 0.010 - t * 0.6);
    const c = Math.sin((x + y) * 0.006 + t * 1.0);
    const d = Math.cos((x - y) * 0.012 - t * 0.45);
    return (a + b + c + d) * 0.25;
  }

  function updateField(time) {
    const t = time * 0.001;

    const baseSpeed = 4.4 * flowSpeed * DPR;
    const gustMul = 0.75 * gustStrength * flowSpeed * DPR;
    const pressureMul = 5.8 * flowSpeed * DPR;
    const vortexMul = 3.8 * vortexStrength * flowSpeed * DPR;
    const wakeMul = 4.3 * wakeStrength * flowSpeed * DPR;

    const perpX = -windUy;
    const perpY = windUx;

    for (let gy = 0; gy < gridH; gy++) {
      const py = gy * fieldCellSize + fieldCellSize * 0.5;

      for (let gx = 0; gx < gridW; gx++) {
        const px = gx * fieldCellSize + fieldCellSize * 0.5;
        const idx = gy * gridW + gx;

        const occupancy = occ[idx];

        const xm = gx > 0 ? gx - 1 : gx;
        const xp = gx < gridW - 1 ? gx + 1 : gx;
        const ym = gy > 0 ? gy - 1 : gy;
        const yp = gy < gridH - 1 ? gy + 1 : gy;

        const left = occ[gy * gridW + xm];
        const right = occ[gy * gridW + xp];
        const up = occ[ym * gridW + gx];
        const down = occ[yp * gridW + gx];

        const gradX = (right - left);
        const gradY = (down - up);

        const along = px * windUx + py * windUy;
        const across = -px * windUy + py * windUx;

        const gustA = Math.sin(across * 0.0032 + t * 1.15);
        const gustB = Math.cos(along * 0.0021 - t * 0.85);
        const gustC = Math.sin((across + along) * 0.0017 + t * 1.45);

        const n1 = noise2D(px, py, t);
        const n2 = noise2D(px + 190, py - 80, t * 0.8);

        let vx = windUx * baseSpeed;
        let vy = windUy * baseSpeed;

        vx += windUx * (gustA * gustMul + gustB * gustMul * 0.65);
        vy += windUy * (gustA * gustMul + gustB * gustMul * 0.65);

        vx += perpX * (gustC * gustMul * 0.55);
        vy += perpY * (gustC * gustMul * 0.55);

        vx += (0.14 * n1 + 0.07 * n2) * gustMul * 0.55;
        vy += (0.12 * n2 - 0.05 * n1) * gustMul * 0.55;

        vx -= gradX * pressureMul;
        vy -= gradY * pressureMul;

        const cross = windUx * gradY - windUy * gradX;
        vx += perpX * cross * vortexMul * (0.45 + occupancy * 1.2);
        vy += perpY * cross * vortexMul * (0.45 + occupancy * 1.2);

        const up1 = sampleOccGrid(px - windUx * fieldCellSize * 1.4, py - windUy * fieldCellSize * 1.4);
        const up2 = sampleOccGrid(px - windUx * fieldCellSize * 2.8, py - windUy * fieldCellSize * 2.8);
        const up3 = sampleOccGrid(px - windUx * fieldCellSize * 4.2, py - windUy * fieldCellSize * 4.2);

        const wake = (up1 * 0.9 + up2 * 0.65 + up3 * 0.35) * wakeMul;

        vx -= windUx * wake;
        vy -= windUy * wake;

        const shed = Math.sin(t * 2.6 + across * 0.014) * wake * vortexMul * 0.18;
        vx += perpX * shed;
        vy += perpY * shed;

        if (occupancy > 0.78) {
          vx *= 0.02;
          vy *= 0.02;
        } else {
          const calm = Math.max(0, 1 - (Math.abs(gradX) + Math.abs(gradY)) * 5.0);
          vx -= windUx * calm * 0.05 * flowSpeed * DPR;
          vy -= windUy * calm * 0.05 * flowSpeed * DPR;
        }

        fieldVX[idx] = vx;
        fieldVY[idx] = vy;
      }
    }
  }

  function sampleField(x, y) {
    const fx = x / fieldCellSize;
    const fy = y / fieldCellSize;

    let x0 = Math.floor(fx);
    let y0 = Math.floor(fy);

    if (x0 < 0 || y0 < 0 || x0 >= gridW || y0 >= gridH) {
      return {
        vx: windUx * 4.4 * flowSpeed * DPR,
        vy: windUy * 4.4 * flowSpeed * DPR
      };
    }

    const tx = fx - x0;
    const ty = fy - y0;

    const x1 = clampInt(x0 + 1, 0, gridW - 1);
    const y1 = clampInt(y0 + 1, 0, gridH - 1);

    x0 = clampInt(x0, 0, gridW - 1);
    y0 = clampInt(y0, 0, gridH - 1);

    const i00 = y0 * gridW + x0;
    const i10 = y0 * gridW + x1;
    const i01 = y1 * gridW + x0;
    const i11 = y1 * gridW + x1;

    const vx0 = lerp(fieldVX[i00], fieldVX[i10], tx);
    const vx1 = lerp(fieldVX[i01], fieldVX[i11], tx);
    const vy0 = lerp(fieldVY[i00], fieldVY[i10], tx);
    const vy1 = lerp(fieldVY[i01], fieldVY[i11], tx);

    return {
      vx: lerp(vx0, vx1, ty),
      vy: lerp(vy0, vy1, ty),
    };
  }

  // ============================================================
  // Частицы
  // ============================================================
  function spawnPoint() {
    const margin = 70 * DPR;

    if (Math.abs(windUx) >= Math.abs(windUy)) {
      const span = H * 0.92;
      const y = H * 0.5 + (Math.random() - 0.5) * span;
      return {
        x: windUx >= 0 ? -margin : W + margin,
        y: clamp(y, -margin, H + margin)
      };
    }

    const span = W * 0.92;
    const x = W * 0.5 + (Math.random() - 0.5) * span;
    return {
      x: clamp(x, -margin, W + margin),
      y: windUy >= 0 ? -margin : H + margin
    };
  }

  class Particle {
    constructor() {
      this.reset(true);
    }

    reset(initial = false) {
      const p = spawnPoint();
      this.x = p.x;
      this.y = p.y;
      this.vx = windUx * (2.8 + Math.random() * 0.9) * DPR;
      this.vy = windUy * (2.8 + Math.random() * 0.9) * DPR;
      this.prevX = this.x;
      this.prevY = this.y;
      this.life = 140 + (Math.random() * 220 | 0);

      if (!initial) {
        const np = spawnPoint();
        this.x = np.x;
        this.y = np.y;
        this.vx = windUx * (2.8 + Math.random() * 0.9) * DPR;
        this.vy = windUy * (2.8 + Math.random() * 0.9) * DPR;
      }
    }

    step() {
      const sx = this.x;
      const sy = this.y;

      if (solidAt(this.x, this.y)) {
        const n = edgeNormalAt(this.x, this.y);
        const push = 1.8 * DPR;

        this.vx += n.nx * push;
        this.vy += n.ny * push;

        const dot = this.vx * n.nx + this.vy * n.ny;
        this.vx -= dot * n.nx * 1.65;
        this.vy -= dot * n.ny * 1.65;

        this.vx *= 0.50;
        this.vy *= 0.50;

        this.x += n.nx * 1.8 * DPR;
        this.y += n.ny * 1.8 * DPR;
      } else {
        const f1 = sampleField(this.x, this.y);
        const midX = this.x + f1.vx * 0.5;
        const midY = this.y + f1.vy * 0.5;
        const f2 = sampleField(midX, midY);

        const targetVx = f2.vx;
        const targetVy = f2.vy;

        this.vx += (targetVx - this.vx) * 0.10;
        this.vy += (targetVy - this.vy) * 0.10;

        const t = performance.now() * 0.001;
        this.vx += Math.sin(this.y * 0.006 + t * 1.2) * 0.0035 * DPR;
        this.vy += Math.cos(this.x * 0.005 - t * 1.0) * 0.0035 * DPR;

        this.vx *= 0.997;
        this.vy *= 0.997;

        const nx = this.x + this.vx;
        const ny = this.y + this.vy;

        if (solidAt(nx, ny)) {
          const n = edgeNormalAt(nx, ny);
          const dot = this.vx * n.nx + this.vy * n.ny;

          this.vx -= dot * n.nx * 1.55;
          this.vy -= dot * n.ny * 1.55;

          this.vx *= 0.55;
          this.vy *= 0.55;

          this.x += n.nx * 1.5 * DPR;
          this.y += n.ny * 1.5 * DPR;
        } else {
          this.x = nx;
          this.y = ny;
        }
      }

      if (this.y < -30 * DPR) this.y = H + 30 * DPR;
      if (this.y > H + 30 * DPR) this.y = -30 * DPR;

      if (this.x > W + 70 * DPR || this.x < -300 * DPR || this.life-- <= 0) {
        this.reset();
        this.prevX = this.x;
        this.prevY = this.y;
      } else {
        this.prevX = sx;
        this.prevY = sy;
      }
    }

    draw() {
      const speed = Math.hypot(this.vx, this.vy);
      const alpha = clamp(speed / (6.0 * DPR), 0.06, 0.9);

      trailCtx.save();
      trailCtx.globalAlpha = alpha;
      trailCtx.strokeStyle = '#ffffff';
      trailCtx.lineWidth = 0.85 * DPR;
      trailCtx.lineCap = 'round';

      trailCtx.beginPath();
      trailCtx.moveTo(
        this.x - this.vx * 1.4,
        this.y - this.vy * 1.4
      );
      trailCtx.lineTo(this.x, this.y);
      trailCtx.stroke();

      trailCtx.restore();
    }
  }

  const particles = [];
  function ensureParticles() {
    const desired = Math.min(
      MAX_PARTICLES,
      Math.floor(1000 + flowSpeed * 420 + vortexStrength * 120 + gustStrength * 90 + wakeStrength * 80)
    );

    while (particles.length < desired) {
      particles.push(new Particle());
    }

    if (particles.length > desired) {
      particles.length = desired;
    }
  }

  // ============================================================
  // Отрисовка
  // ============================================================
  function renderBackground(time) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.015)';
    ctx.lineWidth = 1 * DPR;

    const step = 56 * DPR;
    const shift = (time * 0.010 * flowSpeed) % step;

    for (let x = -step; x <= W + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + shift, 0);
      ctx.lineTo(x + shift, H);
      ctx.stroke();
    }

    for (let y = -step; y <= H + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function renderEditorPreview() {
    if (!editorObject) return;

    ctx.save();
    ctx.globalAlpha = 0.95;
    drawImageObject(ctx, editorObject, 0.95);

    // Обводка активной картинки
    const p1 = worldFromLocal(editorObject, -editorObject.crop.w / 2, -editorObject.crop.h / 2);
    const p2 = worldFromLocal(editorObject, editorObject.crop.w / 2, -editorObject.crop.h / 2);
    const p3 = worldFromLocal(editorObject, editorObject.crop.w / 2, editorObject.crop.h / 2);
    const p4 = worldFromLocal(editorObject, -editorObject.crop.w / 2, editorObject.crop.h / 2);

    ctx.strokeStyle = editorCropMode ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.stroke();

    // Хэндл поворота
    const topMid = worldFromLocal(editorObject, 0, -editorObject.crop.h / 2 - 22 * DPR / editorObject.scale);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(topMid.x, topMid.y, 4 * DPR, 0, Math.PI * 2);
    ctx.fill();

    // Точка центра
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(editorObject.x, editorObject.y, 3 * DPR, 0, Math.PI * 2);
    ctx.fill();

    if (editorCropMode) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([8 * DPR, 6 * DPR]);
      const c = editorObject.crop;
      const a = worldFromLocal(editorObject, -c.w / 2, -c.h / 2);
      const b = worldFromLocal(editorObject, c.w / 2, -c.h / 2);
      const d = worldFromLocal(editorObject, c.w / 2, c.h / 2);
      const e = worldFromLocal(editorObject, -c.w / 2, c.h / 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(d.x, d.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  function renderObstacles() {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();
  }

  function renderFrame(now) {
    renderBackground(now);
    ctx.drawImage(trailCanvas, 0, 0);
    renderObstacles();
    renderEditorPreview();
  }

  // ============================================================
  // Финальная пересборка слоя изображений
  // ============================================================
  function rebuildImageLayer() {
    imageCtx.clearRect(0, 0, W, H);

    for (const obj of placedImages) {
      drawImageObject(imageCtx, obj, 1);
    }
  }

  // ============================================================
  // Цикл
  // ============================================================
  let frameIndex = 0;

  function loop(now) {
    requestAnimationFrame(loop);

    if (maskDirty) {
      rebuildImageLayer();
      rebuildFinalMask();
    }

    renderFrame(now);

    if (!running) return;

    if ((frameIndex++ & 1) === 0) {
      updateField(now);
    }

    trailCtx.save();
    trailCtx.globalCompositeOperation = 'destination-out';
    trailCtx.fillStyle = `rgba(0,0,0,${trailFade})`;
    trailCtx.fillRect(0, 0, W, H);
    trailCtx.restore();

    ensureParticles();

    const spawnPerFrame = Math.max(1, Math.floor(1 + flowSpeed * 1.5));
    for (let i = 0; i < spawnPerFrame; i++) {
      if (particles.length < MAX_PARTICLES) {
        particles.push(new Particle());
      }
    }

    for (let i = 0; i < particles.length; i++) {
      particles[i].step();
      particles[i].draw();
    }
  }

  // ============================================================
  // Старт
  // ============================================================
  clearAllObstacles();
  setActiveTool('draw');
  setWindAngle(DEFAULT_WIND_ANGLE);
  setSpeed(1);
  setVortexStrength(1.4);
  setGustStrength(0.85);
  setWakeStrength(1.15);
  setTrailFade(0.10);
  ensureParticles();
  requestAnimationFrame(loop);
})();