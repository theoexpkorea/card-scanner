// ⚠️ Apps Script 배포 후 웹앱 URL을 여기에 붙여넣으세요
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyFPY9gJxEJm_Ny-qqEViYWJ6l1cGptVLto7BR_jyLWk3A2KoV-shtR6ldKod1SdllB/exec';

// 그룹 구조 (Code.gs의 GROUP_STRUCTURE와 반드시 동일하게 유지)
const GROUP_STRUCTURE = {
  '01. 고객': {
    'VIP': null,
    '매도임대': ['관리인(매도임대)', '매도임대인', '임차인(매도인)'],
    '매수임차': ['관리인(매수임차)', '매수임차인']
  },
  '02. 부동산': {
    '공동중개': null,
    '협력부동산': null
  },
  '03. 협력': null,
  '04. eXp 코리아': null,
  '05. 지인': null,
  '06. 편의': null,
  '07. 임시저장': null
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// ---------- 커스텀 드롭다운 컴포넌트 ----------
function makeDropdown(id, placeholderText) {
  const btn = document.getElementById(id + 'Btn');
  const label = document.getElementById(id + 'Label');
  const panel = document.getElementById(id + 'Panel');
  let value = '';
  let options = [];
  let onChangeCb = null;

  function render() {
    panel.innerHTML = options.map(opt => {
      const isSel = opt === value;
      return '<div class="dd-item' + (isSel ? ' selected' : '') + '" data-val="' + escapeHtml(opt) + '">' +
        escapeHtml(opt) + (isSel ? ' <span>✓</span>' : '') +
      '</div>';
    }).join('');
  }

  function closeAll() {
    document.querySelectorAll('.dd-panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.dd-btn.open').forEach(b => b.classList.remove('open'));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !panel.classList.contains('open');
    closeAll();
    if (willOpen) {
      panel.classList.add('open');
      btn.classList.add('open');
    }
  });

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.dd-item');
    if (!item) return;
    value = item.dataset.val;
    label.textContent = value || placeholderText;
    label.classList.toggle('placeholder', !value);
    closeAll();
    render();
    if (onChangeCb) onChangeCb(value);
  });

  document.addEventListener('click', closeAll);

  return {
    setOptions(arr) { options = arr; render(); },
    setValue(v) {
      value = v || '';
      label.textContent = value || placeholderText;
      label.classList.toggle('placeholder', !value);
      render();
    },
    getValue() { return value; },
    onChange(cb) { onChangeCb = cb; }
  };
}

const ddGroup = makeDropdown('ddGroup', '선택하세요');
const ddSubgroup = makeDropdown('ddSubgroup', '선택하세요');
const ddSubsubgroup = makeDropdown('ddSubsubgroup', '선택하세요');
const ddFilter = makeDropdown('ddFilter', '전체 보기');

const subgroupField = document.getElementById('subgroupField');
const subsubgroupField = document.getElementById('subsubgroupField');

ddGroup.setOptions(Object.keys(GROUP_STRUCTURE));

ddGroup.onChange((group) => {
  subgroupField.style.display = 'none';
  subsubgroupField.style.display = 'none';
  ddSubgroup.setValue('');
  ddSubsubgroup.setValue('');

  const sub = GROUP_STRUCTURE[group];
  if (sub && typeof sub === 'object') {
    ddSubgroup.setOptions(Object.keys(sub));
    subgroupField.style.display = 'block';
  }
});

ddSubgroup.onChange((subgroup) => {
  subsubgroupField.style.display = 'none';
  ddSubsubgroup.setValue('');

  const group = ddGroup.getValue();
  const subsub = GROUP_STRUCTURE[group] && GROUP_STRUCTURE[group][subgroup];
  if (Array.isArray(subsub)) {
    ddSubsubgroup.setOptions(subsub);
    subsubgroupField.style.display = 'block';
  }
});

// ---------- 카메라 촬영 (라이브 프리뷰 + 명함 비율 가이드) ----------
const CARD_ASPECT = 85.6 / 54; // 명함 표준 비율 (가로:세로)
const OUTPUT_WIDTH = 2000; // 저장 이미지 고정 가로 크기 (고화질 유지)

