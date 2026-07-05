// ⚠️ Apps Script 배포 후 웹앱 URL을 여기에 붙여넣으세요
// 예: https://script.google.com/macros/s/AKfycb.../exec
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
  '임시저장': null
};

let selectedImageBase64 = null;
let selectedImageMime = 'image/jpeg';

// ---------- 그룹 드롭다운 채우기 ----------
const groupSelect = document.getElementById('group');
const subgroupSelect = document.getElementById('subgroup');
const subsubgroupSelect = document.getElementById('subsubgroup');
const subgroupField = document.getElementById('subgroupField');
const subsubgroupField = document.getElementById('subsubgroupField');

Object.keys(GROUP_STRUCTURE).forEach(group => {
  const opt = document.createElement('option');
  opt.value = group;
  opt.textContent = group;
  groupSelect.appendChild(opt);
});

groupSelect.addEventListener('change', () => {
  const group = groupSelect.value;
  subgroupSelect.innerHTML = '<option value="">선택하세요</option>';
  subsubgroupSelect.innerHTML = '<option value="">선택하세요</option>';
  subgroupField.style.display = 'none';
  subsubgroupField.style.display = 'none';

  const sub = GROUP_STRUCTURE[group];
  if (sub && typeof sub === 'object') {
    Object.keys(sub).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      subgroupSelect.appendChild(opt);
    });
    subgroupField.style.display = 'block';
  }
});

subgroupSelect.addEventListener('change', () => {
  const group = groupSelect.value;
  const subgroup = subgroupSelect.value;
  subsubgroupSelect.innerHTML = '<option value="">선택하세요</option>';
  subsubgroupField.style.display = 'none';

  const subsub = GROUP_STRUCTURE[group] && GROUP_STRUCTURE[group][subgroup];
  if (Array.isArray(subsub)) {
    subsub.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      subsubgroupSelect.appendChild(opt);
    });
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
const captureCanvas = document.getElementById('captureCanvas');
const fallbackInput = document.getElementById('fallbackInput');

let stream = null;
let videoTrack = null;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 4096 },
        height: { ideal: 2304 }
      },
      audio: false
    });
    videoTrack = stream.getVideoTracks()[0];
    video.srcObject = stream;
    cameraBox.classList.remove('idle');
    placeholder.style.display = 'none';
    video.style.display = 'block';
    guideFrame.style.display = 'block';
    guideLabel.style.display = 'block';
    captureBtn.style.display = 'block';
  } catch (err) {
    fallbackInput.click();
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    videoTrack = null;
  }
}

// 소스 이미지(고해상도)를 명함 비율로 크롭해서 출력 캔버스에 그림
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

  // 원본이 목표 해상도보다 작으면 원본 크기를 그대로 쓰고(확대 방지), 크면 OUTPUT_WIDTH로 축소
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

function showCaptured() {
  resultImg.src = selectedImageBase64;
  resultImg.style.display = 'block';
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  retakeBtn.style.display = 'block';
  stopCamera();
}

cameraBox.addEventListener('click', () => {
  if (cameraBox.classList.contains('idle')) startCamera();
});

// 캡처 버튼: 가능하면 ImageCapture로 카메라 원본 고해상도 사진을 직접 획득 (영상 프레임보다 훨씬 선명함)
captureBtn.addEventListener('click', async () => {
  if (window.ImageCapture && videoTrack) {
    try {
      const imageCapture = new ImageCapture(videoTrack);
      const blob = await imageCapture.takePhoto();
      const bitmap = await createImageBitmap(blob);
      cropToCardAspect(bitmap, bitmap.width, bitmap.height);
      showCaptured();
      return;
    } catch (err) {
      // ImageCapture 실패 시 아래 영상 프레임 캡처로 대체
    }
  }
  // 대체 방식: 현재 영상 프레임에서 캡처 (ImageCapture 미지원 브라우저용)
  cropToCardAspect(video, video.videoWidth, video.videoHeight);
  showCaptured();
});

// 다시 찍기
retakeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resultImg.style.display = 'none';
  retakeBtn.style.display = 'none';
  selectedImageBase64 = null;
  startCamera();
});

// 카메라 권한이 없거나 지원 안 되는 환경(구형 브라우저 등)의 대체 경로
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
  toast.textContent = msg;
  toast.className = 'toast show ' + (type || '');
  setTimeout(() => { toast.className = 'toast'; }, 2800);
}

// ---------- 저장 ----------
const submitBtn = document.getElementById('submitBtn');

submitBtn.addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const company = document.getElementById('company').value.trim();
  const title = document.getElementById('title').value.trim();
  const group = groupSelect.value;
  const subgroup = subgroupSelect.value;
  const subsubgroup = subsubgroupSelect.value;

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
  if (APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    showToast('설정 오류: Apps Script URL이 아직 입력되지 않았습니다', 'err');
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
  groupSelect.value = '';
  subgroupField.style.display = 'none';
  subsubgroupField.style.display = 'none';
  selectedImageBase64 = null;

  stopCamera();
  resultImg.style.display = 'none';
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
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
const filterGroup = document.getElementById('filterGroup');
const cardListContainer = document.getElementById('cardListContainer');

let allCards = [];
let cardsLoaded = false;

Object.keys(GROUP_STRUCTURE).forEach(group => {
  const opt = document.createElement('option');
  opt.value = group;
  opt.textContent = group;
  filterGroup.appendChild(opt);
});

tabScanBtn.addEventListener('click', () => {
  tabScanBtn.classList.add('active');
  tabListBtn.classList.remove('active');
  scanTab.style.display = 'block';
  listTab.style.display = 'none';
});

tabListBtn.addEventListener('click', () => {
  tabListBtn.classList.add('active');
  tabScanBtn.classList.remove('active');
  scanTab.style.display = 'none';
  listTab.style.display = 'block';
  loadCards();
});

filterGroup.addEventListener('change', () => renderCards());

async function loadCards() {
  cardListContainer.innerHTML = '<div class="empty-state">불러오는 중...</div>';
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=list');
    const data = await res.json();
    if (data.success) {
      allCards = data.cards || [];
      cardsLoaded = true;
      renderCards();
    } else {
      cardListContainer.innerHTML = '<div class="empty-state">불러오기 실패: ' + (data.error || '') + '</div>';
    }
  } catch (err) {
    cardListContainer.innerHTML = '<div class="empty-state">네트워크 오류로 불러오지 못했습니다</div>';
  }
}

function renderCards() {
  const filter = filterGroup.value;
  const filtered = filter ? allCards.filter(c => c.group === filter) : allCards;

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
