// hacklife:// is registered by run.bat. Navigating the current tab to it makes
// Chrome ask to open the app and leaves the page as it was.
const APP_URL = "hacklife://open";

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) {
    chrome.tabs.create({ url: APP_URL });
  } else {
    chrome.tabs.update(tab.id, { url: APP_URL });
  }
});
