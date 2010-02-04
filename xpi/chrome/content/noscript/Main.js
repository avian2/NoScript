const WP_STATE_START = CI.nsIWebProgressListener.STATE_START;
const WP_STATE_STOP = CI.nsIWebProgressListener.STATE_STOP;
const WP_STATE_DOC = CI.nsIWebProgressListener.STATE_IS_DOCUMENT;
const WP_STATE_START_DOC = WP_STATE_START | WP_STATE_DOC;
const WP_STATE_RESTORING = CI.nsIWebProgressListener.STATE_RESTORING;

const LF_VALIDATE_ALWAYS = CI.nsIRequest.VALIDATE_ALWAYS;
const LF_LOAD_BYPASS_ALL_CACHES = CI.nsIRequest.LOAD_BYPASS_CACHE | CI.nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE;

const NS_OK = 0;
const NS_BINDING_ABORTED = 0x804b0002;
const NS_BINDING_REDIRECTED = 0x804b0003;
const NS_ERROR_UNKNOWN_HOST = 0x804b001e;
const NS_ERROR_REDIRECT_LOOP = 0x804b001f;
const NS_ERROR_CONNECTION_REFUSED = 0x804b000e;
const NS_ERROR_NOT_AVAILABLE = 0x804b0111;

const LOG_CONTENT_BLOCK = 1;
const LOG_CONTENT_CALL = 2;
const LOG_CONTENT_INTERCEPT = 4;
const LOG_CHROME_WIN = 8;
const LOG_XSS_FILTER = 16;
const LOG_INJECTION_CHECK = 32;
const LOG_DOM = 64;
const LOG_JS = 128;
const LOG_LEAKS = 1024;
const LOG_SNIFF = 2048;
const LOG_CLEARCLICK = 4096;
const LOG_ABE = 8192;

const HTML_NS = "http://www.w3.org/1999/xhtml";

const WHERE_UNTRUSTED = 1;
const WHERE_TRUSTED = 2;
const ANYWHERE = 3;

const DUMMYOBJ = {};

INCLUDE('Sites', 'AddressMatcher', 'DOM', 'IOUtil', 'Policy', 'RequestWatchdog', 'HTTPS', 'ClearClickHandler', 'URIValidator', 'ScriptSurrogate', 'ABE');