const cameraBox = document.getElementById('cameraBox');
const placeholder = document.getElementById('placeholder');
const video = document.getElementById('video');
const resultImg = document.getElementById('resultImg');
const guideFrame = document.getElementById('guideFrame');
const guideLabel = document.getElementById('guideLabel');
const captureBtn = document.getElementById('captureBtn');
const retakeBtn = document.getElementById('retakeBtn');
const nativeFallbackBtn = document.getElementById('nativeFallbackBtn');
const captureCanvas = document.getElementById('captureCanvas');
const fallbackInput = document.getElementById('fallbackInput');

let stream = null;
let videoTrack = null;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    videoTrack = stream.getVideoTracks()[0];

    // 연속 자동초점 시도 + 초기 한 번 강제 트리거 (일부 기기는 continuous만으론 안 움직임)
    try {
      const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      if (capabilities.focusMode) {
        if (capabilities.focusMode.includes('continuous')) {
          await videoTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
        if (capabilities.focusMode.includes('single-shot')) {
          setTimeout(async () => {
            try {
              await videoTrack.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
              setTimeout(async () => {
                if (capabilities.focusMode.includes('continuous')) {
                  try { await videoTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
                }
              }, 800);
            } catch (e) {}
          }, 400);
        }
      }
    } catch (e) {
      // 초점 제어 미지원 기기는 무시하고 진행
    }

    video.srcObject = stream;
    cameraBox.classList.remove('idle');
    placeholder.style.display = 'none';
    video.style.display = 'block';
    guideFrame.style.display = 'block';
    guideLabel.style.display = 'block';
    captureBtn.style.display = 'block';
    nativeFallbackBtn.style.display = 'block';
  } catch (err) {
    fallbackInput.click();
  }
}

// 화면 탭 → 그 지점으로 재초점 시도 (지원 기기에서만 동작)
video.addEventListener('click', async (e) => {
  if (!videoTrack) return;
  try {
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    const rect = video.getBoundingClientRect();
    showFocusRing(e.clientX - rect.left, e.clientY - rect.top);
    if (!capabilities.focusMode) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const constraints = { advanced: [{ pointsOfInterest: [{ x, y }] }] };
    if (capabilities.focusMode.includes('single-shot')) {
      constraints.advanced.push({ focusMode: 'single-shot' });
    }
    await videoTrack.applyConstraints(constraints);
    setTimeout(async () => {
      try {
        if (capabilities.focusMode.includes('continuous')) {
          await videoTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
      } catch (e2) {}
    }, 1500);
  } catch (e) {
    // 미지원 기기는 무시
  }
});

function showFocusRing(x, y) {
  const ring = document.createElement('div');
  ring.className = 'focus-ring';
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  cameraBox.appendChild(ring);
  setTimeout(() => ring.remove(), 700);
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    videoTrack = null;
  }
}

// 소스 이미지를 명함 비율로 크롭해서 출력 캔버스에 그림
function cropToCardAspect(sourceImgOrVideo, srcW, srcH) {
  const aspect = srcW / srcH;
  let sx, sy, sWidth, sHeight;
  if (aspect > CARD_ASPECT) {
    sHeight = srcH;
    sWidth = srcH * CARD_ASPECT;
    sx = (srcW - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = srcW;
    sHeight = srcW / CARD_ASPECT;
    sx = 0;
    sy = (srcH - sHeight) / 2;
  }

  const outW = Math.min(OUTPUT_WIDTH, Math.round(sWidth));
  const outH = Math.round(outW / CARD_ASPECT);

  captureCanvas.width = outW;
  captureCanvas.height = outH;
  const ctx = captureCanvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  try { ctx.filter = 'contrast(1.06) saturate(1.04)'; } catch (e) {}
  ctx.drawImage(sourceImgOrVideo, sx, sy, sWidth, sHeight, 0, 0, outW, outH);

  selectedImageMime = 'image/jpeg';
  selectedImageBase64 = captureCanvas.toDataURL('image/jpeg', 0.92);
}

let selectedImageBase64 = null;
let selectedImageMime = 'image/jpeg';

function showCaptured() {
  resultImg.src = selectedImageBase64;
  resultImg.style.display = 'block';
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  nativeFallbackBtn.style.display = 'none';
  retakeBtn.style.display = 'block';
  stopCamera();
}

cameraBox.addEventListener('click', () => {
  if (cameraBox.classList.contains('idle')) startCamera();
});

captureBtn.addEventListener('click', () => {
  cropToCardAspect(video, video.videoWidth, video.videoHeight);
  showCaptured();
});

// 초점이 계속 안 맞을 때 폰 기본 카메라 앱으로 전환
nativeFallbackBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  stopCamera();
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  nativeFallbackBtn.style.display = 'none';
  fallbackInput.click();
});

retakeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resultImg.style.display = 'none';
  retakeBtn.style.display = 'none';
  selectedImageBase64 = null;
  startCamera();
});

fallbackInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      cropToCardAspect(img, img.width, img.height);
      cameraBox.classList.remove('idle');
      placeholder.style.display = 'none';
      resultImg.src = selectedImageBase64;
      resultImg.style.display = 'block';
      retakeBtn.style.display = 'block';
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});

// ---------- 토스트 ----------
function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.innerHTML = '<span class="dot"></span>' + escapeHtml(msg);
  toast.className = 'toast show ' + (type || '');
  setTimeout(() => { toast.className = 'toast'; }, 2800);
}

// ---------- 저장 ----------
const submitBtn = document.getElementById('submitBtn');

submitBtn.addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const company = document.getElementById('company').value.trim();
  const title = document.getElementById('title').value.trim();
  const group = ddGroup.getValue();
  const subgroup = ddSubgroup.getValue();
  const subsubgroup = ddSubsubgroup.getValue();

  if (!selectedImageBase64) {
    showToast('명함 사진을 먼저 촬영해주세요', 'err');
    return;
  }
  if (!name) {
    showToast('이름을 입력해주세요', 'err');
    return;
  }
  if (!group) {
    showToast('그룹을 선택해주세요', 'err');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '저장 중...';

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        name, company, title, group, subgroup, subsubgroup,
        imageBase64: selectedImageBase64,
        mimeType: selectedImageMime
      })
    });
    const data = await res.json();

    if (data.success) {
      showToast('저장 완료!', 'ok');
      resetForm();
    } else {
      showToast('저장 실패: ' + (data.error || '알 수 없는 오류'), 'err');
    }
  } catch (err) {
    showToast('네트워크 오류: ' + err.message, 'err');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '저장';
  }
});

function resetForm() {
  document.getElementById('name').value = '';
  document.getElementById('company').value = '';
  document.getElementById('title').value = '';
  ddGroup.setValue('');
  ddSubgroup.setValue('');
  ddSubsubgroup.setValue('');
  subgroupField.style.display = 'none';
  subsubgroupField.style.display = 'none';
  selectedImageBase64 = null;

  stopCamera();
  resultImg.style.display = 'none';
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  nativeFallbackBtn.style.display = 'none';
  retakeBtn.style.display = 'none';
  cameraBox.classList.add('idle');
  placeholder.style.display = 'flex';
  fallbackInput.value = '';
}

// ---------- 서비스워커 등록 (PWA 설치용) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- 탭 전환 ----------
const tabScanBtn = document.getElementById('tabScanBtn');
const tabListBtn = document.getElementById('tabListBtn');
const scanTab = document.getElementById('scanTab');
const listTab = document.getElementById('listTab');
const cardListContainer = document.getElementById('cardListContainer');
const filterSubField = document.getElementById('filterSubField');
const filterSubsubField = document.getElementById('filterSubsubField');

const ddFilterSub = makeDropdown('ddFilterSub', '전체 보기');
const ddFilterSubsub = makeDropdown('ddFilterSubsub', '전체 보기');
const ALL_OPTION = '전체 보기';

let allCards = [];

ddFilter.setOptions([ALL_OPTION, ...Object.keys(GROUP_STRUCTURE)]);

