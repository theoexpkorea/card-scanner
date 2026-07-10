// ========================================
// 명함 스캔 앱 - Apps Script 백엔드
// ========================================

// 이미 만들어두신 최상위 Drive 폴더 이름
const ROOT_FOLDER_NAME = '09. eXp_KJH_명함사진';

// 데이터가 저장될 Sheets 이름 (없으면 자동 생성됨)
const SHEET_FILE_NAME = '명함관리_데이터';
const SHEET_ID_PROP = 'CARD_SHEET_ID';
const CARD_SHEET_NAME = '명함'; // 데이터 탭 고정 이름 (매물뷰 앱의 '매물' 탭과 동일한 방식)

// 시트 컬럼 순서 (0-based 인덱스와 동일하게 유지)
const CARD_COLUMNS = ['등록일시', '대분류', '소분류', '소소분류', '이름', '회사명', '직함', '파일명', '사진링크', '파일ID', '연락처', '매물번호', 'ID'];

// 그룹 구조 (프론트엔드와 동일하게 유지)
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

// 앱 잠금 비밀번호 최초 기본값 (시트에 "설정" 탭이 없을 때 한 번만 사용됨)
// 실제 비밀번호는 이후 Sheets의 "설정" 탭 A1 셀에서 바로 수정 가능합니다 (재배포 불필요)
const DEFAULT_APP_PASSWORD = '7823';

// ---------- 웹앱 진입점 ----------

// GET 요청: 그룹 구조 조회, ?action=list 로 저장된 명함 목록 조회, ?action=pass 로 잠금 비밀번호 조회
function doGet(e) {
  const action = e.parameter.action;
  const callback = e.parameter.callback;

  let payload;
  if (action === 'pass') {
    payload = { success: true, pass: getAppPassword() };
  } else if (action === 'list') {
    try {
      payload = { success: true, cards: getCards() };
    } catch (err) {
      payload = { success: false, error: err.toString() };
    }
  } else {
    payload = { success: true, groups: GROUP_STRUCTURE };
  }

  const json = JSON.stringify(payload);

  // callback 파라미터가 있으면 JSONP 방식으로 응답 (CORS 이슈 회피, 매물뷰 앱과 동일한 방식)
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// POST 요청: data.action 값에 따라 저장/수정/삭제/일괄반영으로 분기 (CORS 우회를 위해 text/plain으로 받음)
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;
    if (data.action === 'update') {
      result = updateCard(data);
    } else if (data.action === 'delete') {
      result = deleteCard(data);
    } else if (data.action === 'bulkProperty') {
      result = bulkUpdateProperty(data);
    } else {
      // action 값이 없으면(기존 프론트엔드 호환) 저장으로 처리
      result = saveCard(data);
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------- Drive 폴더 자동 생성 ----------

function getRootFolder() {
  const folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function getOrCreateSubfolder(parentFolder, name) {
  if (!name) return parentFolder;
  const folders = parentFolder.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(name);
}

// ---------- Sheets 자동 생성 ----------

function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty(SHEET_ID_PROP);

  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {
      // 저장된 ID가 유효하지 않으면 새로 생성
    }
  }

  const ss = SpreadsheetApp.create(SHEET_FILE_NAME);
  props.setProperty(SHEET_ID_PROP, ss.getId());

  // 명함 앱 Drive 폴더로 이동 (선택사항, 정리용)
  try {
    const root = getRootFolder();
    const file = DriveApp.getFileById(ss.getId());
    root.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  } catch (e) {
    // 이동 실패해도 무시하고 진행
  }

  return ss;
}

function getOrCreateSheet() {
  const ss = getSpreadsheet();

  // 1순위: 고정된 이름("명함")으로 정확히 찾기 (매물뷰 앱과 동일한 방식, 탭 순서 무관)
  let sheet = ss.getSheetByName(CARD_SHEET_NAME);

  if (!sheet) {
    // 이 앱이 처음 만든 시트라면, "비번" 탭이 아닌 시트를 찾아서 이름을 "명함"으로 고정
    sheet = ss.getSheets().find(s => s.getName() !== '비번');
    if (sheet) {
      sheet.setName(CARD_SHEET_NAME);
    } else {
      sheet = ss.insertSheet(CARD_SHEET_NAME);
    }
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CARD_COLUMNS);
    sheet.setFrozenRows(1);
  } else {
    // 이미 데이터가 있는 기존 시트에 없는 컬럼이 있으면 뒤에 자동 추가
    ['연락처', '매물번호', 'ID'].forEach(col => {
      const lastCol = sheet.getLastColumn();
      const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      if (headerRow.indexOf(col) === -1) {
        sheet.getRange(1, lastCol + 1).setValue(col);
      }
    });
  }
  return sheet;
}

