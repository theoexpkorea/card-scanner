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
const OUTPUT_WIDTH = 1400; // 저장 이미지 고정 가로 크기 (모든 명함이 동일한 해상도로 저장됨)

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

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    cameraBox.classList.remove('idle');
    placeholder.style.display = 'none';
    video.style.display = 'block';
    guideFrame.style.display = 'block';
    guideLabel.style.display = 'block';
    captureBtn.style.display = 'block';
  } catch (err) {
    // 권한 거부/미지원 시 기본 카메라 앱으로 대체
    fallbackInput.click();
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

// 촬영 시작: 처음 탭하면 카메라 권한 요청 + 프리뷰 시작
cameraBox.addEventListener('click', () => {
  if (cameraBox.classList.contains('idle')) startCamera();
});

// 캡처 버튼: 가이드 박스와 동일한 비율로 잘라서 고정 해상도로 저장
captureBtn.addEventListener('click', () => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const videoAspect = vw / vh;

  let sx, sy, sWidth, sHeight;
  if (videoAspect > CARD_ASPECT) {
    // 영상이 더 넓음 → 좌우를 잘라 명함 비율에 맞춤 (object-fit:cover와 동일 동작)
    sHeight = vh;
    sWidth = vh * CARD_ASPECT;
    sx = (vw - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = vw;
    sHeight = vw / CARD_ASPECT;
    sx = 0;
    sy = (vh - sHeight) / 2;
  }

  const outW = OUTPUT_WIDTH;
  const outH = Math.round(OUTPUT_WIDTH / CARD_ASPECT);
  captureCanvas.width = outW;
  captureCanvas.height = outH;
  const ctx = captureCanvas.getContext('2d');
  // 살짝 대비/선명도 보정 (지원 브라우저 한정, 미지원이면 무시됨)
  try { ctx.filter = 'contrast(1.08) saturate(1.05)'; } catch (e) {}
  ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, outW, outH);

  selectedImageMime = 'image/jpeg';
  selectedImageBase64 = captureCanvas.toDataURL('image/jpeg', 0.85);

  resultImg.src = selectedImageBase64;
  resultImg.style.display = 'block';
  video.style.display = 'none';
  guideFrame.style.display = 'none';
  guideLabel.style.display = 'none';
  captureBtn.style.display = 'none';
  retakeBtn.style.display = 'block';

  stopCamera();
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
      const vw = img.width, vh = img.height;
      const videoAspect = vw / vh;
      let sx, sy, sWidth, sHeight;
      if (videoAspect > CARD_ASPECT) {
        sHeight = vh; sWidth = vh * CARD_ASPECT; sx = (vw - sWidth) / 2; sy = 0;
      } else {
        sWidth = vw; sHeight = vw / CARD_ASPECT; sx = 0; sy = (vh - sHeight) / 2;
      }
      const outW = OUTPUT_WIDTH;
      const outH = Math.round(OUTPUT_WIDTH / CARD_ASPECT);
      captureCanvas.width = outW;
      captureCanvas.height = outH;
      const ctx = captureCanvas.getContext('2d');
      try { ctx.filter = 'contrast(1.08) saturate(1.05)'; } catch (err) {}
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outW, outH);

      selectedImageMime = 'image/jpeg';
      selectedImageBase64 = captureCanvas.toDataURL('image/jpeg', 0.85);

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
