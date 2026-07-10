// ⚠️ Apps Script 배포 후 웹앱 URL을 여기에 붙여넣으세요
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyFPY9gJxEJm_Ny-qqEViYWJ6l1cGptVLto7BR_jyLWk3A2KoV-shtR6ldKod1SdllB/exec';

// 매물뷰 앱 등 외부에서 ?property=매물번호 형태로 넘어온 경우, 그 매물 관련 명함만 필터링해서 목록으로 바로 이동
const URL_PROPERTY_FILTER = new URLSearchParams(window.location.search).get('property');

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
function makeDropdown(id, placeholderText, displayFn) {
  displayFn = displayFn || (v => v);
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
        escapeHtml(displayFn(opt)) + (isSel ? ' <span>✓</span>' : '') +
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
    label.textContent = value ? displayFn(value) : placeholderText;
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
      label.textContent = value ? displayFn(value) : placeholderText;
      label.classList.toggle('placeholder', !value);
      render();
    },
    getValue() { return value; },
    onChange(cb) { onChangeCb = cb; }
  };
}

// 그룹(대분류) 값에서 "01. " 같은 앞 번호는 화면 표시에서만 떼고, 저장/필터링에 쓰이는 실제 값은 그대로 유지
const stripGroupNumber = (v) => v.replace(/^\d+\.\s*/, '');

const ddGroup = makeDropdown('ddGroup', '선택하세요', stripGroupNumber);
const ddSubgroup = makeDropdown('ddSubgroup', '선택하세요');
const ddSubsubgroup = makeDropdown('ddSubsubgroup', '선택하세요');
const ddFilter = makeDropdown('ddFilter', '전체 보기', stripGroupNumber);

const subgroupField = document.getElementById('subgroupField');
const subsubgroupField = document.getElementById('subsubgroupField');
const propertyNoField = document.getElementById('propertyNoField');
const propertyNoInput = document.getElementById('propertyNo');

const PROPERTY_LINKED_SUBGROUPS = ['매도임대', '매수임차'];

function updatePropertyNoVisibility() {
  const group = ddGroup.getValue();
  const subgroup = ddSubgroup.getValue();
  const shouldShow = group === '01. 고객' && PROPERTY_LINKED_SUBGROUPS.includes(subgroup);
  propertyNoField.style.display = shouldShow ? 'block' : 'none';
  if (!shouldShow) propertyNoInput.value = '';
}

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
  updatePropertyNoVisibility();
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
  updatePropertyNoVisibility();
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

function handlePickedFile(file) {
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
}

fallbackInput.addEventListener('change', (e) => {
  handlePickedFile(e.target.files[0]);
});

const galleryInput = document.getElementById('galleryInput');
const galleryBtn = document.getElementById('galleryBtn');

galleryBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  stopCamera();
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  nativeFallbackBtn.style.display = 'none';
  galleryInput.click();
});

galleryInput.addEventListener('change', (e) => {
  handlePickedFile(e.target.files[0]);
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

const MY_CARD_MESSAGE = '안녕하세요 😊 \n오늘 만나 뵙게 되어 반갑습니다.\n\n\n김정혁 \neXp 코리아 공인중개사 \n010-2489-4759\n junghyuk.kim@expkr.com';
const MY_CARD_MESSAGE_PLAIN = '김정혁\neXp 코리아 공인중개사\n010-2489-4759\njunghyuk.kim@expkr.com';

// GET 요청은 JSONP 방식으로 (fetch의 CORS 불안정성을 피하기 위해, 매물뷰 앱과 동일한 방식)
function jsonpOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('요청 시간 초과'));
    }, timeoutMs);

    window[callbackName] = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('JSONP 요청 실패'));
    };

    script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + callbackName;
    document.body.appendChild(script);
  });
}

