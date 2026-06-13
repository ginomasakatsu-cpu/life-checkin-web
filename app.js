const STORAGE_KEY = "life-checkin-web-records-v1";
const DEFAULT_LOCATION_SOURCE = {
  method: "manual",
  label: "手动输入",
  capturedAt: null,
};
const REVERSE_GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";

const state = {
  currentTime: new Date(),
  locationSource: { ...DEFAULT_LOCATION_SOURCE },
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
  placeInput: document.querySelector("#place-input"),
  useLocation: document.querySelector("#use-location"),
  locationStatus: document.querySelector("#location-status"),
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
  renderLocationStatus();
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
  els.useLocation.addEventListener("click", handleUseLocation);

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

function renderLocationStatus(status = state.locationSource.label, tone = "neutral") {
  els.locationStatus.textContent = status;
  els.locationStatus.classList.toggle("is-success", tone === "success");
  els.locationStatus.classList.toggle("is-error", tone === "error");
}

async function handleUseLocation() {
  if (!window.isSecureContext) {
    renderLocationStatus("定位需要 HTTPS", "error");
    showToast("定位需要 HTTPS 环境，请手动输入地点");
    return;
  }

  if (!("geolocation" in navigator)) {
    renderLocationStatus("当前浏览器不支持定位", "error");
    showToast("当前浏览器不支持定位，请手动输入地点");
    return;
  }

  els.useLocation.disabled = true;
  renderLocationStatus("定位中...");

  let position;
  try {
    position = await getBrowserPosition();
  } catch {
    state.locationSource = { ...DEFAULT_LOCATION_SOURCE };
    renderLocationStatus("定位失败，请手动输入", "error");
    showToast("定位失败，请手动输入地点");
    els.useLocation.disabled = false;
    return;
  }

  state.locationSource = {
    method: "browser",
    label: "浏览器定位",
    capturedAt: new Date().toISOString(),
  };
  renderLocationStatus("解析地址中...");

  try {
    const address = await reverseGeocode(position.coords);
    els.placeInput.value = address || "当前位置";
    renderLocationStatus(address ? "已填入具体地址" : "已定位，可编辑地点", "success");
    showToast(address ? "已填入当前位置地址" : "已获取当前位置");
  } catch {
    els.placeInput.value = "当前位置";
    renderLocationStatus("地址解析失败，可编辑", "error");
    showToast("已定位，但地址解析失败，可手动修改");
  } finally {
    els.useLocation.disabled = false;
  }
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000,
    });
  });
}

async function reverseGeocode(coords) {
  const url = new URL(REVERSE_GEOCODE_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(coords.latitude));
  url.searchParams.set("lon", String(coords.longitude));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "zh-CN");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error("Reverse geocoding failed");
  }

  const data = await response.json();
  return formatAddress(data);
}

function formatAddress(data) {
  if (typeof data?.display_name === "string") {
    return data.display_name.trim();
  }

  const address = data?.address;
  if (!address) return "";

  return [
    address.amenity,
    address.building,
    address.road,
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.city || address.town || address.village,
    address.state,
    address.country,
  ]
    .filter(Boolean)
    .filter((value, index, parts) => parts.indexOf(value) === index)
    .join("，");
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

  const placeName = els.placeInput.value.trim();
  if (!placeName) {
    els.placeInput.focus();
    showToast("请先输入地点或使用当前位置");
    return;
  }

  const record = {
    id: crypto.randomUUID(),
    place: {
      name: placeName,
      source: state.locationSource.method,
      sourceLabel: state.locationSource.label,
      capturedAt: state.locationSource.capturedAt,
    },
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
  state.locationSource = { ...DEFAULT_LOCATION_SOURCE };
  state.selectedImages = [];
  els.placeInput.value = "";
  els.noteInput.value = "";
  els.scoreInputs.forEach((input) => {
    input.value = "8";
    input.closest(".score-row").querySelector("output").value = "8";
  });
  renderTime();
  renderLocationStatus();
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
    const place = getRecordPlace(record);
    const imagePaths = record.imagePaths || [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `record-card${record.id === state.selectedRecordId ? " is-selected" : ""}`;
    button.innerHTML = `
      <div class="record-thumb">
        ${imagePaths[0] ? `<img src="${imagePaths[0]}" alt="打卡图片缩略图" />` : "<span aria-hidden=\"true\">⌖</span>"}
      </div>
      <div class="record-meta">
        <span class="record-title">${escapeHtml(place.name)}</span>
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

  const place = getRecordPlace(record);
  const imagePaths = record.imagePaths || [];
  const imageNames = record.imageNames || [];
  const placeFields = getPlaceDetailFields(place, record);

  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <h3>${escapeHtml(place.name)}</h3>
        <p>${formatDateTime(new Date(record.checkInTime))}</p>
      </div>
      <span class="detail-score">${averageScore(record).toFixed(1)}</span>
    </div>

    <section class="detail-section">
      <h4>地点信息</h4>
      <div class="detail-grid">
        ${placeFields}
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
      imagePaths.length
        ? `<section class="detail-section">
            <h4>图片</h4>
            <div class="detail-images">
              ${imagePaths
                .map((src, index) => `<img src="${src}" alt="${escapeHtml(imageNames[index] || "打卡图片")}" />`)
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

function getRecordPlace(record) {
  const place = record.place || {};
  const hasLegacyCoordinates = Number.isFinite(place.latitude) || Number.isFinite(place.longitude);

  return {
    name: place.name || "未命名地点",
    address: place.address || "",
    sourceLabel: place.sourceLabel || (hasLegacyCoordinates ? "旧版记录" : "手动输入"),
    capturedAt: place.capturedAt || null,
  };
}

function getPlaceDetailFields(place, record) {
  const fields = [
    ["地点", place.name],
    ["记录方式", place.sourceLabel],
  ];

  if (place.address) {
    fields.push(["地址", place.address]);
  }

  if (place.capturedAt) {
    fields.push(["定位时间", formatDateTime(new Date(place.capturedAt))]);
  }

  fields.push(["图片", `${(record.imagePaths || []).length} 张`]);

  return fields
    .map(
      ([label, value]) => `
        <div class="detail-field">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(value)}</span>
        </div>
      `,
    )
    .join("");
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