var ns = singleton = {
  VERSION: VERSION
,
  QueryInterface: xpcom_generateQI(SERVICE_IIDS),
  generateQI: xpcom_generateQI
,
  // nsIObserver implementation 
  observe: function(subject, topic, data) {

    if (subject instanceof CI.nsIPrefBranch2) {
      this.syncPrefs(subject, data);
    } else {
      switch (topic) {
        case "xpcom-shutdown":
          this.unregister();
          break;
        
        case "profile-before-change": 
          this.dispose();
          Thread.hostRunning = false;
          break;
        case "profile-after-change":
          Thread.hostRunning = true;
          try {
            this.init();
          } catch(e) {
            this.dump("Init error -- " + e.message);
          }
          break;
        
        case "em-action-requested":
          if ((subject instanceof CI.nsIUpdateItem)
              && subject.id == EXTENSION_ID ) {
            if (data == "item-uninstalled" || data == "item-disabled") {
              this.uninstalling = true;
            } else if (data == "item-enabled") {
              this.uninstalling = false;
            }
          }
        break;
        
        case "toplevel-window-ready":
          this.registerToplevel(subject); 
        break;
      
        case "private-browsing":
          if (data == "enter") {
            STS.enterPrivateBrowsing();
          }
          if (data == "exit") {
            this.eraseTemp();
            STS.exitPrivateBrowsing();
          }
        // break; 
        case "browser:purge-session-history":
          this.recentlyBlocked = [];
          STS.eraseDB();
        break;
      }
    }
  },
  
  registerToplevel: function(window) {
    
    if ((window instanceof CI.nsIDOMChromeWindow) && !window.opener &&
       (window instanceof CI.nsIDOMNSEventTarget)) {
      window.isNewToplevel = true;
      if (this.consoleDump & LOG_CHROME_WIN) {
        this.dump("Toplevel register, true");
      }
      this.handleToplevel.ns = this;
      window.addEventListener("load", this.handleToplevel, false);
    }
  },
  handleToplevel: function(ev) {
    // this resets newtoplevel status to true after chrome
    const window = ev.currentTarget;
    const callee = arguments.callee;
    switch (ev.type) {
      case "load":
        window.removeEventListener("load", callee, false);
        window.addEventListener("unload", callee, false);
        ns.delayExec(callee, 0, { type: "timeout", currentTarget: window });
        break;
      case "timeout":
      case "unload":
        window.isNewToplevel = false;
        window.removeEventListener("unload", callee, false);
    }
    if (ns.consoleDump & LOG_CHROME_WIN) 
      ns.dump("Toplevel " + ev.type + ", " + window.isNewToplevel);
    
  },
  
  OBSERVED_TOPICS: ["profile-before-change", "xpcom-shutdown", "profile-after-change", "profile-after-change", "toplevel-window-ready",
                    "browser:purge-session-history", "private-browsing"],
  register: function() {
    this.OBSERVED_TOPICS.forEach(function(topic) {
      OS.addObserver(this, topic, true);
    }, this);
  },
  unregister: function() {
    this.OBSERVED_TOPICS.forEach(function(topic) {
      OS.removeObserver(this, topic);
    }, this);
  }
,
  
  // Preference driven properties
  autoAllow: false,

  blockNSWB: false,
  
  consoleDump: 0,
  consoleLog: false,
  
  truncateTitle: true,
  truncateTitleLen: 255,
  
  showPlaceholder: true,
  showUntrustedPlaceholder: true,
  collapseObject: false,
  abpRemoveTabs: false,
  opaqueObject: 1,
  clearClick: 3,

  
  forbidSomeContent: true,
  contentBlocker: false,
  
  forbidChromeScripts: false,
  forbidData: true,
  
  forbidJarDocuments: true,
  forbidJarDocumentsExceptions: null,
  
  forbidJava: true,
  forbidFlash: false,
  forbidFlash: true,
  forbidPlugins: true,
  forbidMedia: true,
  forbidFonts: true,
  forbidIFrames: false, 
  forbidIFramesContext: 2, // 0 = all iframes, 1 = different site, 2 = different domain, 3 = different base domain
  forbidFrames: false,
  
  alwaysBlockUntrustedContent: true,
  docShellJSBlocking: 1, // 0 - don't touch docShells, 1 - block untrusted, 2 - block not whitelisted
  
  forbidXBL: 4,
  forbidXHR: 2,
  injectionCheck: 2,
  injectionCheckSubframes: true,
  
  jsredirectIgnore: false,
  jsredirectFollow: false,
  jsredirectForceShow: false,
  emulateFrameBreak: true,
  
  jsHack: null,
  jsHackRegExp: null,
  
  flashPatch: true,
  silverlightPatch: true,
  
  nselNever: false,
  nselForce: true,

  filterXGetRx: "(?:<+(?=[^<>=\\d\\. ])|[\\\\'\"\\x00-\\x07\\x09\\x0B\\x0C\\x0E-\\x1F\\x7F])",
  filterXGetUserRx: "",
  
  
  whitelistRegExp: null,
  allowedMimeRegExp: null, 
  hideOnUnloadRegExp: null,
  requireReloadRegExp: null,
  ignorePorts: true,
  
  inclusionTypeChecking: true,
  
  resetDefaultPrefs: function(prefs, exclude) {
    exclude = exclude || [];
    var children = prefs.getChildList("", {});
    for (var j = children.length; j-- > 0;) {
      if (exclude.indexOf(children[j]) < 0) {
        if (prefs.prefHasUserValue(children[j])) {
          dump("Resetting noscript." + children[j] + "\n");
          try {
            prefs.clearUserPref(children[j]);
          } catch(e) { dump(e + "\n") }
        }
      }
    }
    this.savePrefs();
  },
  
  resetDefaultGeneralPrefs: function() {
    this.resetDefaultPrefs(this.prefs, ['version']);
  },
  
  resetDefaultSitePrefs: function() {
    this.eraseTemp();
    this.setJSEnabled(this.splitList(this.getPref("default")), true, true);
  },
  
  resetDefaults: function() {
    this.resetDefaultGeneralPrefs();
    this.jsEnabled = false;
    this.resetDefaultSitePrefs();
    ABE.resetDefaults();
  },
  
  syncPrefs: function(branch, name) {
    switch (name) {
      case "sites":
        if (this.jsPolicySites.settingPref) return;
        if (this.locked) this.defaultCaps.lockPref(this.POLICY_NAME + ".sites");
        if (!this.jsPolicySites.fromPref(this.policyPB)) {
          this.resetDefaultSitePrefs();
        }
        break;
      case "temp":
        this.tempSites.fromPref(branch, name);
      break;
      case "gtemp":
        this.gTempSites.fromPref(branch, name);
      break;
      case "untrusted":
        this.untrustedSites.fromPref(branch, name);
      break;
      case "default.javascript.enabled":
          if (dc.getCharPref(name) != "noAccess") {
            dc.unlockPref(name);
            dc.setCharPref(name, "noAccess");
          }
         dc.lockPref(name);
         break;
      case "enabled":
        try {
          this.mozJSEnabled = this.mozJSPref.getBoolPref("enabled");
        } catch(ex) {
          this.mozJSPref.setBoolPref("enabled", this.mozJSEnabled = true);
        }
      break;
      case "forbidJava":
      case "forbidFlash":
      case "forbidSilverlight":
      case "forbidPlugins":
      case "forbidMedia":
      case "forbidFonts":
      case "forbidIFrames":
      case "forbidFrames":
        this[name]=this.getPref(name, this[name]);
        this.forbidSomeContent = this.forbidJava || this.forbidFlash ||
          this.forbidSilverlight || this.forbidPlugins ||
          this.forbidMedia || this.forbidFonts ||
          this.forbidIFrames || this.forbidFrames;
      break;
      
      case "abp.removeTabs":
        this.abpRemoveTabs = this.abpInstalled && this.getPref(name);
      break;
    
      case "emulateFrameBreak":
      case "filterXPost":
      case "filterXGet":
      case "safeToplevel":
      case "autoAllow":
      case "contentBlocker":
      case "docShellJSBlocking":
      case "showUntrustedPlaceholder":
      case "collapseObject":
      case "truncateTitle":
      case "truncateTitleLen":
      case "forbidChromeScripts":
      case "forbidData":
      case "forbidJarDocuments":
      case "forbidMetaRefresh":
      case "forbidIFramesContext":
      case "forbidXBL":
      case "forbidXHR":
      case "ignorePorts":
      case "injectionCheck":
      case "jsredirectFollow":
      case "jsredirectIgnore":
      case "jsredirectForceShow":
      case "jsHack":
      case "consoleLog":
      case "flashPatch":
      case "silverlightPatch":
      case "inclusionTypeChecking":
        this[name] = this.getPref(name, this[name]);  
      break;
      
      case "clearClick.exceptions":
      case "clearClick.subexceptions":
        ClearClickHandler.prototype[name.split('.')[1]] = AddressMatcher.create(this.getPref(name, ''));
      break;
      
      case "secureCookies":
      case "allowHttpsOnly":
        HTTPS[name] = this.getPref(name, HTTPS[name]);  
      break;
      
    
    
      case "secureCookiesExceptions":
      case "secureCookiesForced":
      case "httpsForced":
      case "httpsForcedExceptions":
        HTTPS[name] = AddressMatcher.create(this.getPref(name, ''));
      break;
      
      case "proxiedDNS":
      case "asyncNetworking":
        IOUtil[name] = this.getPref(name, IOUtil[name]);
      break;
      
      case "ABE.enabled":
      case "ABE.siteEnabled":
      case "ABE.allowRulesetRedir":
      case "ABE.disabledRulesetNames":
      case "ABE.legacySupport":
      case "ABE.skipBrowserRequests":
        ABE[name.substring(4)] = this.getPref(name);
      break;
      
      case "STS.enabled":
        STS[name.substring(4)] = this.getPref(name);
      break;
      
      case "consoleDump":
        this[name] = this.getPref(name, this[name]);
        this.injectionChecker.logEnabled = this.consoleDump & LOG_INJECTION_CHECK;
        DOM.consoleDump = this.consoleDump & LOG_DOM;
        ABE.consoleDump = this.consoleDump & LOG_ABE;
      break;
      case "global":
        this.globalJS = this.getPref(name, false);
      break;
      
      case "alwaysBlockUntrustedContent":
        this[name] = this.getPref(name, this[name]);
        this.initContentPolicy();
      break;
      
      case "forbidMetaRefreshRemember":
        if (!this.getPref(name)) this.metaRefreshWhitelist = {};
      break;
      
      // single rx
      case "filterXGetRx":
      case "filterXGetUserRx":
        this.updateRxPref(name, this[name], "g");
      break;
      
      // multiple rx
      case "forbidJarDocumentsExceptions":
      case "filterXExceptions":
      case "jsHackRegExp":
        this.updateRxPref(name, "", "", this.rxParsers.multi);
      break;
      
      // multiple rx autoanchored
      case "hideOnUnloadRegExp":
        this.updateStyleSheet("." + this.hideObjClassName + " {display: none !important}", true);
      case "allowedMimeRegExp":
      case "requireReloadRegExp":
      case "whitelistRegExp":
        this.updateRxPref(name, "", "^", this.rxParsers.multi);
      break;
        
        
      case "safeJSRx":
        this.initSafeJSRx();
      break;
      
      case "allowClipboard":
        this.updateExtraPerm(name, "Clipboard", ["cutcopy", "paste"]);
      break;
      case "allowLocalLinks":
        this.updateExtraPerm(name, "checkloaduri", ["enabled"]);
      break;
      
      case "blockNSWB":
      case "nselForce":
      case "nselNever":
      case "showPlaceholder":
      case "opacizeObject":
      case "clearClick":
        this.updateCssPref(name);
        if ((name == "nselNever") && this.getPref("nselNever") && !this.blockNSWB) {
          this.setPref("blockNSWB", true);
        }
      break;
      
      case "policynames":
        this.setupJSCaps();
      break;
    }
  },
  
  rxParsers: {
    simple: function(s, flags) {
      var anchor = /\^/.test(flags);
      return new RegExp(anchor ? ns.rxParsers.anchor(s) : s,
        anchor ? flags.replace(/\^/g, '') : flags);
    },
    anchor: function(s) {
      return !/^\^|\$$/.test(s) ? s : "^" + s + "$";
    },
    multi: function(s, flags) {
      var anchor = /\^/.test(flags);
      var lines = s.split(/[\n\r]+/)
          .filter(function(l) { return /\S/.test(l) });
      return new RegExp(
        "(?:" +
        (anchor ? lines.map(ns.rxParsers.anchor) : lines).join('|')
        + ")",
        anchor ? flags.replace(/\^/g, '') : flags);
    }
  },
  updateRxPref: function(name, def, flags, parseRx) {
    parseRx = parseRx || this.rxParsers.simple;
    var s = this.getPref(name, def);
    if (!s) {
      this[name] = null;
    } else
    {
      
      try {
        this[name] = parseRx(this.getPref(name, def), flags);
      } catch(e) {
        if(this.consoleDump) this.dump("Error parsing regular expression " + name + ", " + e);
        this[name] = parseRx(def, flags);
      }
    }
  },
  
  
  updateExtraPerm: function(prefName, baseName, names) {
    var cpName;
    var enabled = this.getPref(prefName, false);
    for (var j = names.length; j-- > 0;) {
      cpName = this.POLICY_NAME + "." + baseName + "." + names[j];
      try {
        if (enabled) {
          this.caps.setCharPref(cpName, "allAccess");
        } else {
          if (this.caps.prefHasUserValue(cpName)) {
            this.caps.clearUserPref(cpName);
          }
        }
      } catch(ex) {}
    }
  },
  
  updateCssPref: function(name) {
    var value = this[name] = this.getPref(name);
    var sheet;
    switch(name) {
      case "nselForce":
        sheet = "noscript.noscript-show, span.noscript-show { display: inline !important } span.noscript-show { padding: 0px; margin: 0px; border: none; background: inherit; color: inherit }";
        break;
      case "nselNever":
        sheet = "noscript, noscript * { display: none !important }";
        break;
      case "blockNSWB": 
        sheet = "noscript, noscript * { background-image: none !important; list-style-image: none !important }";
        break;
      case "showPlaceholder": 
        sheet = '.__noscriptPlaceholder__ > .__noscriptPlaceholder__1 { display: inline-block !important; ' +
                'outline-color: #fc0 !important; outline-style: solid !important; outline-width: 1px !important; outline-offset: -1px !important;' +
                'cursor: pointer !important; background: #ffffe0 url("' + 
                    this.pluginPlaceholder + '") no-repeat left top !important; opacity: 0.6 !important; margin-top: 0px !important; margin-bottom: 0px !important;} ' +
                '.__noscriptPlaceholder__1 > .__noscriptPlaceholder__2 { display: inline-block !important; background-repeat: no-repeat !important; background-color: transparent !important; width: 100%; height: 100%; display: block; margin: 0px; border: none } ' +
                'noscript .__noscriptPlaceholder__ { display: inline !important; }';
        if (this.geckoVersionCheck("1.9") < 0) {
          sheet = sheet.replace(/ outline-/g, ' -moz-outline-').replace(/ inline-/g, '');
        }
      break;
      case "clearClick":
      case "opaqueObject":
        sheet = ".__noscriptOpaqued__ { opacity: 1 !important; visibility: visible; filter: none !important } " +
                "iframe.__noscriptOpaqued__ { display: block !important; } " +
                "object.__noscriptOpaqued__, embed.__noscriptOpaqued__ { display: inline !important } " +
                ".__noscriptJustOpaqued__ { opacity: 1 !important; filter: none !important } " +
                ".__noscriptScrolling__ { overflow: auto !important; min-width: 52px !important; min-height: 52px !important } " +
                ".__noscriptNoScrolling__ { overflow: hidden !important } " +
                ".__noscriptHidden__ { visibility: hidden !important } " +
                ".__noscriptBlank__ { background-color: white !important; color: white !important; border-color: white !important; background-image: none !important }";
                
      break;
      default:
        return;
    };
    this.updateStyleSheet(sheet, value);
  },
  
  get sss() {
    delete this.sss;
    try {
      return this.sss = CC["@mozilla.org/content/style-sheet-service;1"]
                        .getService(CI.nsIStyleSheetService);
    } catch(e) {
      return this.sss = null;
    }
  },
  
  updateStyleSheet: function(sheet, enabled) {
    const sss = this.sss;
    if (!sss) return;
    const uri = IOS.newURI("data:text/css;charset=utf8," + sheet, null, null);
    if (sss.sheetRegistered(uri, sss.USER_SHEET)) {
      if (!enabled) sss.unregisterSheet(uri, sss.USER_SHEET);
    } else {
      try {
        if (enabled) sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
      } catch(e) {
        this.log("[NoScript CSS] Can't register " + uri + ", " + e); 
      }
    }
  },
  
  get getString() {
    delete this.getString;
    INCLUDE('Strings');
    const ss = new Strings("noscript");
    return this.getString = function(name, parms) { return ss.getString(name, parms) };
  },
  
  _uninstalling: false,
  get uninstalling() {
    return this._uninstalling;
  },
  set uninstalling(b) {
    if (!this._uninstalling) {
      if (b) this.uninstallJob();
    } else {
      if (!b) this.undoUninstallJob();
    }
    return this._uninstalling = b;
  }
,
  _inited: false,
  POLICY_NAME: "maonoscript",
  prefService: null,
  caps: null,
  defaultCaps: null,
  policyPB: null,
  prefs: null,
  mozJSPref: null,
  mozJSEnabled: true,
  disabled: false
,
  // random resource aliases
  contentBase: null,
  skinBase: null,
  hideObjClassName: "__noscriptHideObj__",
  get hideObjClassNameRx() {
    const v = new RegExp("\\b" + this.hideObjClassName + "\\s*", "g");
    this.__defineGetter__("hideObjClassNameRx", function() { return v; });
    return v;
  },
  pluginPlaceholder: "",
  
  _initResources: function() {
    const ios = IOS;
    var resProt = ios.getProtocolHandler("resource").QueryInterface(CI.nsIResProtocolHandler);
    var base;
    for each(var r in ["skin", "content"]) {
      base = "noscript_" + Math.random();
      resProt.setSubstitution(base, ios.newURI("chrome:noscript/" + r + "/", null, null));
      this[r + "Base"] = "resource://" + base + "/";
    }
    this.pluginPlaceholder = this.skinBase + "icon32.png";
  },
  
  init: function() {
    if (this._inited) return false;
    
    this._inited = true;
    
    if (this.smUninstaller) this.smUninstaller.check();
    
    this._initResources();

    if (!this.requestWatchdog) {
      this.requestWatchdog = new RequestWatchdog()
    }
    
    OS.addObserver(this, "em-action-requested", true);
    
    const dls = CC['@mozilla.org/docloaderservice;1'].getService(CI.nsIWebProgress);
    dls.addProgressListener(this, CI.nsIWebProgress.NOTIFY_LOCATION | CI.nsIWebProgress.NOTIFY_STATE_REQUEST | CI.nsIWebProgress.NOTIFY_STATUS);


    const prefserv = this.prefService = CC["@mozilla.org/preferences-service;1"]
      .getService(CI.nsIPrefService).QueryInterface(CI.nsIPrefBranch);

    const PBI = CI.nsIPrefBranch2;
    this.caps = prefserv.getBranch("capability.policy.").QueryInterface(PBI);
    this.defaultCaps = prefserv.getDefaultBranch(this.caps.root);

    this.policyPB = prefserv.getBranch("capability.policy." + this.POLICY_NAME + ".").QueryInterface(PBI);
    this.prefs = prefserv.getBranch("noscript.").QueryInterface(PBI);
    
    this.policyPB.addObserver("sites", this, true);
    
    this.prefs.addObserver("", this, true);
    this.mozJSPref = prefserv.getBranch("javascript.").QueryInterface(PBI);
    this.mozJSPref.addObserver("enabled", this, true);
    
    this.mandatorySites.sitesString = this.getPref("mandatory", "chrome: about: resource:");
    
    this.captureExternalProtocols();
    
    for each(var p in [
      "autoAllow",
      "allowClipboard", "allowLocalLinks",
      "allowedMimeRegExp", "hideOnUnloadRegExp", "requireReloadRegExp",
      "blockNSWB",
      "consoleDump", "consoleLog", "contentBlocker",
      "docShellJSBlocking",
      "filterXPost", "filterXGet", 
      "filterXGetRx", "filterXGetUserRx", 
      "filterXExceptions",
      "forbidChromeScripts",
      "forbidJarDocuments", "forbidJarDocumentsExceptions",
      "forbidJava", "forbidFlash", "forbidSilverlight", "forbidPlugins", "forbidMedia", "forbidFonts",
      "forbidIFrames", "forbidIFramesContext", "forbidFrames", "forbidData",
      "forbidMetaRefresh",
      "forbidXBL", "forbidXHR",
      "inclusionTypeChecking",
      "alwaysBlockUntrustedContent",
      "global", "ignorePorts",
      "injectionCheck", "injectionCheckSubframes",
      "jsredirectIgnore", "jsredirectFollow", "jsredirectForceShow",
      "jsHack", "jsHackRegExp",
      "emulateFrameBreak",
      "nselNever", "nselForce",
      "clearClick", "clearClick.exceptions", "clearClick.subexceptions", "opaqueObject",
      "showPlaceholder", "showUntrustedPlaceholder", "collapseObject", "abp.removeTabs",
      "temp", "untrusted", "gtemp",
      "flashPatch", "silverlightPatch",
      "secureCookies", "secureCookiesExceptions", "secureCookiesForced",
      "httpsForced", "httpsForcedExceptions", "allowHttpsOnly",
      "truncateTitle", "truncateTitleLen",
      "whitelistRegExp", "proxiedDNS", "asyncNetworking",
      "ABE.enabled", "ABE.legacySupport", "ABE.siteEnabled", "ABE.allowRulesetRedir", "ABE.disabledRulesetNames", "ABE.skipBrowserRequests",
      "STS.enabled"
      ]) {
      try {
        this.syncPrefs(this.prefs, p);
      } catch(e) {
        dump("[NoScript init error] " + e.message + ":" + e.stack + " setting " + p + "\n");
      }
    }
    
    DNS.logEnabled = this.getPref("logDNS");
    
    this.setupJSCaps();
    
    // locking management
    if ((this.locked = this.prefs.prefIsLocked("default"))) {
      try {
        const psKey = this.POLICY_NAME + ".sites";
        const dc = this.defaultCaps;
        dc.lockPref("policynames");
        dc.unlockPref(psKey);
        this.resetDefaultSitePrefs();
        dc.setCharPref(psKey, this.policyPB.getCharPref("sites"));
        dc.lockPref(psKey);
        if (dc instanceof PBI) dc.addObserver("default.javascript.", this, true);
        dc.setCharPref("default.javascript.enabled", "noAccess");
        dc.lockPref("default.javascript.enabled");
        this.prefs.lockPref("global");
      } catch(e) {
        this.dump(e);
      }
    } else {
      // init jsPolicySites from prefs
      this.syncPrefs(this.policyPB, "sites");
    }
    
    this.syncPrefs(this.mozJSPref, "enabled");
    
    if (this.getPref("tempGlobal", false))
      this.jsEnabled = false;
    
    this.eraseTemp();
    
    this.reloadWhereNeeded(); // init snapshot
    
    this.savePrefs(true); // flush preferences to file

    // hook on redirections (non persistent, otherwise crashes on 1.8.x)
    CC['@mozilla.org/categorymanager;1'].getService(CI.nsICategoryManager)
      .addCategoryEntry("net-channel-event-sinks", SERVICE_CTRID, SERVICE_CTRID, false, true);
        
    return true;
  },
  
  
  
  dispose: function() {
    try {
      if(!this._inited) return;
      this._inited = false;
      
      this.shouldLoad = this.shouldProcess = CP_NOP;
      
      CC['@mozilla.org/categorymanager;1'].getService(CI.nsICategoryManager)
        .deleteCategoryEntry("net-channel-event-sinks", SERVICE_CTRID, SERVICE_CTRID, false);
      
      
      if (this.requestWatchdog) {
        this.requestWatchdog.dispose();
        this.requestWatchdog = null;
      }
      
      OS.removeObserver(this, "em-action-requested");
            
      const dls = CC['@mozilla.org/docloaderservice;1'].getService(CI.nsIWebProgress);
      dls.removeProgressListener(this);
      
      this.prefs.removeObserver("", this);
      this.mozJSPref.removeObserver("enabled", this);
      this.resetJSCaps();
      PolicyState.reset();
      
      if (this.placesPrefs) this.placesPrefs.dispose();
      
      STS.dispose();
      
      if(this.consoleDump & LOG_LEAKS) this.reportLeaks();
    } catch(e) {
      this.dump(e + " while disposing.");
    }
    
  },
  
 
  onVersionChanged: function(prev) {
    // upgrade hacks
    
    if (prev >= "1.9.3.4" && prev < "1.9.4") {
      this.setPref("ABE.legacySupport", true);
    } else if (prev >= "1.9.6" && prev <= "1.9.6.8") { // early 1.9.6 broke default whitelist
      if (!this.isJSEnabled("about:credits") && !this.getPref("untrusted")) {
        this.setJSEnabled(this.splitList(this.getPref("default")), true);
      }
    }
    
    // remove every file://host entry from the policy sites lists
    var rx = /\bfile:\/\/\S+\s*/g;
    if (rx.test(this.jsPolicySites.sitesString)) try {
      this.flushCAPS(this.jsPolicySites.sitesString.replace(rx, ''));
      this.persistUntrusted(this.untrustedSites.sitesString.replace(rx, ''));
    } catch(e) {
      ns.dump(e);
    }
    
  },
 
  reportLeaks: function() {
    // leakage detection
    this.dump("DUMPING " + this.__parent__);
    for(var v in this.__parent__) {
      this.dump(v + " = " + this.__parent__[v] + "\n");
    }
  },
  
  captureExternalProtocols: function() {
    try {
      const pb = this.prefService.getDefaultBranch("network.protocol-handler.");
      if (this.getPref("fixURI", true)) {
        try {
          pb.setBoolPref("expose-all", true);
        } catch(e1) {}
        var prots = [];
        for each(var key in pb.getChildList("expose.", {})) {
          try {
            pb.setBoolPref(key, true);
            prots.push(key.replace("expose.", ""));
            if (pb.prefHasUserValue(key)) pb.clearUserPref(key);
          } catch(e1) {}
        }
        if (prots.length) this.extraCapturedProtocols = prots;
      }
    } catch(e) {}
  },
  
  extraCapturedProtocols: null,
  
  mandatorySites: new PolicySites(),
  isMandatory: function(s) {
    return s && this.mandatorySites.matches(s);
  }
,
  tempSites: new PolicySites(),
  gTempSites: new PolicySites(),
  isTemp: function(s) {
    return s in (this.globalJS ? this.gTempSites : this.tempSites).sitesMap;
  }
,
  setTemp: function(s, b) {
    const sites = {
      "temp": this.tempSites,
      "gtemp": this.gTempSites
    };
    for (var p in sites) {
      if (b
          ? (p[0] != "g" || this.globalJS) && sites[p].add(s)
          : sites[p].remove(s, true, true) // keeps up and down, see #eraseTemp() 
      ) sites[p].toPref(this.prefs, p);
    }
    return b;
  },
  
  untrustedSites: new PolicySites(),
  isUntrusted: function(s) {
    return !!this.untrustedSites.matches(s);
  },
  setUntrusted: function(s, b) {
    var change = b ? this.untrustedSites.add(s) : this.untrustedSites.remove(s, false, true);
    if (change) {
      this.persistUntrusted();
    }
    return b;
  },
  persistUntrusted: function(snapshot) {
    if (typeof(snaposhot) == "string") {
      this.untrustedSites.sitesString = snapshot;
    }
    this.untrustedSites.toPref(this.prefs, "untrusted");
  },
  
  manualSites: new PolicySites(),
  isManual: function(s) {
    return !!this.manualSites.matches(s);
  },
  setManual: function(s, b) {
    if (b) this.manualSites.add(s);
    else this.manualSites.remove(s, true);
    return b;
  },
  
  autoTemp: function(site) {
    if (!(this.isUntrusted(site) || this.isManual(site) || this.isJSEnabled(site))) {
      this.setTemp(site, true);
      this.setJSEnabled(site, true);
      return true;
    }
    return false;
  }
,
  mustCascadeTrust: function(sites, temp) {
    var untrustedGranularity = this.getPref("untrustedGranularity", 3);
    /*  noscript.untrustedGranularity  controls how manually whitelisting
        a domain affects the untrusted blacklist status of descendants:
        0 - always delist descendants from the untrusted blacklist
        1 - keep descendants blacklisted for temporary allow actions
        2 - keep descendants blacklisted for permanent allow actions
        3 - (default) always keep descendants blacklisted
        4 - delist blacklisted descendants of a site marked as untrusted
        All these values can be put in OR (the 3 default is actually 2 | 1)
    */
    var single = !(typeof(site) == "object" && ("push" in site)); // not an array
    return !((untrustedGranularity & 1) && !temp || (untrustedGranularity & 2) && temp)
      || (untrustedGranularity & 4) && single && this.isUntrusted(site);
  }
,
  isForbiddenByHttpsStatus: function(s) {
    return HTTPS.allowHttpsOnly && HTTPS.shouldForbid(s);
  }
,
  jsPolicySites: new PolicySites(),
  isJSEnabled: function(s) {
    return !(this.globalJS
      ? this.alwaysBlockUntrustedContent && this.untrustedSites.matches(s)
      : !this.jsPolicySites.matches(s) || this.untrustedSites.matches(s)
        || this.isForbiddenByHttpsStatus(s)
    );
  },
  setJSEnabled: function(site, is, fromScratch, cascadeTrust) {
        
    const ps = this.jsPolicySites;
    if (fromScratch) ps.sitesString = this.mandatorySites.sitesString;
    if (is) {
      ps.add(site);
      if (!fromScratch) {
        if (this.untrustedSites.remove(site, false, !cascadeTrust)) 
          this.persistUntrusted();
        
        this.setManual(site, false);
      }
    } else {
      ps.remove(site, false, true);
      if (this.forbidImpliesUntrust) {
        this.setUntrusted(site, true);
      } else {
        this.setManual(site, true);
      }
    }
    
    this.flushCAPS();
    
    return is;
  },
  
  get forbidImpliesUntrust() {
    return this.globalJS || this.autoAllow || this.getPref("forbidImpliesUntrust", false);
  }
,
  checkShorthands: function(site, map) {
    if (this.whitelistRegExp && this.whitelistRegExp.test(site)) {
      return true;
    }
    
    map = map || this.jsPolicySites.sitesMap;
    
    if (/:\d+$/.test(site)) {
      if (this.ignorePorts) {
        // default match ignoring port
        if (this.isJSEnabled(site.replace(/:\d+$/, ''))) return true;
      } else {
        // port matching, with "0" as port wildcard  and * as nth level host wildcard
        var key = site.replace(/\d+$/, "0");
        if (key in map || site in map) return true;
        var keys = site.split(".");
        if (keys.length > 1) {
          var prefix = keys[0].match(/^https?:\/\//i)[0] + "*.";
          while (keys.length > 2) {
            keys.shift();
            key = prefix + keys.join(".");
            if (key in map || key.replace(/\d+$/, "0") in map) return true;
          }
        }
      }
    }
    // check IP leftmost portion up to 2nd byte (e.g. [http://]192.168 or [http://]10.0.0)
    var m = site.match(/^(https?:\/\/)((\d+\.\d+)\.\d+)\.\d+(?::\d|$)/);
    return m && (m[2] in map || m[3] in map || (m[1] + m[2]) in map || (m[1] + m[3]) in map);
  }
,
  flushCAPS: function(sitesString) {
    const ps = this.jsPolicySites;
    if (sitesString) ps.sitesString = sitesString;
    
    // dump("Flushing " + ps.sitesString);
    ps.toPref(this.policyPB);
  }
,
  get injectionChecker() {
    return InjectionChecker;
  }
,
  splitList: function(s) {
    return s?/^[,\s]*$/.test(s)?[]:s.split(/\s*[,\s]\s*/):[];
  }
,
  get placesPrefs() {
    if (!this.getPref("placesPrefs", false)) return null; 
    delete this.placesPrefs;
    try {
      INCLUDE('PlacesPrefs');
      PlacesPrefs.init();
    } catch(e) {
      PlacesPrefs = null;
    }
    return this.placesPrefs = PlacesPrefs;
  },

  savePrefs: function(skipPlaces) {
    var res = this.prefService.savePrefFile(null);
    if (this.placesPrefs && !skipPlaces) this.placesPrefs.save();
    return res;
  },

  sortedSiteSet: function(s) { return  SiteUtils.sortedSet(s); }
,
  globalJS: false,
  get jsEnabled() {
    try {
      return this.mozJSEnabled && this.caps.getCharPref("default.javascript.enabled") != "noAccess";
    } catch(ex) {
      return this.uninstalling ? this.mozJSEnabled : (this.jsEnabled = this.globalJS);
    }
  }
,
  set jsEnabled(enabled) {
    if (this.locked || this.prefs.prefIsLocked("global")) {
      enabled = false;
    }
    const prefName = "default.javascript.enabled";
    try {
      this.caps.clearUserPref("default.javascript.enabled");
    } catch(e) {}
    this.defaultCaps.setCharPref(prefName, enabled ? "allAccess" : "noAccess");
    
    this.setPref("global", enabled);
    if (enabled) {
      this.mozJSPref.setBoolPref("enabled", true);
    }
    return enabled;
  }
,
  getSite: function(url) {
    return SiteUtils.getSite(url);
  },
  
  getQuickSite: function(url, level) {
    var site = null;
    if (level > 0 && !this.jsEnabled) {
      site = this.getSite(url);
      var domain;
      if (level > 1 && (domain = this.getDomain(site))) {
        site = level > 2 ? this.getBaseDomain(domain) : domain;
      }
    }
    return site;
  },
  
  get preferredSiteLevel() {
    return this.getPref("showAddress", false) ? 1 : this.getPref("showDomain", false) ? 2 : 3;
  },
  
  
  getDomain: function(site, force) {
    try {
      const url = (site instanceof CI.nsIURL) ? site : IOS.newURI(site, null, null);
      const host = url.host;
      return force || (this.ignorePorts || url.port == -1) && host[host.length - 1] != "." && 
            (host.lastIndexOf(".") > 0 || host == "localhost") ? host : '';
    } catch(e) {
      return '';
    }
  },
  
  get _tldService() {
    var srv = null;
    try {
      if (CI.nsIEffectiveTLDService) {
        var srv = CC["@mozilla.org/network/effective-tld-service;1"]
                .getService(CI.nsIEffectiveTLDService);
        if (typeof(srv.getBaseDomainFromHost) != "function"
              || srv.getBaseDomainFromHost("bbc.co.uk") != "bbc.co.uk" // check, some implementations are "fake" (e.g. Songbird's)
          ) {
          srv = null;
        }
      }
      if (!srv) {
        INCLUDE('EmulatedTLDService');
        srv = EmulatedTLDService;
      }
    } catch(ex) {
      this.dump(ex);
      return null;
    }
    delete this._tldService;
    return this._tldService = srv;
  },
  

  getBaseDomain: function(domain) {
    if (!domain || DNS.isIP(domain)) return domain; // IP
    
    var pos = domain.lastIndexOf('.');
    if (pos < 1 || (pos = domain.lastIndexOf('.', pos - 1)) < 1) return domain;
    
    try {
      return this._tldService.getBaseDomainFromHost(domain);
    } catch(e) {
      this.dump(e);
    }
    return domain;
  },
  getPublicSuffix: function(domain) {
    try {
      if (!DNS.isIP(domain))
        return this._tldService.getPublicSuffixFromHost(domain);
    } catch(e) {}
    return "";
  }
,
  delayExec: function(callback, time) {
    Thread.delay(callback, time, this, Array.prototype.slice.call(arguments, 2));
  }
,
  RELOAD_NO: -1,
  RELOAD_CURRENT: 1,
  RELOAD_ALL: 0,
  safeCapsOp: function(callback, reloadPolicy, nosave) {
    this.delayExec(function() {
      try {
        callback(this);
        if (!nosave) this.savePrefs();
        if (reloadPolicy != this.RELOAD_NO) {
          this.reloadWhereNeeded(reloadPolicy == this.RELOAD_CURRENT);
        }
      } catch(e) {
        this.dump("FAILED TO SAVE PERMISSIONS! " + e + "," + e.stack);
      }
     }, 0);
  }
,
  _lastSnapshot: null,
  _lastGlobal: false,
  _lastObjects: null,
  reloadWhereNeeded: function(currentTabOnly) {
    var snapshot = this._lastSnapshot;
    const ps = this.jsPolicySites;
    const global = this.jsEnabled;
    var lastGlobal = this._lastGlobal;
    this._lastGlobal = global;
    this._lastSnapshot = global ? this.untrustedSites.clone() : ps.clone();
    

    var lastObjects = this._lastObjects || this.objectWhitelist;
    this._lastObjects = this.objectWhitelist;
    
    this.initContentPolicy();
    
    if (!snapshot ||
        global == lastGlobal && lastObjects == this.objectWhitelist && 
        ps.equals(snapshot)
        ) 
      return false;
  
    
    if (!this.getPref("autoReload", true)) return false;
    if (global != lastGlobal && !this.getPref("autoReload.global", true)) return false;
    
    currentTabOnly = currentTabOnly || !this.getPref("autoReload.allTabs", true) ||
      global != lastGlobal && !this.getPref("autoReload.allTabsOnGlobal", false);
    
    var useHistory = this.getPref("xss.reload.useHistory", false);
    var useHistoryExceptCurrent = this.getPref("xss.reload.useHistory.exceptCurrent", true);
      
    var ret = false;
    var docSites, site;
    var prevStatus, currStatus;
    
    var webNav, url;
    const nsIWebNavigation = CI.nsIWebNavigation;
    const nsIURL = CI.nsIURL;
    const LOAD_FLAGS = nsIWebNavigation.LOAD_FLAGS_NONE;
 
    const untrustedReload = !this.getPref("xss.trustReloads", false);

    var bi = DOM.createBrowserIterator();
    for (var browser, j; browser = bi.next();) {
      docSites = this.getSites(browser);
      
      
      
      for (j = docSites.length; j-- > 0;) {
 
        prevStatus = lastGlobal ? !(this.alwaysBlockUntrustedContent && snapshot.matches(docSites[j])) : !!snapshot.matches(docSites[j]);
        currStatus = this.isJSEnabled(docSites[j]) || !!this.checkShorthands(docSites[j]);
        if (currStatus != prevStatus) {
          ret = true;
          if (currStatus) 
            this.requestWatchdog.setUntrustedReloadInfo(browser, true);
          
          webNav = browser.webNavigation;
          url = webNav.currentURI;
          if (url.schemeIs("http") || url.schemeIs("https")) {
            this.requestWatchdog.noscriptReload = url.spec;
          }
          try {
            webNav = webNav.sessionHistory.QueryInterface(nsIWebNavigation);
            if (currStatus && webNav.index && untrustedReload) {
              try {
                site = this.getSite(webNav.getEntryAtIndex(webNav.index - 1, false).URI.spec);
                this.requestWatchdog.setUntrustedReloadInfo(browser, site != docSites[j] && !ps.matches(site));
              } catch(e) {}
            }
            
            if (useHistory) {
              if (useHistoryExceptCurrent) {
                useHistoryExceptCurrent = false;
              } else if(!(url instanceof nsIURL && url.ref || url.spec.substring(url.spec.length - 1) == "#")) {
                if (useHistoryCurrentOnly) useHistory = false;
                webNav.gotoIndex(webNav.index);
                break;
              }
            }
          } catch(e) {}
          try {
            browser.webNavigation.reload(LOAD_FLAGS); // can fail, e.g. because a content policy or an user interruption
          } catch(e) {}
          break;
        }
      }
      
      if(j < 0) { 
        // check plugin objects
        if (this.consoleDump & LOG_CONTENT_BLOCK) {
          this.dump("Checking object permission changes...");
          try {
            this.dump(docSites.toSource() + ", " + lastObjects.toSource());
          } catch(e) {}
        }
        if (this.checkObjectPermissionsChange(docSites, lastObjects)) {
           ret = true;
           this.quickReload(browser.webNavigation);
        }
      }
      
      if (currentTabOnly) break;
    }
    bi.dispose();
    bi = null;
    return ret;
  },
  
  
  reloadAllowedObjects: function(browser) {
    if (this.getPref("autoReload.onMultiContent", false)) {
      this.quickReload(browser.webNavigation);
      return;
    }
    
    var sites = this.getSites(browser);
    var egroup, len, j, e;
    for each (egroup in sites.pluginExtras) {
      for (j = 0, len = egroup.length; j < len; j++) {
        e = egroup[j];
        if (this.isAllowedObject(e.url, e.mime, e.site)) {
          if (e.placeholder) {
            e.skipConfirmation = true;
            this.checkAndEnablePlaceholder(e.placeholder);
          } else if (!e.embed) {
            if (e.document) {
              this.quickReload(DOM.getDocShellForWindow(e.document.defaultView));
              break;
            } else {
              this.quickReload(browser.webNavigation);
              return;
            }
          }
        }
      }
    }
  },
  
  checkObjectPermissionsChange: function(sites, snapshot) {
    if(this.objectWhitelist == snapshot) return false;
    var s, url;
    for (url in snapshot) {
      s = this.getSite(url);
      if (!(s in snapshot)) snapshot[s] = snapshot[url];
    }
    for each (var s in sites.pluginSites) {
      s = this.objectKey(s);
      if ((s in snapshot) && !(s in this.objectWhitelist)) {
        return true;
      }
    }
    var egroup, len, j, e;
     for each (egroup in sites.pluginExtras) {
      for (j = 0, len = egroup.length; j < len; j++) {
        e = egroup[j];
        if (!e.placeholder && e.url && ((url = this.objectKey(e.url)) in snapshot) && !(url in this.objectWhitelist)) {
          return true;
        }
      }
    }
    return false;
  },
  
  quickReload: function(webNav, checkNullCache) {
    if (!(webNav instanceof CI.nsIWebNavigation)) {
      webNav = DOM.getDocShellForWindow(webNav);
    }
    
    var uri = webNav.currentURI;
    
    if (checkNullCache && (webNav instanceof CI.nsIWebPageDescriptor)) {
      try {
        var ch = IOS.newChannel(uri.spec, null, null);
        if (ch instanceof CI.nsICachingChannel) {
          ch.loadFlags |= ch.LOAD_ONLY_FROM_CACHE;
          ch.cacheKey = webNav.currentDescriptor.QueryInterface(CI.nsISHEntry).cacheKey
          if (ch.open().available() == 0) {
            webNav.reload(webNav.LOAD_FLAGS_BYPASS_CACHE);
            return;
          }
        }
      } catch(e) {
        if (this.consoleDump) this.dump(e);
      } finally {
        try {
          ch.close();
        } catch(e1) {}
      }
    }
    

    if (uri.schemeIs("http") || uri.schemeIs("https")) {
      this.requestWatchdog.noscriptReload = uri.spec;
    }
    webNav.reload(webNav.LOAD_FLAGS_CHARSET_CHANGE);
  },
  
  getPermanentSites: function() {
    var whitelist = this.jsPolicySites.clone();
    whitelist.remove(this.tempSites.sitesList, true, true);
    return whitelist;
  },
  
  eraseTemp: function() {
    // remove temporary PUNCTUALLY: 
    // keeps ancestors because the may be added as permanent after the temporary allow;
    // keeps descendants because they may already have been made permanent before the temporary, and then shadowed
    this.jsPolicySites.remove(this.tempSites.sitesList, true, true);
    // if allowed in blacklist mode, put back temporarily allowed in blacklist
    if (this.untrustedSites.add(this.gTempSites.sitesList)) {
      this.persistUntrusted();
    }
    
    this.setPref("temp", ""); 
    this.setPref("gtemp", "");
    
    this.setJSEnabled(this.mandatorySites.sitesList, true); // add mandatory
    this.resetAllowedObjects();
    if (this.clearClickHandler) this.clearClickHandler.resetWhitelist();
  }
  
,
  _observingPolicies: false,
  _editingPolicies: false,
  setupJSCaps: function() {
    if (this._editingPolicies) return;
    this._editingPolicies = true;
    try {
      const POLICY_NAME = this.POLICY_NAME;
      var prefArray;
      var prefString = "", originalPrefString = "";
      var exclusive = this.getPref("excaps", true);
      try {
        
        prefArray = this.splitList(prefString = originalPrefString = 
          (this.caps.prefHasUserValue("policynames") 
            ? this.caps.getCharPref("policynames")
            : this.getPref("policynames") // saved value from dirty exit
          )
        );
        var pcount = prefArray.length;
        while (pcount-- > 0 && prefArray[pcount] != POLICY_NAME);
        if (pcount == -1) { // our policy is not installed, should always be so unless dirty exit
          this.setPref("policynames", originalPrefString);
          if (exclusive || prefArray.length == 0) {
            prefString = POLICY_NAME;
          } else {
            prefArray.push(POLICY_NAME);
            prefString = prefArray.join(' ');
          }
        }
        prefString = prefString.replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
      } catch(ex) {
        prefString = POLICY_NAME;
      }
      
      this.caps.setCharPref(POLICY_NAME + ".javascript.enabled", "allAccess");
      
      try {
        this.caps.clearUserPref("policynames");
      } catch(e) {}
      this.defaultCaps.setCharPref("policynames", prefString);

      
      if (!this._observingPolicies) {
        this.caps.addObserver("policynames", this, true);
        this._observingPolicies = true;
      }
    } catch(ex) {
      dump(ex.message);
    }
    this._editingPolicies = false;
  },
  resetJSCaps: function() {
    try {
      this.caps.clearUserPref("default.javascript.enabled");
    } catch(ex) {}
    if (this._observingPolicies) {
      this.caps.removeObserver("policynames", this, false);
      this._observingPolicies = false;
    }
    try {
      const POLICY_NAME = this.POLICY_NAME;
      var prefArray = SiteUtils.splitString(
        this.getPref("excaps", true) ? this.getPref("policynames", "") : this.caps.getCharPref("policynames")
      );
      var pcount = prefArray.length;
      const prefArrayTarget = [];
      for (var pcount = prefArray.length; pcount-- > 0;) {
        if (prefArray[pcount] != POLICY_NAME) prefArrayTarget[prefArrayTarget.length] = prefArray[pcount];
      }
      var prefString = prefArrayTarget.join(" ").replace(/\s+/g,' ').replace(/^\s+/,'').replace(/\s+$/,'');
      if (prefString) {
        this.caps.setCharPref("policynames", prefString);
      } else {
        try {
          this.caps.clearUserPref("policynames");
        } catch(ex1) {}
      }
      try {
        this.clearUserPref("policynames");
      } catch(ex1) {}
      
      this.eraseTemp();
      this.savePrefs(true);
    } catch(ex) {}
  }
,
  uninstallJob: function() {
    // this.resetJSCaps();
  },
  undoUninstallJob: function() {
    // this.setupJSCaps();
  }
,
  getPref: function(name, def) {
    const IPC = CI.nsIPrefBranch;
    const prefs = this.prefs;
    try {
      switch (prefs.getPrefType(name)) {
        case IPC.PREF_STRING:
          return prefs.getCharPref(name);
        case IPC.PREF_INT:
          return prefs.getIntPref(name);
        case IPC.PREF_BOOL:
          return prefs.getBoolPref(name);
      }
    } catch(e) {}
    return def || "";
  }
,
  setPref: function(name, value) {
    const prefs = this.prefs;
    try {
      switch (typeof(value)) {
        case "string":
            prefs.setCharPref(name,value);
            break;
        case "boolean":
          prefs.setBoolPref(name,value);
          break;
        case "number":
          prefs.setIntPref(name,value);
          break;
        default:
          throw new Error("Unsupported type " + typeof(value) + " for preference "+name);
      }
    } catch(e) {
      const IPC = CI.nsIPrefBranch;
      try {
        switch (prefs.getPrefType(name)) {
          case IPC.PREF_STRING:
            prefs.setCharPref(name, value);
            break;
          case IPC.PREF_INT:
            prefs.setIntPref(name, parseInt(value));
            break;
          case IPC.PREF_BOOL:
            prefs.setBoolPref(name, !!value && value != "false");
            break;
        }
      } catch(e2) {}
    }
  },
  
  get json() {
    delete this.json;
    var json;
    try {
      json = CC["@mozilla.org/dom/json;1"].createInstance(CI.nsIJSON);
    } catch(e) {
      json = null;
    }
    return this.json = json;
  },
  
  get placesSupported() {
    return "nsINavBookmarksService" in Components.interfaces;
  },
  
  get canSerializeConf() { return !!this.json },
  serializeConf: function(beauty) {
    if (!this.json) return '';
    
    var exclude = ["version", "temp", "placesPrefs.ts"];
    var prefs = {};
    for each (var key in this.prefs.getChildList("", {})) {
      if (exclude.indexOf(key) < 0) {
        prefs[key] = this.getPref(key);
      }
    }
    
    var conf = this.json.encode({
      prefs: prefs,
      whitelist: this.getPermanentSites().sitesString,
      ABE: ABE.serialize(),
      V: this.VERSION
    });
    
    return beauty ? conf.replace(/([^\\]"[^"]*[,\{])"/g, "$1\r\n\"").replace(/},?(?:\n|$)/g, "\r\n$&") : conf;
  },
  
  restoreConf: function(s) {
    try {
      var json = this.json.decode(s.replace(/[\n\r]/g, ''));
      if (json.ABE) ABE.restore(json.ABE);
      var prefs = json.prefs;
      for (var key in prefs) this.setPref(key, prefs[key]);

      this.flushCAPS(json.whitelist);
      this.setPref("temp", ""); 
      this.setPref("gtemp", "");
      
      return true;
    } catch(e) {
      this.dump("Cannot restore configuration: " + e);
      return false;
    }
  }  
,
  _sound: null,
  playSound: function(url, force) {
    if (force || this.getPref("sound", false)) {
      var sound = this._sound;
      if (sound == null) {
        sound = CC["@mozilla.org/sound;1"].createInstance(CI.nsISound);
        sound.init();
        this._sound = sound;
      }
      try {
        sound.play(IOS.newURI(url, null, null));
      } catch(ex) {
        //dump(ex);
      }
    }
  },
  _soundNotified: {},
  soundNotify: function(url) {
    if (this.getPref("sound.oncePerSite", true)) {
      const site = this.getSite(url);
      if (this._soundNotified[site]) return;
      this._soundNotified[site] = true;
    }
    this.playSound(this.getPref("sound.block"));
  }
,
  readFile: function(file) {
    return IO.readFile(file);
  }
,
  writeFile: function(file, content) {
    IO.writeFile(file, content);
  }
,
  
  getAllowObjectMessage: function(url, mime) {
    url = SiteUtils.crop(url);
    return this.getString("allowTemp", [url + "\n(" + mime + ")\n"]);
  }
,
  lookupMethod: DOM.lookupMethod,
  dom: DOM,
  siteUtils: SiteUtils,

  mimeService: null,
 
  shouldLoad: CP_NOP,
  shouldProcess: CP_NOP,
  
  initContentPolicy: function() {
    const last = this.getPref("cp.last");
    const catman = Module.categoryManager;
    const cat = "content-policy"; 
    if (last) catman.deleteCategoryEntry(cat, SERVICE_CTRID, false);
    
    var delegate = this.disabled ||
        (this.globalJS &&
          !(this.alwaysBlockUntrustedContent || this.contentBlocker || this.httpsForced))   
      ? NOPContentPolicy
      : MainContentPolicy;
      
    for (var p in delegate) this[p] = delegate[p];
    
    if (last && delegate != NOPContentPolicy) {
      // removing and adding the category late in the game allows to be the latest policy to run,
      // and nice to AdBlock Plus
      catman.addCategoryEntry(cat, SERVICE_CTRID, SERVICE_CTRID, true, true);
    }
    
    if (!this.mimeService) {
      
      this.rejectCode = typeof(/ /) == "object" ? -4 : -3;
      this.safeToplevel = this.getPref("safeToplevel", true);
      this.initSafeJSRx();
      this.mimeService = CC['@mozilla.org/uriloader/external-helper-app-service;1']
        .getService(CI.nsIMIMEService);
    }
  },
 
  
  guessMime: function(uriOrExt) {
    try {
      var ext = (uriOrExt instanceof CI.nsIURL) ? uriOrExt.fileExtension : uriOrExt;
      return ext && this.mimeService.getTypeFromExtension(ext) || "";
    } catch(e) {
      return "";
    }
  },
  
  pluginForMime: function(mimeType) {
    if (!mimeType) return null;
    try {
      var w = DOM.mostRecentBrowserWindow;
      if (!(w && w.navigator)) return null;
      var mime = w.navigator.mimeTypes.namedItem(mimeType);
      return mime && mime.enabledPlugin || null;
    } catch(e) { return null; }
  },
  
  isMediaType: function(mimeType) {
    return /^(?:vide|audi)o\/|\/ogg$/i.test(mimeType);
  },
  
  checkForbiddenChrome: function(url, origin) {
    var f, browserChromeDir, chromeRegistry;
    try {
      browserChromeDir = CC["@mozilla.org/file/directory_service;1"].getService(CI.nsIProperties)
                       .get("AChrom", CI.nsIFile);
      chromeRegistry = CC["@mozilla.org/chrome/chrome-registry;1"].getService(CI.nsIChromeRegistry);
      
      f = function(url, origin) {
        if(origin && !/^(?:chrome|resource|about)$/.test(origin.scheme)) {
          switch(url.scheme) {
            case "chrome":
              var packageName = url.host;
              if (packageName == "browser") return false; // fast path for commonest case
              exception = this.getPref("forbidChromeExceptions." + packageName, false);
              if (exception) return false;
              var chromeURL = chromeRegistry.convertChromeURL(url);
              if (chromeURL instanceof CI.nsIJARURI) 
                chromeURL = chromeURL.JARFile;
                    
              return chromeURL instanceof CI.nsIFileURL && !browserChromeDir.contains(chromeURL.file, true);
             
            case "resource":
              if(/\.\./.test(unescape(url.spec))) return true;
          }
        }
        return false;
      }
    } catch(e) {
      f = function() { return false; }
    }
    this.checkForbiddenChrome = f;
    return this.checkForbiddenChrome(url, origin);
  },

  
  versionComparator: CC["@mozilla.org/xpcom/version-comparator;1"].createInstance(CI.nsIVersionComparator),
  geckoVersion: ("nsIXULAppInfo" in  Components.interfaces) ? CC["@mozilla.org/xre/app-info;1"].getService(CI.nsIXULAppInfo).platformVersion : "0.0",
  geckoVersionCheck: function(v) {
    return this.versionComparator.compare(this.geckoVersion, v);
  },
  
  
  _bug453825: true,
  _bug472495: true,
  
  POLICY_XBL: "TYPE_XBL" in CI.nsIContentPolicy,
  POLICY_OBJSUB: "TYPE_OBJECT_SUBREQUEST" in CI.nsIContentPolicy,
  
  cpConsoleFilter: [2, 5, 6, 7, 15],
  cpDump: function(msg, aContentType, aContentLocation, aRequestOrigin, aContext, aMimeTypeGuess, aInternalCall) {
    this.dump("Content " + msg + " -- type: " + aContentType + ", location: " + (aContentLocation && aContentLocation.spec) + 
      ", origin: " + (aRequestOrigin && aRequestOrigin.spec) + ", ctx: " + 
        ((aContext instanceof CI.nsIDOMHTMLElement) ? "<HTML Element>" // try not to cause side effects of toString() during load
          : aContext)  + 
        ", mime: " + aMimeTypeGuess + ", " + aInternalCall);
  },
  reject: function(what, args) {
    
    if (args.xOriginCached)
      XOriginCache.pick(args.xOriginKey, true);
    
    if (this.consoleDump) {
      if(this.consoleDump & LOG_CONTENT_BLOCK && args.length == 6) {
        this.cpDump("BLOCKED " + what, args[0], args[1], args[2], args[3], args[4], args[5]);
      }
      if(this.consoleDump & LOG_CONTENT_CALL) {
        this.dump(new Error().stack);
      }
    }
    switch(args[0]) {
      case 9:
        // our take on https://bugzilla.mozilla.org/show_bug.cgi?id=387971
        args[1].spec = this.nopXBL;
        return CP_OK;
    }
    
    PolicyState.cancel(args);
    
    this.recordBlocked(this.getSite(args[1].spec));
    
    return this.rejectCode;
  },
  
  get nopXBL() {
    const v = this.POLICY_XBL
      ? "chrome://global/content/bindings/general.xml#basecontrol"
      : this.contentBase + "noscript.xbl#nop";
    this.__defineGetter__("nopXBL", function() { return v; });
    return v;
  },
  
  _domNodeRemoved: function(ev) {
    if (ns.consoleDump) ns.dump("Removing DOMNodeRemoved listener");
    ev.currentTarget.removeEventListener(ev.type, arguments.callee, true);
  },
  
  forbiddenJSDataDoc: function(locationURL, originSite, aContext) {
     return !this.isSafeJSURL(locationURL) &&
        (this.forbidData && !this.isFirebugJSURL(locationURL) || locationURL == "javascript:") && 
        (!originSite || /^moz-nullprincipal:/.test(originSite))
          ? aContext && (
                    (aContext instanceof CI.nsIDOMWindow) 
                      ? aContext
                      : aContext.ownerDocument.defaultView
                  ).isNewToplevel
          : this.forbidData && !(this.isJSEnabled(originSite) ||
              (aContext instanceof CI.nsIDOMHTMLFrameElement ||
               aContext instanceof CI.nsIDOMHTMLIFrameElement) &&
              (
              /^data:[\w\/]+,$/.test(locationURL) ||
              this.isPluginDocumentURL(locationURL, "iframe") ||
              this.isPluginDocumentURL(locationURL, "embed") ||
              this.isPluginDocumentURL(locationURL, "video") ||
              this.isPluginDocumentURL(locationURL, "audio")
              )
            );
  },
  
  forbiddenXMLRequest: function(aRequestOrigin, aContentLocation, aContext, forbidDelegate) {
    var originURL, locationURL;
    if (aContentLocation.schemeIs("chrome") || !aRequestOrigin || 
         // GreaseMonkey Ajax comes from resource: hidden window
         // Google Toolbar Ajax from about:blank
           /^(?:chrome:|resource:|about:blank)/.test(originURL = aRequestOrigin.spec) ||
           // Web Developer extension "appears" to XHR towards about:blank
           (locationURL = aContentLocation.spec) == "about:blank"
          ) return false;
    var win = aContext && aContext.defaultView;
    if(win) {
      this.getExpando(win.top.document, "codeSites", []).push(this.getSite(locationURL));
    }
    return forbidDelegate.call(this, originURL, locationURL);
  },
  
  addFlashVars: function(url, embed) {
    // add flashvars to have a better URL ID
    if (embed instanceof CI.nsIDOMElement) try {
      var flashvars = embed.getAttribute("flashvars");
      if (flashvars) url += "#!flashvars#" + encodeURI(flashvars); 
    } catch(e) {
      if (this.consoleDump) this.dump("Couldn't add flashvars to " + url + ":" + e);
    }
    return url;
  },
  
  addObjectParams: function(url, embed) {
    if (embed instanceof CI.nsIDOMElement) try {
      var params = embed.getElementsByTagName("param");
      if(!params.length) return url;
      
      var pp = [];
      for(var j = params.length; j-- > 0;) {
        pp.push(encodeURIComponent(params[j].name) + "=" + encodeURIComponent(params[j].value));
      }
      url += "#!objparams#" + pp.join("&");
    } catch (e) {
      if (this.consoleDump) this.dump("Couldn't add object params to " + url + ":" + e);
    }
    return url;
  },
  
  tagWindowlessObject: function(o) {
    const rx = /opaque|transparent/i;
    var b;
    try {
      if (o instanceof CI.nsIDOMHTMLEmbedElement) {
        b = rx.test(o.getAttribute("wmode"));
      } else if (o instanceof CI.nsIDOMHTMLObjectElement) {
        var params = o.getElementsByTagName("param");
        for(var j = params.length; j-- > 0 &&
            !(b = /wmode/i.test(params[j].name && rx.test(params[j].value)));
        );
      }
      if (b) this.setExpando(o, "windowless", true);
    } catch (e) {
      if (this.consoleDump) this.dump("Couldn't tag object for window mode.");
    }
  },
  
  isWindowlessObject: function(o) {
    return this.getExpando(o, "windowless") || o.settings && o.settings.windowless;
  },
  
  resolveSilverlightURL: function(uri, embed) {
    if(!uri) return "";
    
    
    if (embed instanceof CI.nsIDOMElement) try {
      
      var url = "";
      var params = embed.getElementsByTagName("param");
      if (!params.length) return uri.spec;
      
      var name, value, pp = [];
      for (var j = params.length; j-- > 0;) { // iteration inverse order is important for "source"!
        name = params[j].name;
        value = params[j].value;
        if(!(name && value)) continue;
        
        if (!url && name.toLowerCase() == "source") {
          try {
             url = uri.resolve(value);
             continue;
          } catch(e) {
            if (this.consoleDump)  
              this.dump("Couldn't resolve Silverlight URL " + uri.spec + " + " + value + ":" + e);
            url = uri.spec;
          }
        }
        pp.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
      }
      return (url || uri.spec) + "#!objparams#" + pp.join("&");
    } catch(e1) {
      if (this.consoleDump)  this.dump("Couldn't resolve Silverlight URL " + uri.spec + ":" + e1);
    }
    return uri.spec;
  },
  
  tagForReplacement: function(embed, pluginExtras) {
    try {
      var doc = embed.ownerDocument;
      if(!doc) {
        if (embed instanceof CI.nsIDOMDocumentView) {
          pluginExtras.document = (doc = embed);
          pluginExtras.url = this.getSite(pluginExtras.url);
          this._collectPluginExtras(this.findPluginExtras(doc), pluginExtras);
        }
      } else {
        this.getExpando(doc, "pe",  []).push({embed: embed, pluginExtras: pluginExtras});
      }
      try {
        this.syncUI(doc.defaultView.top);
      } catch(noUIex) {
        if(this.consoleDump) this.dump(noUIex);
      }
    } catch(ex) {
      if(this.consoleDump) this.dump(
        "Error tagging object [" + pluginExtras.mime + " from " + pluginExtras.url +
        " - top window " + win + ", embed " + embed +
        "] for replacement: " + ex);
    }
  },
  
  blockLegacyFrame: function(frame, uri, sync) {

    var verbose = this.consoleDump & LOG_CONTENT_BLOCK;
    if(verbose) {
      this.dump("Redirecting blocked legacy frame " + uri.spec + ", sync=" + sync);
    }
    
    
    var url = this.createPluginDocumentURL(uri.spec, "iframe");
    
    if(sync) {
      if (verbose) dump("Legacy frame SYNC, setting to " + url + "\n");
      frame.contentWindow.location = url;
    } else {
      frame.ownerDocument.defaultView.addEventListener("load", function(ev) {
          if(verbose) dump("Legacy frame ON PARENT LOAD, setting to " + url + "\n");
          ev.currentTarget.removeEventListener("load", arguments.callee, false);
          frame.contentWindow.location = url;
      }, false);
    }
    return true;
  
  },
  
  
  isPluginDocumentURL: function(url, tag) {
    try {
      return url.replace(/(src%3D%22).*?%22/i, '$1%22') == this.createPluginDocumentURL('', tag)
    } catch(e) {}
    return false;
  },
  
  createPluginDocumentURL: function(url, tag) {
    tag = tag ? tag.toLowerCase() : "embed";
    return 'data:text/html;charset=utf-8,' +
        encodeURIComponent('<html><head></head><body style="padding: 0px; margin: 0px"><' +
          tag + ' src="' + url + '" width="100%" height="100%"></' +
          tag + '></body></html>');
  },
  
  forbiddenIFrameContext: function(originURL, locationURL) {
    if (this.isForbiddenByHttpsStatus(originURL)) return false;
    var domain = this.getDomain(locationURL, true);
    if (!domain) return false;
    switch (this.forbidIFramesContext) {
      case 0: // all IFRAMES
        return true;
      case 3: // different 2nd level domain
        return this.getBaseDomain(this.getDomain(originURL, true)) != 
          this.getBaseDomain(domain);
      case 2: // different domain (unless forbidden by HTTPS status)
        if (this.getDomain(originURL, true) != domain) return true;
        // if we trust only HTTPS both sites must have the same scheme
        if (!this.isForbiddenByHttpsStatus(locationURL.replace(/^https:/, 'http:'))) return false;
      case 1: // different site
        return this.getSite(originURL) != this.getSite(locationURL);
     }
     return false;
  },
  
  forbiddenXBLContext: function(originURL, locationURL) {
    if (locationURL == this.nopXBL) return false; // always allow our nop binding
    
    var locationSite = this.getSite(locationURL);
    var originSite = this.getSite(originURL);
   
    switch (this.forbidXBL) {
      case 4: // allow only XBL from the same trusted site or chrome (default)
        if (locationSite != originSite) return true; // chrome is checked by the caller checkXML
      case 3: // allow only trusted XBL on trusted sites
        if (!locationSite) return true;
      case 2: // allow trusted and data: (Fx 3) XBL on trusted sites
        if (!(this.isJSEnabled(originSite) ||
              /^file:/.test(locationURL) // we trust local files to allow Linux theming
             )) return true;
      case 1: // allow trusted and data: (Fx 3) XBL on any site
        if (!(this.isJSEnabled(locationSite) || /^(?:data|file|resource):/.test(locationURL))) return true;
      case 0: // allow all XBL
        return false;
    }
    return true;
  },
  
  forbiddenXHRContext: function(originURL, locationURL) {
    var locationSite = this.getSite(locationURL);
    // var originSite = this.getSite(originURL);
    switch (this.forbidXHR) {
      case 3: // forbid all XHR
        return true;
      case 2: // allow same-site XHR only
        if (locationSite != originSite) return true;
      case 1: // allow trusted XHR targets only
        if (!(this.isJSEnabled(locationSite))) return true;
      case 0: // allow all XBL
        return false;
    }
    return true;
  },
  
  
  safeJSRx: false,
  initSafeJSRx: function() {
    try {
      this.safeJSRx = new RegExp("^\\s*" + this.getPref("safeJSRx", "") + "\\s*;?\\s*$");
    } catch(e) {
      this.safeJSRx = false;
    }
  },
  isSafeJSURL: function(url) {
    var js = url.replace(/^javascript:/i, "");
    return this.safeJSRx && js != url && this.safeJSRx.test(js);
  },
  
  isFirebugJSURL: function(url) {
    return url == "javascript: eval(__firebugTemp__);"
  },
  
  isExternalScheme: function(scheme) {
    try {
      return IOS.getProtocolHandler(scheme).scheme != scheme;
    } catch(e) {
      return false;
    }
  },
  normalizeExternalURI: function(uri) {
    var uriSpec = uri.spec;
    var uriValid = URIValidator.validate(uriSpec);
    var fixURI = this.getPref("fixURI", true) && 
      this.getPref("fixURI.exclude", "").split(/[^\w\-]+/)
          .indexOf(uri.scheme) < 0;
    var msg;
    if (!uriValid) {
      if (fixURI) {
        uriSpec = uriSpec
            .replace(/[\s\x01-\x1f\0]/g, " ") // whitespace + null + control chars all to space
            .replace(/%[01][\da-f]/gi, "%20"); // ditto for already encoded items
        if (uriSpec != uri.spec) {
          if (this.consoleDump) this.dump("Fixing URI: " + uri.spec + " into " + uriSpec);
          if (uriValid !== false || (uriValid = URIValidator.validate(uriSpec))) {
            uri.spec = uriSpec;
          }
        }
      }
      if (uriValid === false) {
        msg = "Rejected invalid URI: " + uriSpec;
        if (this.consoleDump) this.dump(msg);
        this.log("[NoScript URI Validator] " + msg);
        return false;
      }
    }
    // encode all you can (i.e. don't touch valid encoded and delims)
    if (fixURI) {
      try {
        uriSpec = uriSpec.replace(/[^%]|%(?![\da-f]{2})/gi, encodeURI); 
        if (uriSpec != uri.spec) {
          if (this.consoleDump) this.dump("Encoded URI: " + uri.spec + " to " + uriSpec);
          uri.spec = uriSpec;
        }
      } catch(ex) {
        msg = "Error assigning encoded URI: " + uriSpec + ", " + ex;
        if (this.consoleDump) this.dump(msg);
        this.log("[NoScript URI Validator] " + msg);
        return false;
      }
    }
    return true;
  },
  
  syncUI: function(domNode) {
    const browser = DOM.findBrowserForNode(domNode);
    if (browser && (browser.docShell instanceof CI.nsIWebProgress) && !browser.docShell.isLoadingDocument) {
      var overlay = this.findOverlay(browser);
      if(overlay) overlay.syncUI(browser.contentWindow);
    }
  },
  
  objectWhitelist: {},
  ALL_TYPES: ["*"],
  objectWhitelistLen: 0,
  objectKey: function(url) {
    return IOUtil.anonymizeURL(url.replace(/^((?:\w+:\/\/)?[^\.\/\d]+)\d+(\.[^\.\/]+\.)/, '$1$2'));
  },
  anyAllowedObject: function(site, mime) {
    site = this.objectKey(site);
    if (site in this.objectWhitelist) return true;
    site += '/';
    for(var s in this.objectWhitelist) {
      if (s.indexOf(site) == 0) return true;
    }
    return false;
  },
  isAllowedObject: function(url, mime, site) {
    url = this.objectKey(url);
    var types = this.objectWhitelist[url] || null;
    if (types && (types == this.ALL_TYPES || types.indexOf(mime) > -1)) 
      return true;
    
    site = this.objectKey((arguments.length >= 3) ? site : this.getSite(url));
     
    var types, s;
    for (;;) {

      types = site && this.objectWhitelist[site] || null;
      if (types && (types == this.ALL_TYPES || types.indexOf(mime) > -1)) return true;

      if (!/\..*\.|:\//.test(site)) break;
      s = site.replace(/.*?(?::\/+|\.)/, '');
      if (s == site) break;
      site = s;
    } 
  },
  allowObject: function(url, mime) {
    url = this.objectKey(url);
    if (url in this.objectWhitelist) {
      var types = this.objectWhitelist[url];
      if(mime == "*") {
        if(types == this.ALL_TYPES) return;
        types = this.ALL_TYPES;
      } else {
        if(types.indexOf(mime) > -1) return;
        types.push(mime);
      }
    } else {
      this.objectWhitelist[url] = mime == "*" ? this.ALL_TYPES : [mime];
    }
    this.objectWhitelistLen++;
  },
  isAllowedObjectById: function(id, objectURL, parentURL, mime, site) {
    var url = this.getObjectURLWithId(id, objectURL, parentURL);
    return url && this.isAllowedObject(url, mime, site);
  },
  allowObjectById: function(id, objectURL, parentURL, mime) {
    var url = this.getObjectURLWithId(id, objectURL, parentURL);
    if (url) this.allowObject(url, mime);
  },
  getObjectURLWithId: function(id, objectURL, parentURL) {
    return id && objectURL.replace(/[\?#].*/, '') + "#!#" + id + "@" + encodeURIComponent(parentURL);
  },
  resetAllowedObjects: function() {
    this.objectWhitelist = {};
    this.objectWhitelistLen = 0;
  },
  
  
  countObject: function(embed, site) {

    if(!site) return;
    var doc = embed.ownerDocument;
    
    if (doc) {
      var topDoc = doc.defaultView.top.document;
      var os = this.getExpando(topDoc, "objectSites");
      if(os) {
        if(os.indexOf(site) < 0) os.push(site);
      } else {
        this.setExpando(topDoc, "objectSites", [site]);
      }
    
      this.opaqueIfNeeded(embed, doc);
    }
  },
  
  getPluginExtras: function(obj) {
    return this.getExpando(obj, "pluginExtras");
  },
  setPluginExtras: function(obj, extras) {
    this.setExpando(obj, "pluginExtras", extras);
    if (this.consoleDump & LOG_CONTENT_BLOCK) this.dump("Setting plugin extras on " + obj + " -> " + (this.getPluginExtras(obj) == extras)
      + ", " + (extras && extras.toSource())  );
    return extras;
  },
  
  getExpando: function(domObject, key, defValue) {
    return domObject && domObject.__noscriptStorage && domObject.__noscriptStorage[key] || 
           (defValue ? this.setExpando(domObject, key, defValue) : null);
  },
  setExpando: function(domObject, key, value) {
    if (!domObject) return null;
    if (!domObject.__noscriptStorage) domObject.__noscriptStorage = {};
    if (domObject.__noscriptStorage) domObject.__noscriptStorage[key] = value;
    else if(this.consoleDump) this.dump("Warning: cannot set expando " + key + " to value " + value);
    return value;
  },
  
  cleanupBrowser: function(browser) {
    delete browser.__noscriptStorage;
  },
  
  hasVisibleLinks: function(document) {
    var links = document.links;
    var style, position;
    for (var j = 0, l; (l = links[j]); j++) {
      if (l && l.href && /^https?/i.test(l.href)) {
        if(l.offsetWidth || l.offsetHeight) return true;
        try {
          position = l.style.position;
          l.style.position = "absolute";
          if(l.offsetWidth || l.offsetHeight) return true;
        } finally {
          l.style.position = position;
        }
      }
    }
    return false;
  },
  detectJSRedirects: function(document) {
    if (this.jsredirectIgnore || this.jsEnabled) return 0;
    try {
      if (!/^https?:/.test(document.documentURI)) return 0;
      var hasVisibleLinks = this.hasVisibleLinks(document);
      if (!this.jsredirectForceShow && hasVisibleLinks ||
          this.isJSEnabled(this.getSite(document.documentURI))) 
        return 0;
      var j, len;
      var seen = [];
      var body = document.body;
      var cstyle = document.defaultView.getComputedStyle(body, "");
      if (cstyle) {
        if (cstyle.visibility != "visible") {
          body.style.visibility = "visible";
        }
        if (cstyle.display == "none") {
          body.style.display = "block";
        }
      }
      if (!hasVisibleLinks && document.links[0]) {
        var links = document.links;
        var l;
        for (j = 0, len = links.length; j < len; j++) {
          l = links[j];
          if (!(l.href && /^https?/.test(l.href))) continue;
          l = body.appendChild(l.cloneNode(true));
          l.style.visibility = "visible";
          l.style.display = "block";
          seen.push(l.href);
        }
      }
      
      var code, m, url, a;
      var container = null;
      var window;
      
      code = body && body.getAttribute("onload");
      const sources = code ? [code] : [];
      var scripts = document.getElementsByTagName("script");
      for (j = 0, len = scripts.length; j < len; j++) sources.push(scripts[j].innerHTML);
      scripts = null;
      
      if (!sources[0]) return 0;
      var follow = false;
      const findURL = /(?:(?:\b(?:open|replace)\s*\(|(?:\b(?:href|location|src|path|pathname|search)|(?:[Pp]ath|UR[IL]|[uU]r[il]))\s*=)\s*['"]|['"](?=https?:\/\/\w|\w*[\.\/\?]))([\?\/\.\w\-%\&][^\s'"]*)/g;
      const MAX_TIME = 1000;
      const MAX_LINKS = 30;
      const ts = Date.now();
      outerLoop:
      for (j = 0, len = sources.length; j < len; j++) {
        findURL.lastIndex = 0;
        code = sources[j];
        while ((m = findURL.exec(code))) {
          
          if (!container) {
            container = document.createElementNS(HTML_NS, "div");
            with (container.style) {
              backgroundImage = 'url("' + this.pluginPlaceholder + '")';
              backgroundRepeat = "no-repeat";
              backgroundPosition = "2px 2px";
              padding = "4px 4px 4px 40px";
              display = "block";
              minHeight = "32px";
              textAlign = "left";
            }
            window = document.defaultView;
            follow = this.jsredirectFollow && window == window.top &&  
              !window.frames[0] &&
              !document.evaluate('//body[normalize-space()!=""]', document, null, 
                CI.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            document.body.appendChild(container);
          }
          url = m[1];
          a = document.createElementNS(HTML_NS, "a");
          a.href = url;
          container.appendChild(a);
          if (a.href.toLowerCase().indexOf("http") != 0 || seen.indexOf(a.href) > -1) {
             container.removeChild(a);
             continue;
          }
          seen.push(a.href);
          a.appendChild(document.createTextNode(a.href));
          container.appendChild(document.createElementNS(HTML_NS, "br"));
          
          if (seen.length >= MAX_LINKS || Date.now() - ts > MAX_TIME) break outerLoop;
        }
        
        if (follow && seen.length == 1) {
          this.log("[NoScript Following JS Redirection]: " + seen[0] + " FROM " + document.location.href); 
          
          this.doFollowMetaRefresh({
            uri: seen[0],
            document: document
          });  
        }
        
        if (Date.now() - ts > MAX_TIME) break;
      }
      return seen.length;
    } catch(e) { 
      this.dump(e.message + " while processing JS redirects");
      return 0; 
    }
  }
,
  processScriptElements: function(document, sites) {
    var scripts = document.getElementsByTagName("script");
    var scount = scripts.length;
    if (scount) {
      const HTMLElement = CI.nsIDOMHTMLElement;
      sites.scriptCount += scount;
      var script, scriptSrc;
      var nselForce = this.nselForce && sites.length && this.isJSEnabled(sites[sites.length - 1]);
      var isHTMLScript;
      while (scount-- > 0) {
        script = scripts.item(scount);
        isHTMLScript = script instanceof HTMLElement;
        if (isHTMLScript) {
          scriptSrc = script.src;
        } else if(script) {
          scriptSrc = script.getAttribute("src");
          if (!/^[a-z]+:\/\//i.test(scriptSrc)) continue;
        } else continue;
        
        scriptSrc = this.getSite(scriptSrc);
        if (scriptSrc) {
          sites.push(scriptSrc);
          if (nselForce && isHTMLScript && !this.isJSEnabled(scriptSrc)) {
            this.showNextNoscriptElement(script);
          }
        }
      }
    }
  },
  
  showNextNoscriptElement: function(script, doc) { 
    const HTMLElement = CI.nsIDOMHTMLElement;
    var child, el, ss, j;
    for (var node = script; node = node.nextSibling;) {
      try {
        if (node instanceof HTMLElement) {
          if (node.tagName.toUpperCase() != "NOSCRIPT") return;
          if (node.getAttribute("class") == "noscript-show") return;
          node.setAttribute("class", "noscript-show");
          child = node.firstChild;
          if (child.nodeType != 3) return;
          el = node.ownerDocument.createElementNS(HTML_NS, "span");
          el.className = "noscript-show";
          el.innerHTML = child.nodeValue;
          // remove noscript script children, see evite.com bug 
          ss = el.getElementsByTagName("script");
          for(j = ss.length; j-- > 0;) el.removeChild(ss[j]);
          node.replaceChild(el, child);
        }
      } catch(e) {
        this.dump(e.message + " while showing NOSCRIPT element");
      }
    }
  },
  
  metaRefreshWhitelist: {},
  processMetaRefresh: function(document, notifyCallback) {
    var docShell = DOM.getDocShellForWindow(document.defaultView);
    if (!this.forbidMetaRefresh ||    
       this.metaRefreshWhitelist[document.documentURI] ||
       this.isJSEnabled(this.getSite(document.documentURI)) ||
       !document.getElementsByTagName("noscript")[0]
       ) {
      if (!docShell.allowMetaRedirects) this.disableMetaRefresh(docShell); // refresh blocker courtesy
      return;
    }
    try {
      var refresh, content, timeout, uri;
      var rr = document.getElementsByTagName("meta");
      for (var j = 0; (refresh = rr[j]); j++) {
        if (!/refresh/i.test(refresh.httpEquiv)) continue;
        content = refresh.content.split(/[,;]/, 2);
        uri = content[1];
        if (uri) {
          if (notifyCallback && !(document.documentURI in this.metaRefreshWhitelist)) {
            timeout = content[0];
            uri = uri.replace (/^\s*/, "").replace (/^URL/i, "URL").split("URL=", 2)[1];
            try {
              notifyCallback({ 
                docShell: docShell,
                document: document,
                baseURI: docShell.currentURI,
                uri: uri, 
                timeout: timeout
              });
            } catch(e) {
              dump("[NoScript]: " + e + " notifying meta refresh at " + document.documentURI + "\n");
            }
          }
          document.defaultView.addEventListener("pagehide", function(ev) {
              ev.currentTarget.removeEventListener(ev.type, arguments.callee, false);
              docShell.allowMetaRedirects = true;
              document = docShell = null;
          }, false);
          this.disableMetaRefresh(docShell);
          return;
        }
      }
    } catch(e) {
      dump("[NoScript]: " + e + " processing meta refresh at " + document.documentURI + "\n");
    }
  },
  doFollowMetaRefresh: function(metaRefreshInfo, forceRemember) {
    var document = metaRefreshInfo.document;
    if (forceRemember || this.getPref("forbidMetaRefresh.remember", false)) {
      this.metaRefreshWhitelist[document.documentURI] = metaRefreshInfo.uri;
    }
    var docShell = metaRefreshInfo.docShell || DOM.getDocShellForWindow(document.defaultView); 
    this.enableMetaRefresh(docShell);
    if (docShell instanceof CI.nsIRefreshURI) {
      var baseURI = metaRefreshInfo.baseURI || IOS.newURI(document.documentURI, null, null);
      docShell.setupRefreshURIFromHeader(baseURI, "0;" + metaRefreshInfo.uri);
    }
  },
  doBlockMetaRefresh: function(metaRefreshInfo) {
    if (this.getPref("forbidMetaRefresh.remember", true)) {
      var document = metaRefreshInfo.document;
      this.metaRefreshWhitelist[document.documentURI] = null;
    }
  },
  
  enableMetaRefresh: function(docShell) {
    if (docShell) {
      docShell.allowMetaRedirects = true;
      docShell.resumeRefreshURIs();
      // if(this.consoleDump) dump("Enabled META refresh on " + (docShell.currentURI && docShell.currentURI.spec) + "\n");
    }
  },
  disableMetaRefresh: function(docShell) {
    if (docShell) {
      docShell.suspendRefreshURIs();
      docShell.allowMetaRedirects = false;
      if (docShell instanceof CI.nsIRefreshURI) {
        docShell.cancelRefreshURITimers();
      }
      // if(this.consoleDump) dump("Disabled META refresh on " + (docShell.currentURI && docShell.currentURI.spec) + "\n");
    }
  },
  
  
  
  // These catch both Paypal's variant,
  // if (parent.frames.length > 0){ top.location.replace(document.location); }
  // and the general concise idiom with its common reasonable permutations,
  // if (self != top) top.location = location
  _frameBreakNoCapture: /\bif\s*\(\s*(?:(?:(?:window|self|top)\s*\.\s*)*(?:window|self|top)\s*!==?\s*(?:(?:window|self|top)\s*\.\s*)*(?:window|self|top)|(?:(?:window|self|parent|top)\s*\.\s*)*(?:parent|top)\.frames\.length\s*(?:!==?|>)\s*0)\s*\)\s*\{?\s*(?:window\s*\.\s*)?top\s*\.\s*location\s*(?:\.\s*(?:replace|assign)\s*\(|(?:\s*\.\s*href\s*)?=)\s*(?:(?:document|window|self)\s*\.\s*)?location(?:\s*.\s*href)?\s*\)?\s*;?\s*\}?/,
  _frameBreakCapture: /^\(function\s[^\{]+\{\s*if\s*\(\s*(?:(?:(?:window|self|top)\s*\.\s*)*(window|self|top)\s*!==?\s*(?:(?:window|self|top)\s*\.\s*)*(window|self|top)|(?:(?:window|self|parent|top)\s*\.\s*)*(?:parent|top)\.frames\.length\s*(?:!==?|>)\s*0)\s*\)\s*\{?\s*(?:window\s*\.\s*)?top\s*\.\s*location\s*(?:\.\s*(?:replace|assign)\s*\(|(?:\s*\.\s*href\s*)?=)\s*(?:(?:document|window|self)\s*\.\s*)?location(?:\s*.\s*href)?\s*\)?\s*;?\s*\}?/,
  doEmulateFrameBreak: function(w) {
    // If JS is disabled we check the top 5 script elements of the page searching for the first inline one:
    // if it starts with a frame breaker, we honor it.
    var d = w.document;
    var url = d.URL;
    if (!/^https?:/.test(url) || this.isJSEnabled(this.getSite(url))) return false;
    var ss = d.getElementsByTagName("script");
    var sc, m, code;
    for (var j = 0, len = 5, s; j < len && (s = ss[j]); j++) {
      code = s.innerHTML;
      if (code && /\S/.test(code)) {
        if (this._frameBreakNoCapture.test(code)) {
          try {
            sc = sc || new SyntaxChecker();
            var m;
            if (sc.check(code) && 
                (m = sc.lastFunction.toSource().match(this._frameBreakCapture)) && 
                (!m[1] || (m[1] == "top" || m[2] == "top") && m[1] != m[2])) {
              var top = w.top;

              var ds = DOM.getDocShellForWindow(top);
              var allowJavascript = ds.allowJavascript;
              var allowPlugins = ds.allowPlugins;
              if (allowJS) { // temporarily disable JS & plugins on the top frame to prevent counter-busting 
                ds.allowJavascript = ds.allowPlugins = false;
                top.addEventListener("pagehide", function(ev) {
                  ev.currentTarget.removeEventListener(ev.type, arguments.calle, false);
                  ds.allowJavascript = allowJavascript;
                  ds.allowPlugins = allowPlugins;
                }, false);
              }
              top.location.href = url;
              var body = d.body;
              if (body) while(body.firstChild) body.removeChild(body.firstChild);
              return true;
            }
          } catch(e) {
            this.dump("Error checking " + code + ": " + e.message);
          }
        }
        break; // we want to check the first inline script only
      }
    }
    return false;
  },
  
  knownFrames: {
    _history: {},
    add: function(url, parentSite) {
      var f = this._history[url] || (this._history[url] = []);
      if (f.indexOf(parentSite) > -1) return;
      f.push(parentSite);
    },
    isKnown: function(url, parentSite) {
      var f = this._history[url];
      return f && f.indexOf(parentSite) > -1;
    },
    reset: function() {
      this._history = {}
    }
  },
  
  frameContentLoaded: function(w) {
    if (this.emulateFrameBreak && this.doEmulateFrameBreak(w)) return; // we're no more framed

    if ((this.forbidIFrames && w.frameElement instanceof CI.nsIDOMHTMLIFrameElement ||
         this.forbidFrames  && w.frameElement instanceof CI.nsIDOMHTMLFrameElement) &&
        this.getPref("rememberFrames", false)) {
      this.knownFrames.add(w.location.href, this.getSite(w.parent.location.href));
    }
  },
  
  
  handleBookmark: function(url, openCallback) {
    if (!url) return true;
    const allowBookmarklets = !this.getPref("forbidBookmarklets", false);
    const allowBookmarks = this.getPref("allowBookmarks", false);
    if (!this.jsEnabled && 
      (allowBookmarks || allowBookmarklets)) {
      try {
        var site;
        if (allowBookmarklets && /^\s*(?:javascript|data):/i.test(url)) {
          var ret = this.executeJSURL(url, openCallback);
        } else if (allowBookmarks && !this.isUntrusted(site = this.getSite(url))) {
          this.setJSEnabled(site, true);
        }
        return ret;
      } catch(e) {
        if (ns.consoleDump) ns.dump(e + " " + e.stack);
      }
    }
    return false;
  },
  
  executeJSURL: function(url, openCallback) {
    var browserWindow = DOM.mostRecentBrowserWindow;
    var browser = browserWindow.noscriptOverlay.currentBrowser;
    if(!browser) return false;
    
    var window = browser.contentWindow;
    if(!window) return false;
    
    var site = this.getSite(window.document.documentURI) || this.getExpando(browser, "jsSite");
    if (!this.jsEnabled) {
      if(this.consoleDump) this.dump("Executing JS URL " + url + " on site " + site);
      
      var snapshots = {
        docJS: browser.webNavigation.allowJavascript,
        siteJS: this.isJSEnabled(site)
      };
    

      try {
        this.setJSEnabled(site, true);
        browser.webNavigation.allowJavascript = true;
        this.jsEnabled = ns.getPref("allowBookmarkletImports");
          
     
        if (Thread.canSpin) { // async evaluation, after bug 351633 landing
          var doc = window.document;
          try {
            if (!(snapshots.siteJS && snapshots.docJS)) {
              this._runJS(window, "(" +
                function() {
                  var tt = [];
                  window.setTimeout = window.setInterval = function(f, d, a) {
                    if (typeof(f) != 'function') f = new Function(f || '');
                    tt.push({f: f, d: d, a: a});
                    return 0;
                  };
                  window.__runTimeouts = function() {
                    var t, count = 0;
                    while (tt.length && count++ < 50) { // let's prevent infinite pseudo-loops
                      tt.sort(function(b, a) { return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); });
                      t = tt.pop();
                      t.f.call(window, t.a);
                    }
                    delete window.__runTimeouts;
                    delete window.setTimeout;
                  };
                }.toSource()
              + ")()");
            }
            
            if (openCallback) {
              window.location.href = url;
            } else {
              var s = doc.createElement("script");
              s.appendChild(doc.createTextNode(url));
              doc.documentElement.appendChild(s);
            }
            
            Thread.yieldAll();
            if (!(snapshots.siteJS && snapshots.docJS)) {
              this._runJS(window,
                        "if (typeof window.__runTimeouts == 'function') window.__runTimeouts()");
            }
            
          } catch(e) {
            if(this.consoleDump) this.dump("JS URL execution failed: " + e);
          }
        } else {
          openCallback(url);
        }
        return true;
      } finally {
        this.jsEnabled = false;
        this.setJSEnabled(site, snapshots.siteJS);
        this.setExpando(browser, "jsSite", site);
        if (!browser.webNavigation.isLoadingDocument && this.getSite(browser.webNavigation.currentURI.spec) == site)
          browser.webNavigation.allowJavascript = snapshots.docJS;
        if (this.consoleDump & LOG_JS)
          this.dump("Restored snapshot permissions on " + site + "/" + (browser.webNavigation.isLoadingDocument ? "loading" : browser.webNavigation.currentURI.spec));
      }
    }
    
    return false;
  },
  _runJS: function(window, s) {
    window.location.href = "javascript:" + encodeURIComponent(s + "; void(0);");
    Thread.yieldAll();
  },
  
  isCheckedChannel: function(c) {
    return IOUtil.extractFromChannel(c, "noscript.checkedChannel", true);
  },
  setCheckedChannel: function(c, v) {
    IOUtil.attachToChannel(c, "noscript.checkedChannel", v ? {} : null);
  },
  
  createCheckedXHR: function(method, url, async) {
    if (typeof(async) == "undefined") async = true;
    var xhr = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
    xhr.open(method, url, async);
    this.setCheckedChannel(xhr.channel, true);
    return xhr;
  },
  
  mimeEssentials: function(mime) {
     return mime && mime.replace(/^application\/(?:x-)?/, "") || "";
  },
  urlEssentials: function(s) {
    // remove query, hash and intermediate path
    return s.replace(/[#\?].*/g, '').replace(/(.*?\w\/).+?(\/[^\/]+)$/, '$1...$2');
  },
  cssMimeIcon: function(mime, size) {
    return mime == "application/x-shockwave-flash"
    ? // work around for Windows not associating a sane icon to Flash
      'url("' + this.skinBase + "flash" + size + '.png")'
    : /^application\/x-java\b/i.test(mime)
      ? 'url("' + this.skinBase + "java" + size + '.png")'
      : mime == "application/x-silverlight"
        ? 'url("' + this.skinBase + "somelight" + size + '.png")'
        : /^font\b/i.test(mime)
          ? 'url("' + this.skinBase + 'font.png")'
          : 'url("moz-icon://noscript?size=' + size + '&contentType=' + mime.replace(/[^\w-\/]/g, '') + '")';
  },
  
  
  findObjectAncestor: function(embed) {
    const objType = CI.nsIDOMHTMLObjectElement;
    if (embed instanceof CI.nsIDOMHTMLEmbedElement || embed instanceof objType) {
      for (var o = embed; (o = o.parentNode);) {
        if (o instanceof objType) return o;
      }
    }
    return embed;
  },
  
  findPluginExtras: function(document) {
    var res = this.getExpando(document, "pluginExtras", []);
    if ("opaqueHere" in res) return res;
    var url = document.defaultView.location.href;
    res.opaqueHere = this.appliesHere(this.opaqueObject, url) && /^(?:ht|f)tps?:/i.test(url);
    return res;
  },
  
  
  OpaqueHandlers: {
    
    getOpaqued: function(w) {
      const cs = "__noscriptOpaqued__";
      if (w.__noscriptOpaquedObjects) return w.__noscriptOpaquedObjects;
      var doc = w.document;
      if (doc.getElementsByClassName) return Array.slice(doc.getElementsByClassName(cs));
      var results = [];
      var query = doc.evaluate(
          "//*[contains(concat(' ', @class, ' '), ' " + cs + " ')]",
          w.document, null, CI.nsIDOMXPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0, len = query.snapshotLength; i < len; i++) {
         results.push(query.snapshotItem(i));
      }
      return results;                                                     
    },
    
    get fixScrollers() {
      var self = this;
      var f = function(ev) {
        var w = ev.currentTarget;
        
        var o, s, cs;
        var oo = self.getOpaqued(w);
        var d = w.document;
        var de = d.documentElement;
        var db = d.body;
        var scrollers = [];
        for each(o in oo) {
          if (o == de || o == db) continue;
          try {
            s = w.getComputedStyle(o, '');
            if (s && s.display == "block" && s.overflow == "hidden" || /^(?:i?frame|object)$/i.test(o.tagName))
              scrollers.push(o);
          } catch(e) {
            dump(e + ", " + e.stack + "\n");
          }
        }
        for each(var o in scrollers) {
          DOM.addClass(o, "__noscriptScrolling__");
        }
        
        switch(ev.type) {
          case "timeout":
            Thread.delay(arguments.callee, ev.timeout, this, [ev]);
            break;
          case "load":
            w.__noscriptOpaquedObjects = null;
          default:
            w.removeEventListener(ev.type, arguments.callee, false);
        }
      };
      delete this.fixScrollers;
      return this.fixScrollers = f;
    },
    
    scheduleFixScrollers: function(w, timeout) {
      var ev = { currentTarget: w, type: "timeout", timeout: timeout };
      Thread.delay(this.fixScrollers, timeout, this, [ev]);
    },
    
    getOpaquedObjects: function(w, noscroll) {
      var oo = w.__noscriptOpaquedObjects;
      if (!oo) {
        oo = [];
        w.__noscriptOpaquedObjects = oo;
        if (!noscroll) {
          w.addEventListener("load", this.fixScrollers, false);
          w.addEventListener("DOMContentLoaded", this.fixScrollers, false);
          this.scheduleFixScrollers(w, 3000);
        }
      }
      return oo;
    }
    
  },
  
  opaque: function(o, scrollNow) {
    if (o.__noscriptOpaqued) return;
    try {
      
      if (o.contentDocument && this.clearClickHandler.sameSiteParents(o.contentDocument.defaultView)) return;
      
      var d = o.ownerDocument;
      var w = d.defaultView;
      var oh = this.OpaqueHandlers;
      var oo = oh.getOpaquedObjects(w, scrollNow || this.clearClickHandler.isSupported(d) && this.appliesHere(this.clearClick, w.top.location.href));
      if (scrollNow) oh.scheduleFixScrollers(w, 1);
      do {
        o.__noscriptOpaqued = true;
        o.style.opacity = "";
        DOM.addClass(o, "__noscriptOpaqued__");
        oo.push(o);
        if (this.consoleDump & LOG_CLEARCLICK) this.dump("Opacizing " + o.tagName);
        o = o.parentNode;
      } while(o && o.style && !o.__noscriptOpaqued);
    } catch(e) {
      this.dump("Error opacizing " + o.tagName + ": " + e.message + ", " + e.stack);
    }
  },
  
  opaqueIfNeeded: function(o, doc) {
    if (this.findPluginExtras(doc || o.ownerDocument).opaqueHere)
      this.opaque(o);
  },
  
  appliesHere: function(pref, url) {
    return pref && ((ANYWHERE & pref) == ANYWHERE||
       (this.isJSEnabled(this.getSite(url))
        ? (WHERE_TRUSTED & pref) : (WHERE_UNTRUSTED & pref)
       )
      );
  },
  
  _preprocessObjectInfo: function(doc) {
    var pe = this.getExpando(doc, "pe");
    if (!pe) return null;
    this.setExpando(doc, "pe", null);
    var ret = [], o;
    for (var j = pe.length; j-- > 0;) {
      o = pe[j];
      try {
        if (this.getExpando(o, "silverlight")) {
          o.embed = this._attachSilverlightExtras(o.embed, o.pluginExtras);
          if (!o.embed) continue; // skip unconditionally to prevent in-page Silverlight placeholders
        }
        o.originalEmbed = o.embed;
        this.setPluginExtras(o.embed = this.findObjectAncestor(o.embed), o.pluginExtras);
        if (o.embed.ownerDocument) ret.push(o);
       } catch(e1) { 
         if(this.consoleDump & LOG_CONTENT_BLOCK) 
           this.dump("Error setting plugin extras: " + 
             (o && o.pluginExtras && o.pluginExtras.url) + ", " + e1); 
       }
    }
    return ret;
  },
  
  processObjectElements: function(document, sites, loaded) {
    var pluginExtras = this.findPluginExtras(document);
    sites.pluginCount += pluginExtras.length;
    sites.pluginExtras.push(pluginExtras);
    
    var objInfo = this._preprocessObjectInfo(document);
    if (!objInfo) return;
    var count = objInfo.length;
    sites.pluginCount += count;
    
    
    var collapse = this.collapseObject;

    var oi, object, objectTag;
    var anchor, innerDiv, iconSize;
    var extras;
    var cssLen, cssCount, cssProp, cssDef;
    var style, astyle;
    
    var replacements = null;
    var w, h;
    var opaque = pluginExtras.opaqueHere;
    
    var minSize = this.getPref("placeholderMinSize");
    var restrictedSize;
    
    var forcedCSS = ";";
    var pluginDocument = false;       
    try {
      pluginDocument = count == 1 && (objInfo[0].pluginExtras.url == document.URL) && !objInfo[0].embed.nextSibling;
      if (pluginDocument) {
        collapse = false;
        forcedCSS = ";outline-style: none !important;-moz-outline-style: none !important;";
      }
    } catch(e) {}
    
    var win = document.defaultView;      

    while (count--) {
      oi = objInfo[count];
      object = oi.embed;
      extras = oi.pluginExtras;
      objectTag = object.tagName;
      
      try {

        extras.site = this.getSite(extras.url);
        
        if(!this.showUntrustedPlaceholder && this.isUntrusted(extras.site)) {
          this.removeAbpTab(object);
          continue;
        }
        
        extras.tag = "<" + (this.isLegacyFrameReplacement(object) ? "FRAME" : objectTag.toUpperCase()) + ">";
        extras.title =  extras.tag + ", " +  
            this.mimeEssentials(extras.mime) + "@" + extras.url;
        
       if ((extras.alt = object.getAttribute("alt")))
          extras.title += ' "' + extras.alt + '"'
        
        
        anchor = document.createElementNS(HTML_NS, "a");
        anchor.id = object.id;
        anchor.href = extras.url;
        anchor.setAttribute("title", extras.title);
        
        this.setPluginExtras(anchor, extras);
        this.setExpando(anchor, "removedNode", object);
     
        (replacements = replacements || []).push({object: object, placeholder: anchor, extras: extras });

        if (this.showPlaceholder) {
          if (!pluginExtras.overlayListener) {
            pluginExtras.overlayListener = true;
            win.addEventListener("click", this.bind(this.onOverlayedPlaceholderClick), true);
          }
          anchor.addEventListener("click", this.bind(this.onPlaceholderClick), true);
          anchor.className = "__noscriptPlaceholder__";
          if (this.abpRemoveTabs) this.removeAbpTab(object);
        } else {
          anchor.className = "";
          if(collapse) anchor.style.display = "none";
          else anchor.style.visibility = "hidden";
          this.removeAbpTab(object); 
          continue;
        }
        
        innerDiv = document.createElementNS(HTML_NS, "div");
        innerDiv.className = "__noscriptPlaceholder__1";
        
        with (anchor.style) {
          padding = margin = borderWidth = "0px";
          outlineOffset = MozOutlineOffset = "-1px"; 
          display = "inline";
        }
        
        cssDef = "";
        style = win.getComputedStyle(oi.originalEmbed, null);
        if (style) {
          for (cssCount = 0, cssLen = style.length; cssCount < cssLen; cssCount++) {
            cssProp = style.item(cssCount);
            cssDef += cssProp + ": " + style.getPropertyValue(cssProp) + ";";
          }
          
          innerDiv.setAttribute("style", cssDef + forcedCSS);
          
          if (style.width == "100%" || style.height == "100%") {
            anchor.style.width = style.width;
            anchor.style.height = style.height;
            anchor.style.display = "block";
          }
        }
        
        restrictedSize = (collapse || style.display == "none" || style.visibility == "hidden");
        if (restrictedSize) {
          innerDiv.style.maxWidth = anchor.style.maxWidth = "32px";
          innerDiv.style.maxHeight = anchor.style.maxHeight = "32px";
        }
        
        // if (innerDiv.style.display != "none") innerDiv.style.display = "block";
        innerDiv.style.visibility = "visible";

        anchor.appendChild(innerDiv);
        
        // icon div
        innerDiv = innerDiv.appendChild(document.createElementNS(HTML_NS, "div"));
        innerDiv.className = "__noscriptPlaceholder__2";
        
        if(restrictedSize || style && (parseInt(style.width) < 64 || parseInt(style.height) < 64)) {
          innerDiv.style.backgroundPosition = "bottom right";
          iconSize = 16;
          w = parseInt(style.width);
          h = parseInt(style.height);
          if (minSize > w || minSize > h) {
            with (innerDiv.parentNode.style) {
              minWidth = Math.max(w, Math.min(document.documentElement.clientWidth - object.offsetLeft, minSize)) + "px";
              minHeight = Math.max(h, Math.min(document.documentElement.clientHeight - object.offsetTop, minSize)) + "px";
            }
            with (anchor.style) {
              overflow = "visible";
              display = "block";
              width = w + "px";
              height = h + "px";
            }
            anchor.style.float = "left";
          }
        } else {
          iconSize = 32;
          innerDiv.style.backgroundPosition = "center";
        }
        innerDiv.style.backgroundImage = this.cssMimeIcon(extras.mime, iconSize);
        
      } catch(objectEx) {
        ns.dump(objectEx + " processing plugin " + count + "@" + document.documentURI + "\n");
      }
      
    }

    if (replacements) {
      this.delayExec(this.createPlaceholders, 0, replacements, pluginExtras, document);
    }
  },
  
  createPlaceholders: function(replacements, pluginExtras, document) {
    for each (var r in replacements) {
      try {
        if (r.extras.pluginDocument) {
          this.setPluginExtras(r.object, null);
          if (r.object.parentNode) r.object.parentNode.insertBefore(r.placeholder, r.object);
        } else {
          if (r.object.parentNode) r.object.parentNode.replaceChild(r.placeholder, r.object);
        }
        r.extras.placeholder = r.placeholder;
        this._collectPluginExtras(pluginExtras, r.extras);
        if (this.abpInstalled && !this.abpRemoveTabs)
          this.adjustAbpTab(r.placeholder);
      } catch(e) {
        this.dump(e);
      }
    }
    this.syncUI(document.defaultView.top);
  },
  
  bind: function(f) {
    return "_bound" in f ? f._bound : f._bound = (function() { return f.apply(ns, arguments); });
  },
  
  onPlaceholderClick: function(ev, anchor) {
    if (ev.button) return;
    anchor = anchor || ev.currentTarget
    const object = this.getExpando(anchor, "removedNode");
    
    if (object) try {
      if (ev.shiftKey) {
        anchor.style.display = "none";
        anchor.id = anchor.className = "";
        this.removeAbpTab(anchor);
        return;
      }
      this.checkAndEnablePlaceholder(anchor, object);
    } finally {
      ev.preventDefault();
      ev.stopPropagation();
    }
  },
  
  onOverlayedPlaceholderClick: function(ev) {
    var el = ev.originalTarget;
    var d = el.ownerDocument;
    var style = d.defaultView.getComputedStyle(el, "");
    if (style.position == "absolute") {
      var pluginExtras = this.findPluginExtras(d);
      if (!pluginExtras) return;
      var p = { x: ev.clientX, y: ev.clientY };
      for (var j = pluginExtras.length; j-- > 0;) {
        pe = pluginExtras[j];
        if (pe.placeholder) try {
          if (DOM.elementContainsPoint(pe.placeholder, p)) {
            var object = this.getExpando(pe.placeholder, "removedNode");
            if (object && !(object instanceof CI.nsIDOMHTMLAnchorElement))
              this.setExpando(object, "overlay", el);
            this.onPlaceholderClick(ev, pe.placeholder);
            return;
          }
        } catch(e) {
          if (ns.consoleDump) ns.dump(e);
        }
      }
    }
  },
  
  get abpInstalled() {
    delete this.abpInstalled;
    return this.abpInstalled = "@mozilla.org/adblockplus;1" in CC;
  },
  
  grabAbpTab: function(ref) {
    if (!this.abpInstalled) return null;
    var ot = ref.previousSibling;
    return (ot && (ot instanceof CI.nsIDOMHTMLAnchorElement) && !ot.firstChild && /\babp-objtab-/.test(ot.className))
      ? ot : null; 
  },
  
  removeAbpTab: function(ref) {
    var ot = this.grabAbpTab(ref);
    if (ot) {
      ot.parentNode.removeChild(ot);
    }
  },
  
  adjustAbpTab: function(ref) {
    var ot = this.grabAbpTab(ref);
    if (ot) {
      var style = ot.style;
      style.setProperty("left", ref.offsetWidth + "px", "important");
      if (!/\bontop\b/.test(ot.className)) {
        style.setProperty("top", ref.offsetHeight + "px", "important");
      }
    }
  },
  
  checkAndEnablePlaceholder: function(anchor, object) {
    if (!(object || (object = this.getExpando(anchor, "removedNode")))) {
      if (ns.consoleDump) ns.dump("Missing node on placeholder!");
      return;
    }
    
    if (ns.consoleDump) ns.dump("Enabling node from placeholder...");
    
    const extras = this.getPluginExtras(anchor);
    const browser = DOM.findBrowserForNode(anchor);
 
    if (!(extras && extras.url && extras.mime // && cache
      )) return;
   
    this.delayExec(this.checkAndEnableObject, 1,
      {
        browser: browser,
        window: browser.ownerDocument.defaultView,
        extras: extras,
        anchor: anchor,
        object: object
      });
  },
  
  confirmEnableObject: function(win, extras) {
    return extras.skipConfirmation || win.noscriptUtil.confirm(
      this.getAllowObjectMessage(extras.url, 
          (extras.tag || "<OBJECT>") + ", " + extras.mime), 
      "confirmUnblock"
    );
  },
  
  isLegacyFrameDocument: function(doc) {
    return (doc.defaultView.frameElement instanceof CI.nsIDOMHTMLFrameElement) && this.isPluginDocumentURL(doc.URL, "iframe");
  },
  isLegacyFrameReplacement: function(obj) {
     return (obj instanceof CI.nsIDOMHTMLIFrameElement || obj instanceof CI.nsIDOMHTMLAnchorElement) &&
           (obj.ownerDocument.defaultView.frameElement instanceof CI.nsIDOMHTMLFrameElement) &&
           obj.ownerDocument.URL == this.createPluginDocumentURL(obj.src || obj.href, "iframe");
  },
  
  checkAndEnableObject: function(ctx) {
    var extras = ctx.extras;
    if (this.confirmEnableObject(ctx.window, extras)) {

      var mime = extras.mime;
      var url = extras.url;
      
      this.allowObject(url, mime);
      var doc = ctx.anchor.ownerDocument;
      
      var isLegacyFrame = this.isLegacyFrameReplacement(ctx.object);
       
      if (isLegacyFrame || (mime == doc.contentType && 
          (ctx.anchor == doc.body.firstChild && 
           ctx.anchor == doc.body.lastChild ||
           (ctx.object instanceof CI.nsIDOMHTMLEmbedElement) && ctx.object.src != url))
        ) { // stand-alone plugin or frame
          doc.body.removeChild(ctx.anchor); // TODO: add a throbber
          if (isLegacyFrame) {
            this.setExpando(doc.defaultView.frameElement, "allowed", true);
            // doc.defaultView.frameElement.src = url;
            doc.defaultView.location.replace(url);
          } else this.quickReload(doc.defaultView, true);
      } else if (this.requireReloadRegExp && this.requireReloadRegExp.test(mime) || this.getExpando(ctx, "requiresReload")) {
        this.quickReload(doc.defaultView);
      } else if (this.getExpando(ctx, "silverlight")) {
        this.allowObject(doc.documentURI, mime);
        this.quickReload(doc.defaultView);
      } else {
        this.setExpando(ctx.anchor, "removedNode", null);
        extras.placeholder = null;
        this.delayExec(function() {
          try {
            this.removeAbpTab(ctx.anchor);
            var jsEnabled = ns.isJSEnabled(ns.getSite(doc.documentURI));
            var obj = ctx.object.cloneNode(true);
            
            function reload() {
              ns.allowObjectById(obj.id, url, doc.documentURI, mime);
              ns.quickReload(doc.defaultView);
            }
            
            var isMedia = ("nsIDOMHTMLVideoElement" in CI) && (obj instanceof CI.nsIDOMHTMLVideoElement || obj instanceof CI.nsIDOMHTMLAudioElement);
            
            if (isMedia) {
              if (jsEnabled && !obj.controls) {
                // we must reload, since the author-provided UI likely had no chance to wire events
                reload();
                return;
              }
              obj.autoplay = true;
            }
            
            
            this.setExpando(obj, "allowed", true);
            ctx.anchor.parentNode.replaceChild(obj, ctx.anchor);
            var style = doc.defaultView.getComputedStyle(obj, '');
            if (jsEnabled && ((obj.offsetWidth || parseInt(style.width)) < 2 || (obj.offsetHeight || parseInt(style.height)) < 2))
              Thread.delay(function() {
                if (obj.offsetWidth < 2 || obj.offsetHeight < 2) reload();
              }, 100); // warning, asap() or timeout=0 won't always work!
            
            
          } finally {
            ctx = null;
          }
        }, 10);
        return;
      }
    }
    ctx = null;
  },

  getSites: function(browser) {
    var sites = [];
    sites.scriptCount = 0;
    sites.pluginCount = 0;
    sites.pluginExtras = [];
    sites.pluginSites = [];
    sites.docSites = [];
    try {
      sites = this._enumerateSites(browser, sites);
    } catch(ex) {
      if (this.consoleDump) this.dump("Error enumerating sites: " + ex + "," + ex.stack);
    }
    return sites;
  },
  
  
  _collectPluginExtras: function(pluginExtras, extras) {
    for (var e, j = pluginExtras.length; j-- > 0;) {
      e = pluginExtras[j];
      if (e == extras) return false;
      if (e.mime == extras.mime && e.url == extras.url) {
        if (!e.placeholder) {
          pluginExtras.splice(j, 1, extras);
          return true;
        }
        return false;
      }
    }
    pluginExtras.push(extras);
    return true;
  },
  
  _silverlightPatch: function() {
    HTMLObjectElement.prototype.__defineGetter__("IsVersionSupported", function() {
      return (this.type == 'application/x-silverlight')
        ? function(n) { return true; } : undefined;
    });
  }.toSource(),
  
  _flashPatch: function() {
    var type = "application/x-shockwave-flash";
    var ver;
    var setAttribute = HTMLObjectElement.prototype.setAttribute;
    HTMLObjectElement.prototype.setAttribute = function(n, v) {
      if (n == "type" && v == type && !this.data) {
        this._pendingType = v;
        
        if (!ver) {
          this.SetVariable = function() {};
          this.GetVariable = function(n) {
            if (n != "$version") return;
            
            if (!ver) {
              ver = navigator.plugins["Shockwave Flash"]
                .description.match(/(\d+)\.(\d+)(?:\s*r(\d+))?/);
              
              ver.shift();
              ver.push('99');
              ver = "WIN " + ver.join(",");
            }
            
            return;
          }
        }
        
        return;
      }
      setAttribute.call(this, n, v);
      if (n == "data" && ("_pendingType" in this) && this._pendingType == type) {
        this.setAttribute("type", type);
        this._pendingType = null;
      }
    };

  }.toSource(),
  
  applyPluginPatches: function(doc) {
    try {
      if (this.getExpando(doc, "pluginPatches")) return;
      this.setExpando(doc, "pluginPatches", true);
          
      var patches;
      
      if (this.forbidFlash && this.flashPatch) {
        (patches = patches || []).push(this._flashPatch);
        if (this.consoleDump & LOG_CONTENT_BLOCK) this.dump("Patching HTMLObject for SWFObject compatibility.");
      }
      if (this.forbidSilverlight && this.silverlightPatch) {
        (patches = patches || []).push(this._silverlightPatch);
        if (this.consoleDump & LOG_CONTENT_BLOCK) this.dump("Patching HTMLObject for Silverlight compatibility.");
      }
      
      if (!patches) return;

      ScriptSurrogate.execute(doc, "(" + patches.join(")();(") + ")();");
    } catch(e) {
       if (this.consoleDump) this.dump(e);
    }
  },
  
  _attachSilverlightExtras: function(embed, extras) {
    extras.silverlight = true;
    var pluginExtras = this.findPluginExtras(embed.ownerDocument);
    if (this._collectPluginExtras(pluginExtras, extras)) {
      extras.site = this.getSite(extras.url);
      try {
        // try to work around the IsInstalled() Silverlight machinery
        if (!embed.firstChild) { // dummy embed
          exras.dummy = true;
          return null;
        }
        extras.dummy = false;
      } catch(e) {
        if(this.consoleDump) this.dump(e);
      }
    }
    return embed;
  },
  
  _enumerateSites: function(browser, sites) {

    
    const nsIDocShell = CI.nsIDocShell;
    const nsIWebProgress = CI.nsIWebProgress;
    
    const docShells = browser.docShell.getDocShellEnumerator(
        CI.nsIDocShellTreeItem.typeContent,
        browser.docShell.ENUMERATE_FORWARDS
    );
    
    var loading = false, loaded = false, domLoaded = false;
    
    var docShell, docURI, url, win;

    var cache, redir, tmpPluginCount;
    
    var document, domain;
    while (docShells.hasMoreElements()) {
       
      docShell = docShells.getNext();
      document = (docShell instanceof nsIDocShell) &&
                 docShell.contentViewer && docShell.contentViewer.DOMDocument;
      if (!document) continue;
      
      // Truncate title as needed
      if (this.truncateTitle && document.title.length > this.truncateTitleLen) {
        document.title = document.title.substring(0, this.truncateTitleLen);
      }
      
      // Collect document / cached plugin URLs
      win = document.defaultView;
      url = this.getSite(docURI = document.documentURI);
      
      if (url) {
        try {
          if (document.domain && document.domain != this.getDomain(url, true) && url != "chrome:" && url != "about:blank") {
           // temporary allow changed document.domain on allow page
            if (this.getExpando(browser, "allowPageURL") == browser.docShell.currentURI.spec &&
                this.getBaseDomain(document.domain).length >= document.domain.length &&
                !(this.isJSEnabled(document.domain) || this.isUntrusted(document.domain))) {
             this.setTemp(site, true);
             this.setJSEnabled(document.domain, true);
             this.quickReload(win);
           }
           sites.unshift(document.domain);
          }
        } catch(e) {}
        
        sites.docSites.push(url);
        sites.push(url);

        for each(redir in this.getRedirCache(browser, docURI)) {
          sites.push(redir.site);
        }
      }
       
       
      tmpPluginCount = 0;
      
      domLoaded = this.getExpando(win, "contentLoaded");
      
      if (win == win.top) {
        cache = this.getExpando(document, "objectSites");
        if(cache) {
          if(this.consoleDump & LOG_CONTENT_INTERCEPT) this.dump("Adding plugin sites: " + cache.toSource());
          sites.push.apply(sites, cache);
          tmpPluginCount = cache.length;
          sites.pluginSites.push.apply(sites, cache);
        }
        
        cache = this.getExpando(document, "codeSites");
        if(cache) sites.push.apply(sites, cache);
        
        if (domLoaded) this.setExpando(browser, "allowPageURL", null);
      }
      
       // plugins
      this.processObjectElements(document, sites);
      
      loaded = !((docShell instanceof nsIWebProgress) && docShell.isLoadingDocument);
      if (!(domLoaded || loaded)) {
        sites.pluginCount += tmpPluginCount;
        loading = true;
        continue;
      }

       // scripts
      this.processScriptElements(document, sites);
    }
   
    var j;
    for (j = sites.length; j-- > 0;) {
      url = sites[j];
      if (/:/.test(url) && !(
          /^(?:file:\/\/|[a-z]+:\/*[^\/\s]+)/.test(url) || 
          this.getSite(url + "x") == url // doesn't this URL type support host?
        )) {
        sites.splice(j, 1); // reject scheme-only URLs
      }
    }
    
    
    sites.topURL = sites[0] || '';
    
    if (loading) try {
      browser.ownerDocument.defaultView.noscriptOverlay.syncUI();
    } catch(e) {}
    
    return this.sortedSiteSet(sites);
    
  },
  
  findOverlay: function(browser) {
    return browser && browser.ownerDocument.defaultView.noscriptOverlay;
  },
  

  // nsIChannelEventSink implementation

  onChannelRedirect: function(oldChannel, newChannel, flags) {
    const rw = this.requestWatchdog;
    const uri = newChannel.URI;
    
    if (HTTPS.forceURI(uri.clone())) {
      HTTPS.replaceChannel(newChannel);
    }
    
    IOUtil.attachToChannel(newChannel, "noscript.redirectFrom", oldChannel.URI);
    
    ABE.updateRedirectChain(oldChannel, newChannel);
    
    const ph = PolicyState.detach(oldChannel);
    try {
      if (ph) {
        // 0: aContentType, 1: aContentLocation, 2: aRequestOrigin, 3: aContext, 4: aMimeTypeGuess, 5: aInternalCall
        
        ph.contentLocation = uri;
        
        var ctx = ph.context;
        
        if (!this.isJSEnabled(oldChannel.URI.spec)) ph.requestOrigin = oldChannel.URI;
        try {
          ph.mimeType = newChannel.contentType || oldChannel.contentType || ph.mimeType;
        } catch(e) {}
        
        var browser, win;
        var type = ph.contentType;
        if(type != 6) { // not a document load? try to cache redirection for menus
          try {
            var site = this.getSite(uri.spec);
            win = IOUtil.findWindow(newChannel) || ctx && ((ctx instanceof CI.nsIDOMWindow) ? ctx : ctx.ownerDocument.defaultView); 
            browser = win && DOM.findBrowserForNode(win);
            if (browser) {
              this.getRedirCache(browser, win.top.document.documentURI)
                  .push({ site: site, type: type });
            } else {
              if (this.consoleDump) this.dump("Cannot find window for " + uri.spec);
            }
          } catch(e) {
            if (this.consoleDump) this.dump(e);
          }
          
          if (type == 7) {
            ph.extra = CP_FRAMECHECK;
            if (win && win.frameElement && ph.context != win.frameElement) {
              // this shouldn't happen
              if (this.consoleDump) this.dump("Redirected frame change for destination " + uri.spec);
              ph.context = win.frameElement;
            }
          }
          
        }
        
        if (this.shouldLoad.apply(this, ph.toArray()) != CP_OK) {
          if (this.consoleDump) {
            this.dump("Blocked " + oldChannel.URI.spec + " -> " + uri.spec + " redirection of type " + type);
          }
          throw "NoScript aborted redirection to " + uri.spec;
        }
        
        PolicyState.save(uri, ph);
      }
    } finally {
      PolicyState.reset();
    }
    
    // Document transitions
  
    if ((oldChannel.loadFlags & rw.DOCUMENT_LOAD_FLAGS) || (newChannel.loadFlags & rw.DOCUMENT_LOAD_FLAGS) && oldChannel.URI.prePath != uri.prePath) {
      if (newChannel instanceof CI.nsIHttpChannel)
        HTTPS.onCrossSiteRequest(newChannel, oldChannel.URI.spec,
                               browser || DOM.findBrowserForNode(IOUtil.findWindow(oldChannel)), rw);
      
      // docshell JS state management
      win = win || IOUtil.findWindow(oldChannel);
      this._handleDocJS2(win, oldChannel);
      this._handleDocJS1(win, newChannel);
    }
    
  },
  
  getRedirCache: function(browser, uri) {
    var redirCache = this.getExpando(browser, "redirCache", {});
    return redirCache[uri] || (redirCache[uri] = []);
  },
  
  recentlyBlocked: [],
  _recentlyBlockedMax: 40,
  recordBlocked: function(site) {
    var l = this.recentlyBlocked;
    var pos = l.lastIndexOf(site);
    
    if (pos > -1) {
      if (pos == l.length - 1) return;
      l.splice(pos, 1);
    }
    
    l.push(site);
    if (l.length > this._recentlyBlockedMax) {
      this.recentlyBlocked = l.slice(- this._recentlyBlockedMax / 2);
    }
  },
  
  // nsIWebProgressListener implementation
  onLinkIconAvailable: function(x) {}, // tabbrowser.xml bug?
  onStateChange: function(wp, req, stateFlags, status) {
    var ph;
    
    if (stateFlags & WP_STATE_START) {
      if (req instanceof CI.nsIChannel) { 
        // handle docshell JS switching and other early duties
        
        if (PolicyState.isChecking(req.URI)) {
          // ContentPolicy couldn't complete! DOS attack?
          PolicyState.removeCheck(req.URI);
          DOSChecker.abort(req);
          return;
        }
        
        if (req instanceof CI.nsIHttpChannel) {
          PolicyState.attach(req);
        }
        
        
        if ((stateFlags & WP_STATE_START_DOC) == WP_STATE_START_DOC) {
          if (req.URI.spec == "about:blank" && !IOUtil.extractInternalReferrer(req) ) {
           // new tab, we shouldn't touch its window otherwise we break stuff like newTabURL
           return;
          }
          
          // ns.dump(req.URI.spec + " state " + stateFlags + ", " + req.loadFlags +  ", pending " + req.isPending());
          
          var w = wp.DOMWindow;
          
          if (w) {
            
            if (w != w.top && w.frameElement) {
              ph = ph || PolicyState.extract(req);
              if (ph && this.shouldLoad(7, req.URI, ph.requestOrigin, w.frameElement, '', CP_FRAMECHECK) != CP_OK) { // late frame/iframe check
                IOUtil.abort(req);
                return;
              }
            }

            this._handleDocJS1(w, req);
            
          }
  
        } else try {

          ph = ph || PolicyState.extract(req); 
          
          if (!ph && req instanceof CI.nsIHttpChannel && wp.DOMWindow.document instanceof CI.nsIDOMXULDocument
                  && !/^(?:chrome|resource):/i.test(wp.DOMWindow.document.documentURI)) {
            if (!this.isJSEnabled(req.URI.prePath)) {
              IOUtil.abort(req);
              if (this.consoleDump & LOG_CONTENT_BLOCK) this.dump("Aborted XUL script " + req.URI.spec);
            }
          }
        } catch(e) {}
      }
    } else if ((stateFlags & WP_STATE_STOP))  {
      // STOP REQUEST
      if (req instanceof CI.nsIHttpChannel) {
        PolicyState.detach(req);
        ABERequest.clear(req); // release ABERequest, if any
      
        if (status === NS_ERROR_CONNECTION_REFUSED || status === NS_ERROR_NOT_AVAILABLE ||
            status === NS_ERROR_UNKNOWN_HOST) { // evict host from DNS cache to prevent DNS rebinding
          try {
            var host = req.URI.host;
            if (host) {
              if (status === NS_ERROR_UNKNOWN_HOST) {
                DNS.invalidate(host);
              } else {
                DNS.evict(host);
              }
            }
          } catch(e) {}
        }
      }
    }
  },
  onLocationChange: function(wp, req, location) {
    if (req && (req instanceof CI.nsIChannel)) try {        
      this._handleDocJS2(wp.DOMWindow, req);
      
      if (this.consoleDump & LOG_JS)
        this.dump("Location Change - req.URI: " + req.URI.spec + ", window.location: " +
                (wp.DOMWindow && wp.DOMWindow.location.href) + ", location: " + location.spec);

      this.onBeforeLoad(req, wp.DOMWindow, location);
    } catch(e) {
      if (this.consoleDump) this.dump(e);
    }
  },
  onStatusChange: function(wp, req, status, msg) {
    if (status == 0x804b0003 && (req instanceof CI.nsIChannel) && !ABE.isDeferred(req)) { // DNS resolving, check if we need to clear the cache
      try {
        var host = req.URI.host;
        if (host) {
          var loadFlags = req.loadFlags;
          var cached = DNS.getCached(host);
          if (!cached || cached.expired ||
              loadFlags & LF_VALIDATE_ALWAYS ||
              loadFlags & LF_LOAD_BYPASS_ALL_CACHES) {
            if (cached) DNS.evict(host);
            
            ABE.log("Repeating ABE checks after DNS refresh for " + req.URI.spec);
            var abeReq = new ABERequest(req);
            this.requestWatchdog.handleABE(abeReq, loadFlags & req.LOAD_DOCUMENT_URI);
            
          }
        }
      } catch (e) {}
    }
  },
  onSecurityChange: function() {}, 
  onProgressChange: function() {},
  
  get _inclusionTypeInternalExceptions() {
    delete this._inclusionTypeInternalExceptions;
    return this._inclusionTypeInternalExceptions = new AddressMatcher("https://*.ebaystatic.com/*");
  },
  
  checkInclusionType: function(channel) {
    try {
      if (channel instanceof CI.nsIHttpChannel &&
          Math.round(channel.responseStatus / 100) != 3) {
        var ph = PolicyState.extract(channel);
        if (ph) {
          var ctype = ph.contentType;
          var origin = ABE.getOriginalOrigin(channel) || ph.requestOrigin;
          if (origin && (ctype === 2 || ctype === 3) && this.getBaseDomain(origin.host) != this.getBaseDomain(channel.URI.host)) {

            var mime;
            try {
              mime = channel.contentType;
            } catch (e) {
              mime = "UNKNOWN";
            }
            
            // a non-generic mime type has been given, let's check it strictly
            if (
               (ctype === 2
                  ? /\bj(?:avascript|s(?:on)?)\b/
                  : (PolicyUtil.isXSL(ph.context) ? /\bx[ms]l/ : /\bcss\b/)
                ).test(mime)
              ) {
              return true;
            }

            var disposition;
            try {
              disposition = channel.getResponseHeader("Content-disposition");
            } catch(e) {}

            
            if (!disposition) {
              var url = channel.URI; 
              var ext = (url instanceof CI.nsIURL) ? url.fileExtension : '';
              
              if (ext &&
                  (ctype === 2 && /js(?:on)?/i.test(ext) ||
                   ctype == 3 && (ext == "css" || ext == "xsl" && (PolicyUtil.isXSL(ph.context))))
                ) {
                // extension matches and not an attachment, likely OK
                return true; 
              }
              
              // extension doesn't match, let's check the mime
              
             
              if ((/^text\/.*ml$|unknown/i.test(mime)
                  || mime == "text/plain" && !(ext && /^(?:asc|log|te?xt)$/.test(ext)) // see Apache's magic file, turning any unkown ext file containing JS style comments into text/plain
                  )
                  && !this.getPref("inclusionTypeChecking.checkDynamic", false)) {
                // text/html or xml, let's assume a misconfigured dynamically served script/css
                if (this.consoleDump) this.dump(
                      "Warning: mime type " + mime + " for " +
                      (ctype == 2 ? "Javascript" : "CSS") + " served from " +
                     url.spec);
                return true;
              }
            } else mime = mime + ", " + disposition;
            
            // every check failed, this is a fishy cross-site mistyped inclusion
            if (this._inclusionTypeInternalExceptions.testURI(url) ||
                new AddressMatcher(this.getPref("inclusionTypeChecking.exceptions", "")).testURI(url))
              return true;
            this.log("[NoScript] Blocking cross site " + (ctype == 2 ? "Javascript" : "CSS") + " served from " +
                     channel.URI.spec +
                     " with wrong type info " + mime + " and included by " + origin.spec);
            IOUtil.abort(channel);
            return false;
          }
        }
      }
    } catch(e) {
      if (this.consoleDump) this.dump("Error checking inclusion type for " + channel.name + ": " + e);
    }
    return true;
  },

  onContentSniffed: function(req) {
    try {
      
      try {
        req.contentType;
        if (this.consoleDump & LOG_SNIFF)
          this.dump("OCS: " + req.URI.spec + ", " + req.contentType);
      } catch(e) {
        this.dump("OCS: " + req.URI.spec + ", CONTENT TYPE UNAVAILABLE YET");
        return;  // we'll check later in http-on-examine-merged-response
      }
      
      const domWindow = IOUtil.findWindow(req);
      if (domWindow && domWindow == domWindow.top) 
        return; // for top windows we call onBeforeLoad in onLocationChange
      
      var status = req.responseStatus;
      if (status >= 300 && status < 400) // redirect, wait for ultimate destination, see http://forums.informaction.com/viewtopic.php?f=7&t=2630
        return;
      
      
      if (ABE.checkFrameOpt(domWindow, req) &&
          this.getPref("frameOptions.enabled") &&
          !new AddressMatcher(this.getPref("frameOptions.parentWhitelist"))
            .test(domWindow.parent.location.href)
          ) {
        IOUtil.abort(req);
        this.showFrameOptError(domWindow, req.URI.spec);
        return; // canceled by frame options
      }
      this.onBeforeLoad(req, domWindow, req.URI);
    } catch(e) {
      if (this.consoleDump) this.dump(e);
    }
  },
  
  showFrameOptError: function(w, url) {
    this.log("X-FRAME-OPTIONS: blocked " + url, true);
    var f = w && w.frameElement;
    if (!f) return;
    const errPage = this.contentBase + "frameOptErr.xhtml";
    f.addEventListener("load", function(ev) {
      f.removeEventListener(ev.type, arguments.callee, false);
      if (errPage == f.contentWindow.location.href)
        f.contentWindow.document.getElementById("link")
          .setAttribute("href", url);
    }, false);
    f.contentWindow.location.replace(errPage);
  },

  
  onBeforeLoad: function(req, domWindow, location) {
    
    if (!domWindow) return;
    
    const uri = location;
    
    var docShell = null;
    
     
    var contentType;
    try {
      contentType = req.contentType;
    } catch(e) {
      contentType = "";
    }
    
    var contentDisposition = "";
   
    if (req instanceof CI.nsIHttpChannel) {
      
      try {
        contentDisposition = req.getResponseHeader("Content-disposition");
      } catch(e) {}
      

      if (domWindow.document)
        this.filterUTF7(req, domWindow, docShell = DOM.getDocShellForWindow(domWindow)); 
    }
    
    
    if (this.checkJarDocument(uri, domWindow)) {
      IOUtil.abort(req);
    }
  
    
    const topWin = domWindow == domWindow.top;

    var browser = null;
    var overlay = null;
    var xssInfo = null;
    

    if (topWin) {
      
      if (domWindow instanceof CI.nsIDOMChromeWindow) return;
    
      browser = DOM.findBrowserForNode(domWindow);
      overlay = this.findOverlay(browser);
      if (overlay) {
        overlay.setMetaRefreshInfo(null, browser);
        xssInfo = IOUtil.extractFromChannel(req, "noscript.XSS");
        if (xssInfo) xssInfo.browser = browser;
        this.requestWatchdog.unsafeReload(browser, false);
        
        if (!this.getExpando(browser, "clearClick")) {
          this.setExpando(browser, "clearClick", true);
          this.clearClickHandler.install(browser);
        }
      }
    }
    
    
    this._handleDocJS3(uri.spec, domWindow, docShell);
    
    
    
    if (!/^attachment\b/i.test(contentDisposition) &&
        this.shouldLoad(7, uri, uri, domWindow.frameElement || domWindow, contentType,
                        domWindow.frameElement ? CP_FRAMECHECK : CP_SHOULDPROCESS) != CP_OK) {
      
      req.loadFlags |= req.INHIBIT_CACHING;
      
      if (this.consoleDump & LOG_CONTENT_INTERCEPT)
        this.dump("Media document content type detected");

      if(!topWin) { 
        // check if this is an iframe
        
        if (domWindow.frameElement && !(domWindow.frameElement instanceof CI.nsIDOMHTMLFrameElement)
            && this.shouldLoad(5, uri, IOS.newURI(domWindow.parent.location.href, null, null),
                domWindow.frameElement, contentType, CP_SHOULDPROCESS) == CP_OK)
            return;
        
        if (this.consoleDump & LOG_CONTENT_BLOCK) 
          this.dump("Deferring framed media document");
        
        var url = uri.spec;
        
        browser = browser || DOM.findBrowserForNode(domWindow);
        this.getRedirCache(browser, domWindow.top.document.documentURI).push({site: this.getSite(url), type: 7});
        // defer separate embed processing for frames
        
        
       
        docShell = docShell || DOM.getDocShellForWindow(domWindow);
        docShell.loadURI("data:" + req.contentType + ",",
                             CI.nsIWebNavigation.LOAD_FLAGS_REPLACE_HISTORY,
                             null, null, null);
        Thread.asap(function() {
          IOUtil.abort(req);
          if (docShell) {
            var doc = docShell.document;
            docShell.stop(0);
            docShell.loadURI(ns.createPluginDocumentURL(url,
              doc.body && doc.body.firstChild && doc.body.firstChild.tagName),
                             CI.nsIWebNavigation.LOAD_FLAGS_REPLACE_HISTORY,
                             null, null, null);
          }
        });
        
        return;
      }
      
      if (this.consoleDump & LOG_CONTENT_BLOCK) 
        this.dump("Blocking top-level plugin document");

      IOUtil.abort(req);
      
      
      ["embed", "video", "audio"].forEach(function(tag) {
        var embeds = domWindow.document.getElementsByTagName(tag);
        var eType = "application/x-noscript-blocked";
        var eURL = "data:" + eType + ",";
        var e;
        for (var j = embeds.length; j-- > 0;) {
          e = embeds.item(j);
          if (this.shouldLoad(5, uri, null, e, contentType, CP_SHOULDPROCESS) != CP_OK) {
            e.src = eURL;
            e.type = eType;
          }
        }
      }, this);
      
      if (xssInfo) overlay.notifyXSS(xssInfo);
      
      return;

    } else {
      if (topWin) {
        if (xssInfo) overlay.notifyXSSOnLoad(xssInfo);
      }
    }
  },
  
  get clearClickHandler() {
      const cch = new ClearClickHandler(this);
      this.__defineGetter__("clearClickHandler", function() { return cch; })
      return cch;
  },
  
  _handleDocJS1: function(win, req) {
    
    const abeSandboxed = ABE.isSandboxed(req);
    const docShellJSBlocking = this.docShellJSBlocking || abeSandboxed;
    
    
    if (!docShellJSBlocking || (win instanceof CI.nsIDOMChromeWindow)) return;
    
    
    try {
      
      var docShell = DOM.getDocShellForWindow(win) ||
                     DOM.getDocShellForWindow(IOUtil.findWindow(req));
      
      var url = req.URI.spec;
      if (!/^https?:/.test(url)) url = req.originalURI.spec;

      if (!docShell) {
        if (this.consoleDump) this.dump("DocShell not found for JS switching in " + url);
        return;
      }
      
      if (abeSandboxed) {
        ABE.sandbox(docShell);
        return;
      }
      
      var jsEnabled;
      if (docShellJSBlocking & 2) { // block not whitelisted
        jsEnabled = url && this.isJSEnabled(this.getSite(url)) || /^about:/.test(url);
      } else if (docShellJSBlocking & 1) { // block untrusted only
        var site = this.getSite(url);
        jsEnabled = !(this.isUntrusted(site) || this.isForbiddenByHttpsStatus(site));
      } else return;
      
      const dump = this.consoleDump & LOG_JS;
      const prevStatus = docShell.allowJavascript;
      
      // Trying to be kind with other docShell-level blocking apps (such as Tab Mix Plus), we
      // check if we're the ones who actually blocked this docShell, or if this channel is out of our control
      var prevBlocked = this.getExpando(win.document, "prevBlocked");
      prevBlocked = prevBlocked ? prevBlocked.value : "?";

      if (dump)
        this.dump("DocShell JS Switch: " + url + " - " + jsEnabled + "/" + prevStatus + "/" + prevBlocked);
      
      if (jsEnabled && !prevStatus) {
        
        // be nice with other blockers
        if (!prevBlocked) return;
        
        // purge body events
        try {
          var aa = win.document.body && win.document.body.attributes;
          if (aa) for (var j = aa.length; j-- > 0;) {
            if(/^on/i.test(aa[j].name)) aa[j].value = "";
          }
        } catch(e1) {
          if (this.consoleDump & LOG_JS)
            this.dump("Error purging body attributes: " + e2);
        }
      }
      
      IOUtil.attachToChannel(req, "noscript.dsjsBlocked",
                { value: // !jsEnabled && (prevBlocked || prevStatus)
                        // we're the cause of the current disablement if
                        // we're disabling and (was already blocked by us or was not blocked)
                        !(jsEnabled || !(prevBlocked || prevStatus)) // De Morgan for the above, i.e.
                        // we're the cause of the current disablement unless
                        // we're enabling or (was already blocked by someone else = was not (blocked by us or enabled))
                        // we prefer the latter because it coerces to boolean
                });
      
      docShell.allowJavascript = jsEnabled;
    } catch(e2) {
      if (this.consoleDump & LOG_JS)
        this.dump("Error switching DS JS: " + e2);
    }
  },
  
  _handleDocJS2: function(win, req) {
    // called at the beginning of onLocationChange
    if (win)
      this.setExpando(win.document, "prevBlocked",
        IOUtil.extractFromChannel(req, "noscript.dsjsBlocked")
      );
  },
  
  _handleDocJS3: function(url, win, docShell) {
    // called at the end of onLocationChange
    var jsBlocked = docShell && !docShell.allowJavascript || !(this.jsEnabled || this.isJSEnabled(this.getSite(url)));
    
    
    
    if (jsBlocked) {
      if (this.getPref("fixLinks")) {
        win.addEventListener("click", this.bind(this.onContentClick), true);
        win.addEventListener("change", this.bind(this.onContentChange), true);
      }
      return;
    }
    
    ScriptSurrogate.apply(win.document, url, url);
    try {
      if(this.jsHackRegExp && this.jsHack && this.jsHackRegExp.test(url) && !win._noscriptJsHack) {
        try {
          win._noscriptJsHack = true;
          ScriptSurrogate.execute(win, this.jsHack);
        } catch(jsHackEx) {}
      }
    } catch(e) {}
    
  },
  
  beforeManualAllow: function(win) {
    // reset prevBlock info, to forcibly allow docShell JS
    this.setExpando(win.document, "prevBlocked", { value: "m" });
  },
  
  handleErrorPage: function(win, uri) {
    win = win && win.contentWindow || win;
    if (!win) return;
    var docShell = DOM.getDocShellForWindow(win);
    if (!docShell) return;
    
    docShell.allowJavascript = true;
    
    if (!this.getPref("STS.expertErrorUI"))
      STS.patchErrorPage(docShell, uri);
  },
  
  checkJarDocument: function(uri, context, origin) {
    if (this.forbidJarDocuments && (uri instanceof CI.nsIJARURI) &&
      !(/^(?:file|resource|chrome)$/.test(uri.JARFile.scheme) ||
          this.forbidJarDocumentsExceptions &&
          this.forbidJarDocumentsExceptions.test(uri.spec)) &&
      (origin && origin.prePath != uri.prePath)
      ) {
      if (context && this.getPref("jarDoc.notify", true)) {
        var window = (context instanceof CI.nsIDOMWindow) && context || 
          (context instanceof CI.nsIDOMDocumentView) && context.defaultView || 
          (context instanceof CI.nsIDOMNode) && context.ownerDocument && context.ownerDocument.defaultView;
        if (window) {
          this.delayExec(this.displayJarFeedback, 10, {
            context: context,
            uri: uri.spec
          });
        } else {
          this.dump("checkJarDocument -- window not found");
        }
      }
      this.log("[NoScript] " + this.getString("jarDoc.notify", [uri.spec]));
      return true;
    }
    return false;
  },
  
 
  
  displayJarFeedback: function(info) {
    var doc = (info.context instanceof CI.nsIDOMDocument) && info.context || 
      info.context.contentDocument || info.context.document || info.context.ownerDocument;
    if (!doc) {
      ns.dump("displayJarFeedback -- document not found");
      return;
    }
    var browser = DOM.findBrowserForNode(doc);
    if (browser) {
      var overlay = ns.findOverlay(browser);
      if (overlay && overlay.notifyJarDocument({
          uri: info.uri,
          document: doc
      })) return;
    } else {
      ns.dump("displayJarFeedback -- browser not found... falling back to content notify");
    }
    
    var message = ns.getString("jarDoc.notify", [SiteUtils.crop(info.uri)]) + 
      "\n\n" + ns.getString("jarDoc.notify.reference");
    
    var rootNode = doc.documentElement.body || doc.documentElement;
    const containerID = "noscript-jar-feedback";
    var container = doc.getElementById(containerID);
    if (container) container.parentNode.removeChild(container);
    container = rootNode.insertBefore(doc.createElementNS(HTML_NS, "div"), rootNode.firstChild || null);
    with (container.style) {
      backgroundColor = "#fffff0";
      borderBottom = "1px solid #444";
      color = "black";
      backgroundImage = "url(" + ns.pluginPlaceholder + ")";
      backgroundPosition = "left top";
      backgroundRepeat = "no-repeat";
      paddingLeft = "40px";
      margin = "0px";
      parring = "8px";
    }
    container.id = "noscript-jar-feedback";
    var description = container.appendChild(doc.createElementNS(HTML_NS, "pre"));
    description.appendChild(doc.createTextNode(message));
    description.innerHTML = description.innerHTML
    .replace(/\b(http:\/\/noscript\.net\/faq#jar)\b/g, 
              '<a href="$1" title="NoScript JAR FAQ">$1</a>'); 
  },
  // end nsIWebProgressListener
  
  filterUTF7: function(req, window, ds) {
    try {
      if (!ds) return;
      var as = CC["@mozilla.org/atom-service;1"].getService(CI.nsIAtomService);
      if(window.document.characterSet == "UTF-7" ||
        !req.contentCharset && (ds.documentCharsetInfo.parentCharset + "") == "UTF-7") {
        if(this.consoleDump) this.dump("Neutralizing UTF-7 charset!");
        ds.documentCharsetInfo.forcedCharset = as.getAtom("UTF-8");
        ds.documentCharsetInfo.parentCharset = ds.documentCharsetInfo.forcedCharset;
        ds.reload(ds.LOAD_FLAGS_CHARSET_CHANGE); // neded in Gecko > 1.9
      }
    } catch(e) { 
      if(this.consoleDump) this.dump("Error filtering charset on " + req.name + ": " + e) 
    }
  },
  
  _attemptNavigationInternal: function(doc, destURL, callback) {
    var cs = doc.characterSet;
    var uri = IOS.newURI(destURL, cs, IOS.newURI(doc.documentURI, cs, null));
    
    if (/^https?:\/\//i.test(destURL)) callback(doc, uri);
    else {
      var req = ns.createCheckedXHR("HEAD", uri.spec);
      req.open("HEAD", uri.spec);
      var done = false;
      req.onreadystatechange = function() {
        
        if (req.readystate < 2) return;
        try {
          if (!done && req.status) {
            done = true;
            if (req.status == 200) callback(doc, uri);
            req.abort();
          }
        } catch(e) {}
      }
      req.send(null);
    }
  },
  attemptNavigation: function(doc, destURL, callback) {
    // delay is needed on Gecko < 1.9 to detach browser context
    this.delayExec(this._attemptNavigationInternal, 0, doc, destURL, callback);
  },
  
  // simulate onchange on selects if options look like URLs
  onContentChange: function(ev) {
    var s = ev.originalTarget;
    if (!(s instanceof CI.nsIDOMHTMLSelectElement) ||
        s.hasAttribute("multiple") ||
        !/open|nav|location|\bgo|load/i.test(s.getAttribute("onchange"))) return;
    
    var doc = s.ownerDocument;
    var url = doc.documentURI;
    if (this.isJSEnabled(this.getSite(url))) return;
    
    var opt = s.options[s.selectedIndex];
    if (!opt) return;
    
    if (/[\/\.]/.test(opt.value) && opt.value.indexOf("@") < 0) {
      this.attemptNavigation(doc, opt.value, function(doc, uri) {
        doc.defaultView.location.href = uri.spec;
      });
      ev.preventDefault();
    }
  },
  
  onContentClick: function(ev) {
    
    if (ev.button == 2) return;
    
    var a = ev.originalTarget;
    
    if (a.__noscriptFixed) return;
    
    var doc = a.ownerDocument;
    var url = doc.documentURI;
    if (this.isJSEnabled(this.getSite(url))) return;
    
    var onclick;
    
    while (!(a instanceof CI.nsIDOMHTMLAnchorElement || a instanceof CI.nsIDOMHTMLAreaElement)) {
      if (typeof(a.getAttribute) == "function" && (onclick = a.getAttribute("onclick"))) break;
      if (!(a = a.parentNode)) return;
    }
    
    const href = a.getAttribute("href");
    // fix JavaScript links
    var jsURL;
    if (href) {
      jsURL = /^javascript:/.test(href);
      if (!(jsURL || href == "#")) return;
    } else {
      jsURL = "";
    }
    
    onclick = onclick || a.getAttribute("onclick");
    var fixedHref = (onclick && this.extractJSLink(onclick)) || 
                     (jsURL && this.extractJSLink(href)) || "";
    
    onclick = onclick || href;
    
    if (/\bsubmit\s*\(\s*\)/.test(onclick)) {
      var form;
      if (fixedHref) {
        form = doc.getElementById(fixedHref); // youtube
        if (!(form instanceof CI.nsIDOMHTMLFormElement)) {
          form = doc.forms.namedItem(fixedHref);   
        }
      }
      if (!form) {
        var m = onclick.match(/(?:(?:\$|document\.getElementById)\s*\(\s*["']#?([\w\-]+)[^;]+|\bdocument\s*\.\s*(?:forms)?\s*(?:\[\s*["']|\.)?([^\.\;\s"'\]]+).*)\.submit\s*\(\)/);
        form = m && (/\D/.test(m[1]) ? (doc.forms.namedItem(m[1]) || doc.getElementById(m[1])) : doc.forms.item(parseInt(m[1])));
        if (!(form && (form instanceof CI.nsIDOMHTMLFormElement))) {
          while (form = a.parentNode && form != doc && !form instanceof CI.nsIDOMHTMLFormElement);
        }
      }
      if (form && (form instanceof CI.nsIDOMHTMLFormElement)) {
        form.submit();
        ev.preventDefault();
      }
      return;
    }
    
    if (fixedHref) {
      var callback;
      if (/^(?:button|input)$/i.test(a.tagName)) { // JS button
        if (a.type == "button" || (a.type == "submit" && !a.form)) {
          callback = function(doc, uri) { doc.defaultView.location.href = uri.spec; }; 
        } else return;
      } else {
        var evClone = doc.createEvent("MouseEvents");
        evClone.initMouseEvent("click",ev.canBubble, ev.cancelable, 
                           ev.view, ev.detail, ev.screenX, ev.screenY, 
                           ev.clientX, ev.clientY, 
                           ev.ctrlKey, ev.altKey, ev.shiftKey, ev.metaKey,
                           ev.button, ev.relatedTarget);
        callback =
          function(doc, uri) {
            a.setAttribute("href", fixedHref);
            var title = a.getAttribute("title");
            a.setAttribute("title", title ? "[js] " + title : 
              (onclick || "") + " " + href
            );
            a.dispatchEvent(ev = evClone); // do not remove "ev = " -- for some reason, it works this way only :/
          };
        a.__noscriptFixed = true;
      }
      if (callback) {
        if (typeof(/ /) == "function") ev.preventDefault(); // Gecko < 1.9
        this.attemptNavigation(doc, fixedHref, callback);
        ev.preventDefault();
      }
    } else { // try processing history.go(n) //
      if(!onclick) return;
      
      jsURL = onclick.match(/history\s*\.\s*(?:go\s*\(\s*(-?\d+)\s*\)|(back|forward)\s*\(\s*)/);
      jsURL = jsURL && (jsURL = jsURL[1] || jsURL[2]) && (jsURL == "back" ? -1 : jsURL == "forward" ? 1 : jsURL); 

      if (!jsURL) return;
      // jsURL now has our relative history index, let's navigate

      var ds = DOM.getDocShellForWindow(doc.defaultView);
      if (!ds) return;
      var sh = ds.sessionHistory;
      if (!sh) return;
      
      var idx = sh.index + jsURL;
      if (idx < 0 || idx >= sh.count) return; // out of history bounds 
      ds.gotoIndex(idx);
      ev.preventDefault(); // probably not needed
    }
  },
  
  extractJSLink: function(js) {
    const findLink = /(['"])([\/\w-\?\.#%=&:@]+)\1/g;
    findLink.lastIndex = 0;
    var maxScore = -1;
    var score; 
    var m, s, href;
    while ((m = findLink.exec(js))) {
      s = m[2];
      if (/^https?:\/\//.test(s)) return s;
      score = 0;
      if (s.indexOf("/") > -1) score += 2;
      if (s.indexOf(".") > 0) score += 1;
      if (score > maxScore) {
        maxScore = score;
        href = s;
      }
    }
    return href || "";
  },
  
  createXSanitizer: function() {
    return new XSanitizer(this.filterXGetRx, this.filterXGetUserRx);
  },
  
  get compatEvernote() {
    delete this.compatEvernote;
    return this.compatEvernote = ("IWebClipper3" in CI) && this.getPref("compat.evernote") && {
      onload: function(ev) {
        var f = ev.currentTarget;
        if ((f.__evernoteLoadCount = (f.__evernoteLoadCount || 0) + 1) >= 7) {
          f.removeEventListener(ev.type, arguments.callee, false);
          var id = f.id.replace(/iframe/g, "clipper");
          for (var box = f.parentNode; box && box.id != id; box = box.parentNode);
          if (box) box.parentNode.removeChild(box);
        }
      }
    }
  },
  
  get compatGNotes() {
    delete this.compatGNotes;
    return this.compatGNotes = ("@google.com/gnotes/app-context;1" in CC) && this.getPref("compat.gnotes") &&
      "http://www.google.com/notebook/static_files/blank.html";
  },
  
  consoleService: CC["@mozilla.org/consoleservice;1"].getService(CI.nsIConsoleService),
  
  log: function(msg, dump) {
    this.consoleService.logStringMessage(msg);
    if (dump) this.dump(msg, true);
  },
 
  dump: function(msg, noConsole) {
    msg = "[NoScript] " + msg;
    dump(msg + "\n");
    if(this.consoleLog && !noConsole) this.log(msg);
  },
  
  versionChecked: false,
  checkVersion: function() {
    if (this.versionChecked) return;
    this.versionChecked = true;
    
    const ver =  this.VERSION;
    const prevVer = this.getPref("version", "");
    if (prevVer != ver) {
      this.setPref("version", ver);
      this.savePrefs();
      if (this.getPref("firstRunRedirection", true)) {
        this.delayExec(function() {
         
          const name = EXTENSION_NAME;
          const domain = name.toLowerCase() + ".net";
          var url = "http://" + domain + "/?ver=" + ver;
          var hh = "X-IA-Post-Install: " + name + " " + ver;
          if (prevVer) {
            url += "&prev=" + prevVer;
            hh += "; updatedFrom=" + prevVer;
          }
          hh += "\r\n";
          
          var hs = CC["@mozilla.org/io/string-input-stream;1"] .createInstance(CI.nsIStringInputStream);
          hs.setData(hh, hh.length); 
          
          var browser = DOM.mostRecentBrowserWindow.getBrowser();
          var b = (browser.selectedTab = browser.addTab()).linkedBrowser;
          b.stop();
          b.webNavigation.loadURI(url, CI.nsIWebNavigation.FLAGS_NONE, null, null, hs);
          
        }, 500);
      }
    }
  }
  
}

ns.wrappedJSObject = ns;
ns.register();

if ("nsIChromeRegistrySea" in CI) INCLUDE("SMUninstaller");