// 서버(Apps Script) 예열 지연이나 모바일 네트워크 순간 끊김 대비: 실패 시 최대 3번 더 자동 재시도 (총 4회)
function jsonp(url, retries, timeoutMs, attempt) {
  retries = retries === undefined ? 3 : retries;
  timeoutMs = timeoutMs === undefined ? 12000 : timeoutMs;
  attempt = attempt === undefined ? 0 : attempt;
  return jsonpOnce(url, timeoutMs).catch((err) => {
    if (retries <= 0) throw err;
    const wait = 700 * (attempt + 1); // 700ms, 1400ms, 2100ms로 점점 늘어남
    return new Promise((resolve) => setTimeout(resolve, wait)).then(() => jsonp(url, retries - 1, timeoutMs, attempt + 1));
  });
}

const smsPrompt = document.getElementById('smsPrompt');
const smsSendBtn = document.getElementById('smsSendBtn');
const smsSkipBtn = document.getElementById('smsSkipBtn');
let pendingPhone = null;

submitBtn.addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const company = document.getElementById('company').value.trim();
  const title = document.getElementById('title').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const propertyNo = document.getElementById('propertyNo').value.trim();
  const group = ddGroup.getValue();
  const subgroup = ddSubgroup.getValue();
  const subsubgroup = ddSubsubgroup.getValue();

  // 수정 모드에서는 새 사진을 다시 찍지 않아도 기존 사진이 유지되므로 사진 필수 검사를 건너뜀
  if (!editingCardId && !selectedImageBase64) {
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
  submitBtn.textContent = editingCardId ? '수정 저장 중...' : '저장 중...';

  try {
    const payload = {
      name, company, title, phone, propertyNo, group, subgroup, subsubgroup
    };
    if (selectedImageBase64) {
      payload.imageBase64 = selectedImageBase64;
      payload.mimeType = selectedImageMime;
    }
    if (editingCardId) {
      payload.action = 'update';
      payload.id = editingCardId;
    }

    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      if (editingCardId) {
        showToast('수정 완료!', 'ok');
        exitEditMode();
        tabListBtn.click();
        loadCards();
      } else if (phone) {
        pendingPhone = phone;
        showToast('저장 완료!', 'ok');
        smsPrompt.style.display = 'block';
      } else {
        showToast('저장 완료!', 'ok');
        resetForm();
      }
    } else {
      showToast((editingCardId ? '수정 실패: ' : '저장 실패: ') + (data.error || '알 수 없는 오류'), 'err');
    }
  } catch (err) {
    showToast('네트워크 오류: ' + err.message, 'err');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingCardId ? '수정 저장' : '저장';
  }
});

smsSendBtn.addEventListener('click', () => {
  if (pendingPhone) {
    const cleanPhone = pendingPhone.replace(/[^0-9+]/g, '');
    const smsUrl = 'sms:' + cleanPhone + '?body=' + encodeURIComponent(MY_CARD_MESSAGE);
    window.location.href = smsUrl;
  }
  smsPrompt.style.display = 'none';
  pendingPhone = null;
  resetForm();
});

smsSkipBtn.addEventListener('click', () => {
  smsPrompt.style.display = 'none';
  pendingPhone = null;
  resetForm();
});

