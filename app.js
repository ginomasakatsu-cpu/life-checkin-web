const STORAGE_KEY = "life-checkin-web-records-v1";
const PLACE = {
  name: "合肥工业大学屯溪路校区",
  address: "安徽省合肥市包河区屯溪路 193 号",
  latitude: 31.843559,
  longitude: 117.295754,
};

const state = {
  currentTime: new Date(),
  selectedImages: [],
  records: [],
  selectedRecordId: null,
};

const els = {
  tabs: document.querySelectorAll(".tab-button"),
  views: document.querySelectorAll(".view"),
  form: document.querySelector("#checkin-form"),
  currentTime: document.querySelector("#current-time"),
  refreshTime: document.querySelector("#refresh-time"),
  resetForm: document.querySelector("#reset-form"),
  scoreInputs: document.querySelectorAll("[data-score]"),
  liveAverage: document.querySelector("#live-average"),
  imageInput: document.querySelector("#image-input"),
  previewGrid: document.querySelector("#image-preview-grid"),
  noteInput: document.querySelector("#note-input"),
  historyList: document.querySelector("#history-list"),
  detailPanel: document.querySelector("#detail-panel"),
  clearRecords: document.querySelector("#clear-records"),
  toast: document.querySelector("#toast"),
  emptyHistoryTemplate: document.querySelector("#empty-history-template"),
};

function init() {
  state.records = loadRecords();
  state.selectedRecordId = state.records[0]?.id ?? null;
  bindEvents();
  renderTime();
  renderScores();
  renderImagePreviews();
  renderHistory();
  renderDetail();
}

function bindEvents() {
  els.tabs.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  els.refreshTime.addEventListener("click", () => {
    state.currentTime = new Date();
    renderTime();
  });

  els.resetForm.addEventListener("click", resetForm);

  els.scoreInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.closest(".score-row").querySelector("output").value = input.value;
      renderScores();
    });
  });

  els.imageInput.addEventListener("change", handleImageSelection);
  els.form.addEventListener("submit", handleSave);
  els.clearRecords.addEventListener("click", clearRecords);
}

function setView(viewName) {
  els.tabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });

  els.views.forEach((view) => {
    view.classList.toggle("is-active", view.id === `${viewName}-view`);
  });
}

function renderTime() {
  els.currentTime.textContent = formatDateTime(state.currentTime);
  els.currentTime.dateTime = state.currentTime.toISOString();
}

function renderScores() {
  const average = getCurrentScoreItems().reduce((sum, item) => sum + item.score, 0) / els.scoreInputs.length;
  els.liveAverage.textContent = `平均 ${average.toFixed(1)}`;
}

function getCurrentScoreItems() {
  return Array.from(els.scoreInputs).map((input) => ({
    tagName: input.dataset.score,
    score: Number(input.value),
  }));
}

