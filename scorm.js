const SCORM = {
  api: null,
  initialized: false,

  findAPI(win) {
    let tries = 0;
    while ((win.API == null) && (win.parent != null) && (win.parent != win)) {
      tries++;
      if (tries > 20) break;
      win = win.parent;
    }
    return win.API;
  },

  getAPI() {
    if (this.api) return this.api;
    this.api = this.findAPI(window);

    if (!this.api && window.opener) {
      this.api = this.findAPI(window.opener);
    }

    return this.api;
  },

  init() {
    const api = this.getAPI();
    if (!api) {
      console.warn("SCORM API not found. Running in standalone mode.");
      return false;
    }

    const result = api.LMSInitialize("");
    this.initialized = (result === "true");
    return this.initialized;
  },

  finish() {
    if (!this.initialized) return false;
    const result = this.api.LMSFinish("");
    return result === "true";
  },

  getValue(element) {
    if (!this.initialized) return "";
    return this.api.LMSGetValue(element);
  },

  setValue(element, value) {
    if (!this.initialized) return false;
    const result = this.api.LMSSetValue(element, value);
    return result === "true";
  },

  save() {
    if (!this.initialized) return false;
    const result = this.api.LMSCommit("");
    return result === "true";
  },

  getLastError() {
    if (!this.api) return "0";
    return this.api.LMSGetLastError();
  },

  getErrorString(errorCode) {
    if (!this.api) return "";
    return this.api.LMSGetErrorString(errorCode);
  },

  getDiagnostic(errorCode) {
    if (!this.api) return "";
    return this.api.LMSGetDiagnostic(errorCode);
  }
};