function resetForm() {
  document.getElementById('name').value = '';
  document.getElementById('company').value = '';
  document.getElementById('title').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('propertyNo').value = '';
  propertyNoField.style.display = 'none';
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
  galleryInput.value = '';
  smsPrompt.style.display = 'none';
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

const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', () => renderCards());

tabScanBtn.addEventListener('click', () => {
  tabScanBtn.classList.add('active');
  tabListBtn.classList.remove('active');
  scanTab.style.display = 'block';
  listTab.style.display = 'none';
});

document.getElementById('headerBrand').addEventListener('click', () => {
  if (editingCardId) {
    exitEditMode();
  }
  tabScanBtn.click();
});

tabListBtn.addEventListener('click', () => {
  tabListBtn.classList.add('active');
  tabScanBtn.classList.remove('active');
  scanTab.style.display = 'none';
  listTab.style.display = 'block';
  loadCards();
});

const CARDS_CACHE_KEY = 'theo_card_list_cache';

async function loadCards() {
  // 저장된 목록이 있으면 즉시 먼저 보여주고, 최신 데이터는 뒤에서 조용히 갱신
  let usedCache = false;
  try {
    const cached = localStorage.getItem(CARDS_CACHE_KEY);
    if (cached) {
      allCards = JSON.parse(cached);
      renderCards();
      usedCache = true;
    }
  } catch (e) {}

  if (!usedCache) {
    cardListContainer.innerHTML = '<div class="empty-state">불러오는 중...</div>';
  }

  try {
    const data = await jsonp(APPS_SCRIPT_URL + '?action=list');
    if (data.success) {
      allCards = data.cards || [];
      renderCards();
      try { localStorage.setItem(CARDS_CACHE_KEY, JSON.stringify(allCards)); } catch (e) {}
    } else if (!usedCache) {
      cardListContainer.innerHTML = '<div class="empty-state">불러오기 실패: ' + escapeHtml(data.error || '') + '</div>';
    }
  } catch (err) {
    // 캐시로 이미 목록을 보여주고 있으면 조용히 무시 (다음 진입 때 다시 시도됨)
    if (!usedCache) {
      cardListContainer.innerHTML = '<div class="empty-state">네트워크 오류로 불러오지 못했습니다<br><button id="retryLoadBtn" style="margin-top:10px;padding:8px 16px;border:1px solid #D1D5DB;border-radius:8px;background:#fff;font-size:14px;">다시 시도</button></div>';
      const retryBtn = document.getElementById('retryLoadBtn');
      if (retryBtn) retryBtn.addEventListener('click', loadCards);
    }
  }
}

const propertyFilterBanner = document.getElementById('propertyFilterBanner');
let propertyFilterActive = !!URL_PROPERTY_FILTER;

function renderPropertyFilterBanner() {
  if (!propertyFilterActive || !URL_PROPERTY_FILTER) {
    propertyFilterBanner.style.display = 'none';
    return;
  }
  propertyFilterBanner.style.display = 'block';
  propertyFilterBanner.innerHTML =
    '<div class="property-filter-banner">' +
      '<span>🏢 매물번호 ' + escapeHtml(URL_PROPERTY_FILTER) + ' 관련 명함만 표시 중</span>' +
      '<button type="button" id="clearPropertyFilterBtn">전체 보기</button>' +
    '</div>';
  document.getElementById('clearPropertyFilterBtn').addEventListener('click', () => {
    propertyFilterActive = false;
    renderPropertyFilterBanner();
    renderCards();
  });
}

// 아웃룩 주소록 카테고리처럼 그룹/소분류/범주별로 차분한 색상 구분
const TAG_PALETTE = [
  { bg: '#E8F0FE', fg: '#3B5BA9' }, // 1 블루
  { bg: '#E3F3EF', fg: '#2F7A6C' }, // 2 틸
  { bg: '#EAF4E7', fg: '#4C7A3A' }, // 3 그린
  { bg: '#FBF1E1', fg: '#9C6B1F' }, // 4 앰버
  { bg: '#FCEEE4', fg: '#B25B27' }, // 5 오렌지
  { bg: '#FBEAEE', fg: '#B14A64' }, // 6 로즈
  { bg: '#F1EAFB', fg: '#6B4FA0' }, // 7 퍼플
  { bg: '#FBEAF4', fg: '#A34B85' }, // 8 핑크
  { bg: '#E5F5F8', fg: '#2A7C8C' }, // 9 시안
  { bg: '#F3EDE7', fg: '#7A5A3E' }, // 10 브라운
  { bg: '#EEF1F4', fg: '#556170' }, // 11 슬레이트
  { bg: '#EAEBFB', fg: '#4B4FA0' }, // 12 인디고
  { bg: '#F1F5E3', fg: '#5E7A1F' }, // 13 라임
  { bg: '#FBF3D0', fg: '#8A6D12' }, // 14 골드
  { bg: '#F7E7E0', fg: '#A5502F' }, // 15 테라코타
  { bg: '#F5E9EF', fg: '#8A4D68' }, // 16 모브
  { bg: '#E4EFFB', fg: '#2E6DA4' }, // 17 스카이
  { bg: '#E9F1E5', fg: '#55744A' }, // 18 세이지
  { bg: '#F6EFE3', fg: '#8A6A3E' }, // 19 샌드
  { bg: '#EFE6F3', fg: '#6E3F7E' }, // 20 플럼
];
// 실제 사용 중인 그룹/소분류/범주는 색이 서로 겹치지 않도록 직접 지정
// (여기 없는 새 값은 아래 hash로 자동 배정됨)
const TAG_COLOR_MAP = {
  '01. 고객': 0, '02. 부동산': 4, '03. 협력': 8, '04. eXp 코리아': 6,
  '05. 지인': 2, '06. 편의': 13, '07. 임시저장': 10,
  'VIP': 3, '매도임대': 14, '매수임차': 16, '공동중개': 5, '협력부동산': 17,
  '관리인(매도임대)': 1, '매도임대인': 7, '임차인(매도인)': 15,
  '관리인(매수임차)': 11, '매수임차인': 19,
};
function tagColor(text) {
  if (Object.prototype.hasOwnProperty.call(TAG_COLOR_MAP, text)) {
    return TAG_PALETTE[TAG_COLOR_MAP[text]];
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

function renderCards() {
  renderPropertyFilterBanner();

  const rawGroup = ddFilter.getValue();
  const rawSubgroup = ddFilterSub.getValue();
  const rawSubsubgroup = ddFilterSubsub.getValue();
  const group = rawGroup === ALL_OPTION ? '' : rawGroup;
  const subgroup = rawSubgroup === ALL_OPTION ? '' : rawSubgroup;
  const subsubgroup = rawSubsubgroup === ALL_OPTION ? '' : rawSubsubgroup;
  const keyword = searchInput.value.trim().toLowerCase();

  let filtered = allCards;
  if (propertyFilterActive && URL_PROPERTY_FILTER) {
    filtered = filtered.filter(c =>
      String(c.propertyNo || '').split(',').map(s => s.trim()).includes(URL_PROPERTY_FILTER.trim())
    );
  }
  if (group) filtered = filtered.filter(c => c.group === group);
  if (subgroup) filtered = filtered.filter(c => c.subgroup === subgroup);
  if (subsubgroup) filtered = filtered.filter(c => c.subsubgroup === subsubgroup);
  if (keyword) filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(keyword));

  const listCountLabel = document.getElementById('listCountLabel');

  if (filtered.length === 0) {
    cardListContainer.innerHTML = '<div class="empty-state">저장된 명함이 없습니다</div>';
    if (listCountLabel) listCountLabel.textContent = '0명';
    return;
  }
  if (listCountLabel) listCountLabel.textContent = filtered.length + '명';

  cardListContainer.innerHTML = filtered.map(card => {
    const thumbSrc = card.fileId
      ? 'https://drive.google.com/thumbnail?id=' + card.fileId + '&sz=w200'
      : '';
    const tags = [card.group, card.subgroup, card.subsubgroup].filter(Boolean)
      .map(t => {
        const c = tagColor(t);
        const displayText = t.replace(/^\d+\.\s*/, '');
        return '<span style="background:' + c.bg + ';color:' + c.fg + ';">' + escapeHtml(displayText) + '</span>';
      }).join('');
    const smsBtn = card.phone
      ? '<button type="button" class="sms-list-btn" data-phone="' + escapeHtml(card.phone) + '" title="문자로 명함 보내기"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>'
      : '';
    const callBtn = card.phone
      ? '<a class="call-list-btn" href="tel:' + escapeHtml(String(card.phone).replace(/[^0-9+]/g, '')) + '" title="전화 걸기"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>'
      : '';
    const propertyNos = (card.propertyNo || '').split(',').map(s => s.trim()).filter(Boolean);
    const propertyBtn = propertyNos.map(pn =>
      '<a class="property-list-btn" href="https://theoexpkorea.github.io/exp-maemul/?q=' + encodeURIComponent(pn) + '" target="_blank" rel="noopener" title="관련 매물 보기 (' + escapeHtml(pn) + ')"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>'
    ).join('');
    const editBtn = '<button type="button" class="edit-list-btn" data-id="' + escapeHtml(card.id || '') + '" title="수정"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>';
    const deleteBtn = '<button type="button" class="delete-list-btn" data-id="' + escapeHtml(card.id || '') + '" title="삭제"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>';
    return (
      '<div class="card-item">' +
        '<a class="card-item-link" href="' + (card.fileUrl || '#') + '" target="_blank" rel="noopener">' +
          (thumbSrc ? '<img class="thumb" src="' + thumbSrc + '" loading="lazy">' : '<div class="thumb"></div>') +
          '<div class="info">' +
            '<div class="name">' + escapeHtml(card.name || '') + '</div>' +
            '<div class="company">' + escapeHtml(card.company || '') + (card.title ? ' · ' + escapeHtml(card.title) : '') + '</div>' +
            '<div class="meta">' + tags + '</div>' +
          '</div>' +
        '</a>' +
        '<div class="card-actions">' + propertyBtn + callBtn + smsBtn + editBtn + deleteBtn + '</div>' +
      '</div>'
    );
  }).join('');
}

cardListContainer.addEventListener('click', (e) => {
  const smsBtn = e.target.closest('.sms-list-btn');
  if (smsBtn) {
    e.preventDefault();
    const phone = smsBtn.dataset.phone;
    const cleanPhone = String(phone).replace(/[^0-9+]/g, '');
    window.location.href = 'sms:' + cleanPhone;
    return;
  }
  const editBtn = e.target.closest('.edit-list-btn');
  if (editBtn) {
    e.preventDefault();
    const card = allCards.find(c => c.id === editBtn.dataset.id);
    if (card) enterEditMode(card);
    return;
  }
  const deleteBtn = e.target.closest('.delete-list-btn');
  if (deleteBtn) {
    e.preventDefault();
    const card = allCards.find(c => c.id === deleteBtn.dataset.id);
    if (card) deleteCardFlow(card);
    return;
  }
});

// ---------- 비밀번호 잠금 ----------
(function() {
  const lockScreen = document.getElementById('lockScreen');
  const lockInput = document.getElementById('lockInput');
  const lockBtn = document.getElementById('lockBtn');
  const lockErr = document.getElementById('lockErr');

  let correctPass = null;
  let passLoaded = false;
  let passLoading = false;

  const PASS_CACHE_KEY = 'theo_card_pass_cache';

  try {
    const cached = localStorage.getItem(PASS_CACHE_KEY);
    if (cached) {
      correctPass = cached;
      passLoaded = true;
    }
  } catch (e) {}

  function unlock() {
    lockScreen.style.display = 'none';
    if (URL_PROPERTY_FILTER) {
      tabListBtn.click();
    }
  }

  function tryUnlock() {
    const entered = lockInput.value.trim();
    if (!entered) { lockErr.textContent = '비밀번호를 입력해 주세요'; return; }
    if (!passLoaded) {
      if (!passLoading) {
        lockErr.textContent = '서버에 연결하는 중...';
        loadPass();
      }
      return;
    }
    if (entered === correctPass) {
      unlock();
    } else {
      lockErr.textContent = '비밀번호가 틀렸습니다';
      lockInput.value = '';
      lockInput.focus();
      lockInput.style.borderColor = '#E03A3A';
      setTimeout(() => { lockInput.style.borderColor = ''; }, 800);
    }
  }

  lockBtn.addEventListener('click', tryUnlock);
  lockInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

  async function loadPass() {
    if (passLoading) return;
    passLoading = true;
    const hadCache = passLoaded;
    try {
      const data = await jsonp(APPS_SCRIPT_URL + '?action=pass');
      if (data && data.pass !== undefined) {
        correctPass = String(data.pass).trim();
        passLoaded = true;
        if (!hadCache) { lockErr.textContent = ''; lockInput.focus(); }
        try { localStorage.setItem(PASS_CACHE_KEY, correctPass); } catch (e) {}
      }
    } catch (e) {
      if (!hadCache) lockErr.textContent = '서버 연결이 원활하지 않습니다. 확인 버튼을 다시 눌러주세요';
    } finally {
      passLoading = false;
    }
  }

  lockInput.focus();
  loadPass();
})();

// ---------- 명함 수정 ----------
let editingCardId = null;
const editBanner = document.getElementById('editBanner');
const cancelEditBtn = document.getElementById('cancelEditBtn');

function populateGroupChain(group, subgroup, subsubgroup) {
  ddGroup.setValue(group || '');
  subgroupField.style.display = 'none';
  subsubgroupField.style.display = 'none';
  ddSubgroup.setValue('');
  ddSubsubgroup.setValue('');

  const sub = GROUP_STRUCTURE[group];
  if (sub && typeof sub === 'object') {
    ddSubgroup.setOptions(Object.keys(sub));
    subgroupField.style.display = 'block';
    ddSubgroup.setValue(subgroup || '');

    const subsub = sub[subgroup];
    if (Array.isArray(subsub)) {
      ddSubsubgroup.setOptions(subsub);
      subsubgroupField.style.display = 'block';
      ddSubsubgroup.setValue(subsubgroup || '');
    }
  }
  updatePropertyNoVisibility();
}

function enterEditMode(card) {
  editingCardId = card.id;

  document.getElementById('name').value = card.name || '';
  document.getElementById('company').value = card.company || '';
  document.getElementById('title').value = card.title || '';
  document.getElementById('phone').value = card.phone || '';
  document.getElementById('propertyNo').value = card.propertyNo || '';
  populateGroupChain(card.group, card.subgroup, card.subsubgroup);

  selectedImageBase64 = null;
  stopCamera();
  cameraBox.classList.remove('idle');
  placeholder.style.display = 'none';
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  nativeFallbackBtn.style.display = 'none';
  retakeBtn.style.display = 'block';
  if (card.fileId) {
    resultImg.src = 'https://drive.google.com/thumbnail?id=' + card.fileId + '&sz=w800';
    resultImg.style.display = 'block';
  } else {
    resultImg.style.display = 'none';
  }

  editBanner && (editBanner.style.display = 'block');
  cancelEditBtn && (cancelEditBtn.style.display = 'block');
  submitBtn.textContent = '수정 저장';

  tabScanBtn.click();
  window.scrollTo(0, 0);
}

function exitEditMode() {
  editingCardId = null;
  if (editBanner) editBanner.style.display = 'none';
  if (cancelEditBtn) cancelEditBtn.style.display = 'none';
  submitBtn.textContent = '저장';
  resetForm();
}

cancelEditBtn.addEventListener('click', () => {
  exitEditMode();
  tabListBtn.click();
});

// ---------- 명함 삭제 ----------
async function deleteCardFlow(card) {
  const ok = window.confirm('"' + card.name + '" 명함을 삭제할까요?\n사진은 구글 드라이브 휴지통으로 이동합니다 (30일 내 복구 가능).');
  if (!ok) return;

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'delete', id: card.id, trashPhoto: true })
    });
    const data = await res.json();
    if (data.success) {
      if (data.photoWarning) {
        showToast('시트에서 삭제됨 · ' + data.photoWarning, 'err');
      } else {
        showToast('삭제되었습니다', 'ok');
      }
      allCards = allCards.filter(c => c.id !== card.id);
      try { localStorage.setItem(CARDS_CACHE_KEY, JSON.stringify(allCards)); } catch (e) {}
      renderCards();
    } else {
      showToast('삭제 실패: ' + (data.error || '알 수 없는 오류'), 'err');
    }
  } catch (err) {
    showToast('네트워크 오류: ' + err.message, 'err');
  }
}