// "설정" 탭에서 비밀번호를 관리 (A1 셀 값만 바꾸면 재배포 없이 바로 반영됨)
function getSettingsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('비번');
  if (!sheet) {
    sheet = ss.insertSheet('비번');
    sheet.getRange('A1').setValue(DEFAULT_APP_PASSWORD);
    sheet.getRange('B1').setValue('← 이 A1 셀 값을 바꾸면 앱 잠금 비밀번호가 바로 바뀝니다');
  }
  return sheet;
}

function getAppPassword() {
  const sheet = getSettingsSheet();
  const value = sheet.getRange('A1').getValue();
  const pass = String(value).trim();
  return pass || DEFAULT_APP_PASSWORD;
}

// ---------- 명함 저장 메인 로직 ----------

function saveCard(data) {
  // data: { name, company, title, group, subgroup, subsubgroup, imageBase64, mimeType, phone, propertyNo }

  if (!data.name) {
    return { success: false, error: '이름은 필수입니다.' };
  }
  if (!data.group) {
    return { success: false, error: '그룹은 필수입니다.' };
  }
  if (!data.imageBase64) {
    return { success: false, error: '사진이 없습니다.' };
  }

  const root = getRootFolder();
  let targetFolder = getOrCreateSubfolder(root, data.group);
  targetFolder = getOrCreateSubfolder(targetFolder, data.subgroup);
  targetFolder = getOrCreateSubfolder(targetFolder, data.subsubgroup);

  // 파일명 생성: 회사명_직함_이름_yyMMdd
  const now = new Date();
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd');
  const nameParts = [];
  if (data.company) nameParts.push(data.company);
  if (data.title) nameParts.push(data.title);
  nameParts.push(data.name);
  nameParts.push(dateStr);
  const fileName = nameParts.join('_');

  // 이미지 디코딩 및 저장
  const base64Data = data.imageBase64.split(',').pop();
  const mimeType = data.mimeType || 'image/jpeg';
  const ext = mimeType.split('/')[1] || 'jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName + '.' + ext);
  const file = targetFolder.createFile(blob);

  // 목록 화면에서 썸네일을 볼 수 있도록 "링크가 있으면 볼 수 있음"으로 공유 설정
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // 공유 설정 실패해도 저장 자체는 계속 진행
  }

  const id = Utilities.getUuid();

  // Sheets 기록
  const sheet = getOrCreateSheet();
  sheet.appendRow([
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    data.group || '',
    data.subgroup || '',
    data.subsubgroup || '',
    data.name || '',
    data.company || '',
    data.title || '',
    fileName,
    file.getUrl(),
    file.getId(),
    data.phone || '',
    data.propertyNo || '',
    id
  ]);

  return { success: true, fileUrl: file.getUrl(), fileName: fileName, id: id };
}

// ---------- 명함 수정 ----------

// ID로 시트에서 행 번호(1-based, 헤더 포함)를 찾음. 못 찾으면 -1
function findRowById(sheet, id) {
  if (!id) return -1;
  const values = sheet.getDataRange().getValues();
  const idCol = CARD_COLUMNS.indexOf('ID');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) return i + 1; // 시트 행 번호는 1-based, 헤더가 1행
  }
  return -1;
}

function updateCard(data) {
  // data: { id, name, company, title, group, subgroup, subsubgroup, phone, propertyNo, imageBase64?, mimeType? }
  if (!data.id) return { success: false, error: '수정할 명함을 찾을 수 없습니다.' };
  if (!data.name) return { success: false, error: '이름은 필수입니다.' };
  if (!data.group) return { success: false, error: '그룹은 필수입니다.' };

  const sheet = getOrCreateSheet();
  const rowIndex = findRowById(sheet, data.id);
  if (rowIndex === -1) return { success: false, error: '수정할 명함을 찾을 수 없습니다.' };

  const existingRow = sheet.getRange(rowIndex, 1, 1, CARD_COLUMNS.length).getValues()[0];
  let fileName = existingRow[CARD_COLUMNS.indexOf('파일명')];
  let fileUrl = existingRow[CARD_COLUMNS.indexOf('사진링크')];
  let fileId = existingRow[CARD_COLUMNS.indexOf('파일ID')];

  // 새 사진이 첨부된 경우: 새 파일 업로드 후 기존 파일은 휴지통으로 이동
  if (data.imageBase64) {
    const root = getRootFolder();
    let targetFolder = getOrCreateSubfolder(root, data.group);
    targetFolder = getOrCreateSubfolder(targetFolder, data.subgroup);
    targetFolder = getOrCreateSubfolder(targetFolder, data.subsubgroup);

    const now = new Date();
    const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd');
    const nameParts = [];
    if (data.company) nameParts.push(data.company);
    if (data.title) nameParts.push(data.title);
    nameParts.push(data.name);
    nameParts.push(dateStr);
    const newFileName = nameParts.join('_');

    const base64Data = data.imageBase64.split(',').pop();
    const mimeType = data.mimeType || 'image/jpeg';
    const ext = mimeType.split('/')[1] || 'jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, newFileName + '.' + ext);
    const newFile = targetFolder.createFile(blob);
    try {
      newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}

    if (fileId) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
    }

    fileName = newFileName;
    fileUrl = newFile.getUrl();
    fileId = newFile.getId();
  }

  const updatedRow = [
    existingRow[CARD_COLUMNS.indexOf('등록일시')], // 등록일시는 최초 등록 시각 유지
    data.group || '',
    data.subgroup || '',
    data.subsubgroup || '',
    data.name || '',
    data.company || '',
    data.title || '',
    fileName,
    fileUrl,
    fileId,
    data.phone || '',
    data.propertyNo || '',
    data.id
  ];

  sheet.getRange(rowIndex, 1, 1, CARD_COLUMNS.length).setValues([updatedRow]);

  return { success: true };
}