ddFilter.onChange((value) => {
  const group = value === ALL_OPTION ? '' : value;
  filterSubField.style.display = 'none';
  filterSubsubField.style.display = 'none';
  ddFilterSub.setValue('');
  ddFilterSubsub.setValue('');

  const sub = GROUP_STRUCTURE[group];
  if (sub && typeof sub === 'object') {
    ddFilterSub.setOptions([ALL_OPTION, ...Object.keys(sub)]);
    filterSubField.style.display = 'block';
  }
  renderCards();
});

ddFilterSub.onChange((value) => {
  const subgroup = value === ALL_OPTION ? '' : value;
  filterSubsubField.style.display = 'none';
  ddFilterSubsub.setValue('');

  const group = ddFilter.getValue();
  const realGroup = group === ALL_OPTION ? '' : group;
  const subsub = GROUP_STRUCTURE[realGroup] && GROUP_STRUCTURE[realGroup][subgroup];
  if (Array.isArray(subsub)) {
    ddFilterSubsub.setOptions([ALL_OPTION, ...subsub]);
    filterSubsubField.style.display = 'block';
  }
  renderCards();
});

ddFilterSubsub.onChange(() => renderCards());

tabScanBtn.addEventListener('click', () => {
  tabScanBtn.classList.add('active');
  tabListBtn.classList.remove('active');
  scanTab.style.display = 'block';
  listTab.style.display = 'none';
});

document.getElementById('headerBrand').addEventListener('click', () => {
  tabScanBtn.click();
});

tabListBtn.addEventListener('click', () => {
  tabListBtn.classList.add('active');
  tabScanBtn.classList.remove('active');
  scanTab.style.display = 'none';
  listTab.style.display = 'block';
  loadCards();
});

async function loadCards() {
  cardListContainer.innerHTML = '<div class="empty-state">불러오는 중...</div>';
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=list');
    const data = await res.json();
    if (data.success) {
      allCards = data.cards || [];
      renderCards();
    } else {
      cardListContainer.innerHTML = '<div class="empty-state">불러오기 실패: ' + escapeHtml(data.error || '') + '</div>';
    }
  } catch (err) {
    cardListContainer.innerHTML = '<div class="empty-state">네트워크 오류로 불러오지 못했습니다</div>';
  }
}

function renderCards() {
  const rawGroup = ddFilter.getValue();
  const rawSubgroup = ddFilterSub.getValue();
  const rawSubsubgroup = ddFilterSubsub.getValue();
  const group = rawGroup === ALL_OPTION ? '' : rawGroup;
  const subgroup = rawSubgroup === ALL_OPTION ? '' : rawSubgroup;
  const subsubgroup = rawSubsubgroup === ALL_OPTION ? '' : rawSubsubgroup;

  let filtered = allCards;
  if (group) filtered = filtered.filter(c => c.group === group);
  if (subgroup) filtered = filtered.filter(c => c.subgroup === subgroup);
  if (subsubgroup) filtered = filtered.filter(c => c.subsubgroup === subsubgroup);

  if (filtered.length === 0) {
    cardListContainer.innerHTML = '<div class="empty-state">저장된 명함이 없습니다</div>';
    return;
  }

  cardListContainer.innerHTML = filtered.map(card => {
    const thumbSrc = card.fileId
      ? 'https://drive.google.com/thumbnail?id=' + card.fileId + '&sz=w200'
      : '';
    const tags = [card.group, card.subgroup, card.subsubgroup].filter(Boolean)
      .map(t => '<span>' + escapeHtml(t) + '</span>').join('');
    return (
      '<a class="card-item" href="' + (card.fileUrl || '#') + '" target="_blank" rel="noopener">' +
        (thumbSrc ? '<img class="thumb" src="' + thumbSrc + '" loading="lazy">' : '<div class="thumb"></div>') +
        '<div class="info">' +
          '<div class="name">' + escapeHtml(card.name || '') + '</div>' +
          '<div class="company">' + escapeHtml(card.company || '') + (card.title ? ' · ' + escapeHtml(card.title) : '') + '</div>' +
          '<div class="meta">' + tags + '</div>' +
        '</div>' +
      '</a>'
    );
  }).join('');
}