// ---------- 매물번호 일괄 반영 ----------
const bulkPropertyBtn = document.getElementById('bulkPropertyBtn');
const bulkPropertyOverlay = document.getElementById('bulkPropertyOverlay');
const bulkPropertyCloseBtn = document.getElementById('bulkPropertyCloseBtn');
const bulkPropertyInput = document.getElementById('bulkPropertyInput');
const bulkPropertyStep1 = document.getElementById('bulkPropertyStep1');
const bulkPropertyStep2 = document.getElementById('bulkPropertyStep2');
const bulkPropertyResults = document.getElementById('bulkPropertyResults');
const bulkPropertyPreviewBtn = document.getElementById('bulkPropertyPreviewBtn');
const bulkPropertyApplyBtn = document.getElementById('bulkPropertyApplyBtn');
const bulkPropertyBackBtn = document.getElementById('bulkPropertyBackBtn');

let bulkParsedRows = [];

function normalizePhoneJS(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function looksLikePhoneJS(v) {
  const s = String(v || '').trim();
  return /^[0-9\-+\s]+$/.test(s) && normalizePhoneJS(s).length >= 4;
}

function openBulkPropertyModal() {
  bulkPropertyOverlay.style.display = 'flex';
  bulkPropertyStep1.style.display = 'block';
  bulkPropertyStep2.style.display = 'none';
  bulkPropertyInput.value = '';
}
function closeBulkPropertyModal() {
  bulkPropertyOverlay.style.display = 'none';
}
bulkPropertyBtn.addEventListener('click', openBulkPropertyModal);
bulkPropertyCloseBtn.addEventListener('click', closeBulkPropertyModal);
bulkPropertyBackBtn.addEventListener('click', () => {
  bulkPropertyStep1.style.display = 'block';
  bulkPropertyStep2.style.display = 'none';
});

function parseBulkInput(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const idx = line.indexOf(',');
    if (idx === -1) return { query: line, propertyNo: '' };
    return { query: line.slice(0, idx).trim(), propertyNo: line.slice(idx + 1).trim() };
  });
}