async function handleImageSelection(event) {
  const files = Array.from(event.target.files || []).slice(0, 3);

  try {
    state.selectedImages = await Promise.all(files.map(readImageFile));
    renderImagePreviews();
    if ((event.target.files || []).length > 3) {
      showToast("最多保留前 3 张图片");
    }
  } catch (error) {
    state.selectedImages = [];
    renderImagePreviews();
    showToast("图片读取失败，请重新选择");
  } finally {
    event.target.value = "";
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: reader.result,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  els.previewGrid.innerHTML = "";

  state.selectedImages.forEach((image) => {
    const card = document.createElement("div");
    card.className = "image-thumb";
    card.innerHTML = `
      <img src="${image.dataUrl}" alt="${escapeHtml(image.name)}" />
      <button type="button" aria-label="移除图片">×</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      state.selectedImages = state.selectedImages.filter((item) => item.id !== image.id);
      renderImagePreviews();
    });
    els.previewGrid.appendChild(card);
  });
}

function handleSave(event) {
  event.preventDefault();

  const record = {
    id: crypto.randomUUID(),
    place: PLACE,
    checkInTime: state.currentTime.toISOString(),
    scoreItems: getCurrentScoreItems(),
    imagePaths: state.selectedImages.map((image) => image.dataUrl),
    imageNames: state.selectedImages.map((image) => image.name),
    note: els.noteInput.value.trim(),
  };

  state.records = [record, ...state.records].sort((a, b) => new Date(b.checkInTime) - new Date(a.checkInTime));
  state.selectedRecordId = record.id;
  saveRecords();
  resetForm();
  renderHistory();
  renderDetail();
  setView("history");
  showToast("打卡已保存");
}

function resetForm() {
  state.currentTime = new Date();
  state.selectedImages = [];
  els.noteInput.value = "";
  els.scoreInputs.forEach((input) => {
    input.value = "8";
    input.closest(".score-row").querySelector("output").value = "8";
  });
  renderTime();
  renderScores();
  renderImagePreviews();
}

function renderHistory() {
  els.historyList.innerHTML = "";

  if (state.records.length === 0) {
    els.historyList.appendChild(els.emptyHistoryTemplate.content.cloneNode(true));
    return;
  }

  state.records.forEach((record) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `record-card${record.id === state.selectedRecordId ? " is-selected" : ""}`;
    button.innerHTML = `
      <div class="record-thumb">
        ${record.imagePaths[0] ? `<img src="${record.imagePaths[0]}" alt="打卡图片缩略图" />` : "<span aria-hidden=\"true\">⌖</span>"}
      </div>
      <div class="record-meta">
        <span class="record-title">${escapeHtml(record.place.name)}</span>
        <span class="record-time">${formatDateTime(new Date(record.checkInTime))}</span>
        ${record.note ? `<span class="record-note">${escapeHtml(record.note)}</span>` : ""}
      </div>
      <span class="record-score">${averageScore(record).toFixed(1)}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedRecordId = record.id;
      renderHistory();
      renderDetail();
    });
    els.historyList.appendChild(button);
  });
}

function renderDetail() {
  const record = state.records.find((item) => item.id === state.selectedRecordId);

  if (!record) {
    els.detailPanel.innerHTML = `
      <div class="empty-detail">
        <span aria-hidden="true">⌖</span>
        <p>选择一条记录查看详情</p>
      </div>
    `;
    return;
  }

  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <h3>${escapeHtml(record.place.name)}</h3>
        <p>${formatDateTime(new Date(record.checkInTime))}</p>
      </div>
      <span class="detail-score">${averageScore(record).toFixed(1)}</span>
    </div>

    <section class="detail-section">
      <h4>地点与坐标</h4>
      <div class="detail-grid">
        <div class="detail-field"><span>地址</span><span>${escapeHtml(record.place.address)}</span></div>
        <div class="detail-field"><span>纬度</span><span>${record.place.latitude.toFixed(6)}</span></div>
        <div class="detail-field"><span>经度</span><span>${record.place.longitude.toFixed(6)}</span></div>
        <div class="detail-field"><span>图片</span><span>${record.imagePaths.length} 张</span></div>
      </div>
    </section>

    <section class="detail-section">
      <h4>评分明细</h4>
      <div class="detail-grid">
        ${record.scoreItems
          .map(
            (item) => `
              <div class="detail-field">
                <span>${escapeHtml(item.tagName)}</span>
                <span>${item.score} 分</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>

    ${
      record.imagePaths.length
        ? `<section class="detail-section">
            <h4>图片</h4>
            <div class="detail-images">
              ${record.imagePaths
                .map((src, index) => `<img src="${src}" alt="${escapeHtml(record.imageNames[index] || "打卡图片")}" />`)
                .join("")}
            </div>
          </section>`
        : ""
    }

    ${
      record.note
        ? `<section class="detail-section">
            <h4>备注</h4>
            <p>${escapeHtml(record.note)}</p>
          </section>`
        : ""
    }
  `;
}

function clearRecords() {
  if (state.records.length === 0) {
    showToast("当前没有记录");
    return;
  }

  const confirmed = window.confirm("确认清空所有本地 Web 原型记录？");
  if (!confirmed) return;

  state.records = [];
  state.selectedRecordId = null;
  saveRecords();
  renderHistory();
  renderDetail();
  showToast("记录已清空");
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => new Date(b.checkInTime) - new Date(a.checkInTime));
  } catch {
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function averageScore(record) {
  if (!record.scoreItems.length) return 0;
  const sum = record.scoreItems.reduce((total, item) => total + Number(item.score), 0);
  return sum / record.scoreItems.length;
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

init();