// ---------- 명함 삭제 ----------

function deleteCard(data) {
  // data: { id, trashPhoto } — trashPhoto 기본값 true (사진을 드라이브 휴지통으로 이동)
  if (!data.id) return { success: false, error: '삭제할 명함을 찾을 수 없습니다.' };

  const sheet = getOrCreateSheet();
  const rowIndex = findRowById(sheet, data.id);
  if (rowIndex === -1) return { success: false, error: '삭제할 명함을 찾을 수 없습니다.' };

  const fileId = sheet.getRange(rowIndex, CARD_COLUMNS.indexOf('파일ID') + 1).getValue();
  const trashPhoto = data.trashPhoto !== false;

  if (trashPhoto && fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  }

  sheet.deleteRow(rowIndex);

  return { success: true };
}

// ---------- 매물번호 일괄 반영 ----------

function normalizePhone(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

function looksLikePhone(v) {
  return /^[0-9\-+\s]+$/.test(String(v).trim()) && normalizePhone(v).length >= 4;
}

// data: { mappings: [{ query: '이름 또는 전화번호', propertyNo: 'P-1042,P-1043' }, ...] }
function bulkUpdateProperty(data) {
  if (!data.mappings || !Array.isArray(data.mappings)) {
    return { success: false, error: '매핑 데이터가 없습니다.' };
  }

  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, results: [] };

  const values = sheet.getRange(2, 1, lastRow - 1, CARD_COLUMNS.length).getValues();
  const nameCol = CARD_COLUMNS.indexOf('이름');
  const phoneCol = CARD_COLUMNS.indexOf('연락처');
  const companyCol = CARD_COLUMNS.indexOf('회사명');
  const propCol = CARD_COLUMNS.indexOf('매물번호');

  const results = [];

  data.mappings.forEach(m => {
    const query = String(m.query || '').trim();
    if (!query) return;

    let matchedRows = [];
    if (looksLikePhone(query)) {
      const qPhone = normalizePhone(query);
      matchedRows = values.map((row, i) => ({ row, i }))
        .filter(({ row }) => normalizePhone(row[phoneCol]) === qPhone && qPhone.length > 0);
    } else {
      matchedRows = values.map((row, i) => ({ row, i }))
        .filter(({ row }) => String(row[nameCol]).trim() === query);
    }

    if (matchedRows.length === 0) {
      results.push({ query: query, status: 'not_found' });
    } else if (matchedRows.length > 1) {
      results.push({
        query: query,
        status: 'ambiguous',
        matches: matchedRows.map(({ row }) => ({ name: row[nameCol], company: row[companyCol], phone: row[phoneCol] }))
      });
    } else {
      const sheetRow = matchedRows[0].i + 2; // 헤더 + 0-based → 실제 시트 행
      sheet.getRange(sheetRow, propCol + 1).setValue(m.propertyNo || '');
      results.push({
        query: query,
        status: 'updated',
        name: matchedRows[0].row[nameCol],
        company: matchedRows[0].row[companyCol],
        propertyNo: m.propertyNo || ''
      });
    }
  });

  return { success: true, results: results };
}

// ========================================
// 기존 외장하드 명함 데이터 마이그레이션 (일회성 실행용)
// ========================================
// 사용법:
// 1. 외장하드의 명함사진 폴더 구조를 통째로 "09. eXp_KJH_명함사진" Drive 폴더 안에 업로드
// 2. Apps Script 편집기에서 함수 목록 중 migrateExistingCards 선택 후 "실행" 버튼 클릭
// 3. 실행 로그(보기 → 로그)에서 결과 확인
// 4. 여러 번 실행해도 이미 등록된 파일은 건너뛰므로 안전합니다 (중복 저장 안 됨)