function matchLocally(query) {
  if (looksLikePhoneJS(query)) {
    const qPhone = normalizePhoneJS(query);
    return allCards.filter(c => normalizePhoneJS(c.phone) === qPhone);
  }
  return allCards.filter(c => (c.name || '').trim().toLowerCase() === query.toLowerCase());
}

bulkPropertyPreviewBtn.addEventListener('click', () => {
  const rows = parseBulkInput(bulkPropertyInput.value);
  if (rows.length === 0) {
    showToast('붙여넣은 내용이 없습니다', 'err');
    return;
  }
  bulkParsedRows = rows.map(r => ({ ...r, matches: matchLocally(r.query) }));

  bulkPropertyResults.innerHTML = bulkParsedRows.map(r => {
    let statusHtml;
    if (r.matches.length === 1) {
      statusHtml = '<span class="bulk-result-status bulk-status-updated">✓ ' + escapeHtml(r.propertyNo || '(비우기)') + '</span>';
    } else if (r.matches.length === 0) {
      statusHtml = '<span class="bulk-result-status bulk-status-not_found">일치하는 명함 없음</span>';
    } else {
      statusHtml = '<span class="bulk-result-status bulk-status-ambiguous">동명 ' + r.matches.length + '건, 건너뜀</span>';
    }
    return '<div class="bulk-result-row"><span>' + escapeHtml(r.query) + '</span>' + statusHtml + '</div>';
  }).join('');

  const applyCount = bulkParsedRows.filter(r => r.matches.length === 1).length;
  bulkPropertyApplyBtn.textContent = '일괄 적용 (' + applyCount + '건)';
  bulkPropertyApplyBtn.disabled = applyCount === 0;

  bulkPropertyStep1.style.display = 'none';
  bulkPropertyStep2.style.display = 'block';
});

bulkPropertyApplyBtn.addEventListener('click', async () => {
  const mappings = bulkParsedRows
    .filter(r => r.matches.length === 1)
    .map(r => ({ query: r.query, propertyNo: r.propertyNo }));

  if (mappings.length === 0) return;

  bulkPropertyApplyBtn.disabled = true;
  bulkPropertyApplyBtn.textContent = '적용 중...';

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'bulkProperty', mappings: mappings })
    });
    const data = await res.json();
    if (data.success) {
      showToast('일괄 반영 완료 (' + mappings.length + '건)', 'ok');
      closeBulkPropertyModal();
      loadCards();
    } else {
      showToast('일괄 반영 실패: ' + (data.error || '알 수 없는 오류'), 'err');
    }
  } catch (err) {
    showToast('네트워크 오류: ' + err.message, 'err');
  } finally {
    bulkPropertyApplyBtn.disabled = false;
    bulkPropertyApplyBtn.textContent = '일괄 적용';
  }
});
