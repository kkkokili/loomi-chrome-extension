const DEFAULT_CONFIG = {
  sleepTime: "22:00",
  goal: "Finish your MVP",
  restrictedSites: ["youtube.com", "bilibili.com"],
  fragmentReminderInterval: 1,
};

const siteTags = document.getElementById("siteTags");
const siteInput = document.getElementById("siteInput");
const addSiteBtn = document.getElementById("addSiteBtn");

let restrictedSites = [];
const intervalInput = document.getElementById("intervalInput");
const saveBtn = document.getElementById("saveBtn");
const statusText = document.getElementById("statusText");

async function loadConfig() {
  const result = await chrome.storage.local.get(["config"]);
  const config = {
    ...DEFAULT_CONFIG,
    ...(result.config || {}),
  };

  restrictedSites = config.restrictedSites || [];
  intervalInput.value = config.fragmentReminderInterval;

  renderSiteTags();
}

function normalizeSite(site) {
  return site
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

async function saveConfig() {
  const interval = Number(intervalInput.value) || 1;

  const origins = restrictedSites.flatMap((site) => [
    `https://*.${site}/*`,
    `http://*.${site}/*`,
  ]);

  const granted = await chrome.permissions.request({
    origins,
  });

  if (!granted) {
    statusText.textContent = "Permission not granted";
    return;
  }

  const result = await chrome.storage.local.get(["config"]);

  const config = {
    ...DEFAULT_CONFIG,
    ...(result.config || {}),
    restrictedSites,
    fragmentReminderInterval: interval,
  };

  await chrome.storage.local.set({ config });

  statusText.textContent = "Saved";

  setTimeout(() => {
    statusText.textContent = "";
  }, 1200);
}

saveBtn.addEventListener("click", saveConfig);
loadConfig();

function renderSiteTags() {
  siteTags.innerHTML = "";

  restrictedSites.forEach((site) => {
    const tag = document.createElement("div");
    tag.className = "site-tag";

    tag.innerHTML = `
      <span>${site}</span>
      <button type="button" data-site="${site}">×</button>
    `;

    siteTags.appendChild(tag);
  });

  siteTags.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const site = button.dataset.site;
      restrictedSites = restrictedSites.filter((item) => item !== site);
      renderSiteTags();
    });
  });
}

function addSiteFromInput() {
  const site = normalizeSite(siteInput.value);

  if (!site) return;

  if (!restrictedSites.includes(site)) {
    restrictedSites.push(site);
  }

  siteInput.value = "";
  renderSiteTags();
}

addSiteBtn.addEventListener("click", addSiteFromInput);

siteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addSiteFromInput();
  }
});