function normalizeFolderName(name) {
  return name.replace(/^\d+\.\s*/, '').trim();
}

function isImageFile(file) {
  return file.getMimeType().indexOf('image/') === 0;
}

function migrateExistingCards() {
  const root = getRootFolder();
  const sheet = getOrCreateSheet();
  const existingRows = sheet.getDataRange().getValues();
  const existingIds = new Set(existingRows.slice(1).map(r => r[9]).filter(Boolean));

  let added = 0;
  let skipped = 0;

  function indexFile(file, group, subgroup, subsubgroup) {
    if (existingIds.has(file.getId())) { skipped++; return; }

    const nameWithoutExt = file.getName().replace(/\.[^/.]+$/, '');
    const tokens = nameWithoutExt.split('_').map(t => t.trim()).filter(Boolean);
    let company = '', title = '', name = '', dateStr = '';

    if (tokens.length > 0 && /^\d{6}$/.test(tokens[tokens.length - 1])) {
      dateStr = tokens.pop();
    }
    if (tokens.length > 0) {
      name = tokens.pop();
    }
    if (tokens.length === 2) {
      company = tokens[0];
      title = tokens[1];
    } else if (tokens.length === 1) {
      company = tokens[0];
    } else if (tokens.length > 2) {
      company = tokens.join(' ');
    }
    if (!name) name = nameWithoutExt;

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}

    const registeredDate = dateStr
      ? '20' + dateStr.substring(0, 2) + '-' + dateStr.substring(2, 4) + '-' + dateStr.substring(4, 6)
      : Utilities.formatDate(file.getDateCreated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    sheet.appendRow([
      registeredDate, group, subgroup, subsubgroup,
      name, company, title, nameWithoutExt, file.getUrl(), file.getId(), '', '', Utilities.getUuid()
    ]);
    existingIds.add(file.getId());
    added++;
  }

  function scanFiles(folder, group, subgroup, subsubgroup) {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (isImageFile(file)) indexFile(file, group, subgroup, subsubgroup);
    }
  }

  const topFolders = root.getFolders();
  while (topFolders.hasNext()) {
    const folder = topFolders.next();
    const normTop = normalizeFolderName(folder.getName());
    const groupKey = Object.keys(GROUP_STRUCTURE).find(k => normalizeFolderName(k) === normTop);
    if (!groupKey) continue;

    scanFiles(folder, groupKey, '', '');

    const subStructure = GROUP_STRUCTURE[groupKey];
    if (subStructure && typeof subStructure === 'object') {
      const subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        const subFolder = subFolders.next();
        const normSub = normalizeFolderName(subFolder.getName());
        const subKey = Object.keys(subStructure).find(k => normalizeFolderName(k) === normSub);
        if (!subKey) continue;

        scanFiles(subFolder, groupKey, subKey, '');

        const subsubList = subStructure[subKey];
        if (Array.isArray(subsubList)) {
          const subsubFolders = subFolder.getFolders();
          while (subsubFolders.hasNext()) {
            const ssFolder = subsubFolders.next();
            const normSS = normalizeFolderName(ssFolder.getName());
            const ssKey = subsubList.find(s => normalizeFolderName(s) === normSS);
            if (!ssKey) continue;

            scanFiles(ssFolder, groupKey, subKey, ssKey);
          }
        }
      }
    }
  }

  Logger.log('마이그레이션 완료 — 추가됨: ' + added + '건, 이미 등록되어 건너뜀: ' + skipped + '건');
}

// ---------- 저장된 명함 목록 조회 ----------

function getCards() {
  const sheet = getOrCreateSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const idCol = CARD_COLUMNS.indexOf('ID');
  let needsIdBackfill = false;

  // ID가 비어있는 기존 행이 있으면 자동으로 채워서 저장 (최초 1회만 실행됨)
  for (let i = 1; i < values.length; i++) {
    if (!values[i][idCol]) {
      values[i][idCol] = Utilities.getUuid();
      needsIdBackfill = true;
    }
  }
  if (needsIdBackfill) {
    sheet.getRange(2, idCol + 1, values.length - 1, 1).setValues(
      values.slice(1).map(row => [row[idCol]])
    );
  }

  const rows = values.slice(1); // 헤더 제외
  // 최신 등록 순으로 정렬
  rows.reverse();

  return rows.map(row => ({
    date: row[0],
    group: row[1],
    subgroup: row[2],
    subsubgroup: row[3],
    name: row[4],
    company: row[5],
    title: row[6],
    fileName: row[7],
    fileUrl: row[8],
    fileId: row[9],
    phone: row[10],
    propertyNo: row[11],
    id: row[idCol]
  })).filter(card => card.name); // 빈 행 제외
}
