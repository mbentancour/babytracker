import { useState, useEffect } from "react";
import { useI18n } from "../utils/i18n";

const STEPS = {
  WELCOME: 0,
  CHOOSE: 1,
  ETHERNET: 2,
  WIFI: 3,
  CONNECTING: 4,
  SUCCESS: 5,
  ERROR: 6,
};

export default function SetupWizard() {
  const { t } = useI18n();
  const [step, setStep] = useState(STEPS.WELCOME);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [staticEnabled, setStaticEnabled] = useState(false);
  const [staticAddr, setStaticAddr] = useState("");
  const [staticGateway, setStaticGateway] = useState("");
  const [staticDns, setStaticDns] = useState("1.1.1.1,8.8.8.8");
  const [error, setError] = useState("");
  const [status, setStatus] = useState({});

  // Poll status to learn what interfaces are available and which are connected
  useEffect(() => {
    fetch("./api/setup/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [step]);

  // staticInvalid returns true when "Use static IP" is checked but the
  // required fields aren't filled in yet.
  const staticInvalid = staticEnabled && (!staticAddr.trim() || !staticGateway.trim());

  const handleWifiConnect = async () => {
    if (!ssid.trim() || staticInvalid) return;
    setStep(STEPS.CONNECTING);
    setError("");
    const body = { ssid: ssid.trim(), password };
    if (staticEnabled) {
      body.address = staticAddr.trim();
      body.gateway = staticGateway.trim();
      body.dns = staticDns.trim();
    }
    try {
      const res = await fetch("./api/setup/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setStep(STEPS.SUCCESS);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("setup.connectFailed"));
        setStep(STEPS.ERROR);
      }
    } catch {
      setError(t("setup.connectFailed"));
      setStep(STEPS.ERROR);
    }
  };

  const handleEthernetConnect = async () => {
    if (staticInvalid) return;
    setStep(STEPS.CONNECTING);
    setError("");
    const body = staticEnabled
      ? { mode: "static", address: staticAddr.trim(), gateway: staticGateway.trim(), dns: staticDns.trim() }
      : { mode: "dhcp" };
    try {
      const res = await fetch("./api/setup/ethernet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setStep(STEPS.SUCCESS);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("setup.connectFailed"));
        setStep(STEPS.ERROR);
      }
    } catch {
      setError(t("setup.connectFailed"));
      setStep(STEPS.ERROR);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6C5CE7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="5" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
        </div>
        <h1 style={styles.title}>BabyTracker</h1>

        {step === STEPS.WELCOME && (
          <div style={styles.content}>
            <p style={styles.text}>{t("setup.welcome")}</p>
            <p style={styles.subtext}>{t("setup.welcomeDesc")}</p>
            <button style={styles.button} onClick={() => setStep(STEPS.CHOOSE)}>
              {t("setup.getStarted")}
            </button>
          </div>
        )}

        {step === STEPS.CHOOSE && (
          <div style={styles.content}>
            <p style={styles.text}>{t("setup.chooseConnection")}</p>
            {status.has_ethernet && (
              <button style={styles.button} onClick={() => { setStaticEnabled(false); setStep(STEPS.ETHERNET); }}>
                {t("setup.useEthernet")}
                {status.ethernet_up && status.ethernet_ip ? ` (${status.ethernet_ip})` : ""}
              </button>
            )}
            {status.has_wifi && (
              <button
                style={status.has_ethernet ? styles.secondaryBtn : styles.button}
                onClick={() => { setStaticEnabled(false); setStep(STEPS.WIFI); }}
              >
                {t("setup.useWifi")}
              </button>
            )}
          </div>
        )}

        {step === STEPS.ETHERNET && (
          <div style={styles.content}>
            <p style={styles.text}>{t("setup.ethernetTitle")}</p>
            <p style={styles.subtext}>
              {t(staticEnabled ? "setup.ethernetStaticHint" : "setup.ethernetDhcpHint")}
            </p>
            <StaticIpAdvanced
              t={t}
              enabled={staticEnabled}
              setEnabled={setStaticEnabled}
              addr={staticAddr}
              setAddr={setStaticAddr}
              gateway={staticGateway}
              setGateway={setStaticGateway}
              dns={staticDns}
              setDns={setStaticDns}
            />
            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={() => setStep(STEPS.CHOOSE)}>
                {t("setup.back")}
              </button>
              <button
                style={{ ...styles.button, opacity: staticInvalid ? 0.5 : 1, cursor: staticInvalid ? "not-allowed" : "pointer" }}
                disabled={staticInvalid}
                onClick={handleEthernetConnect}
              >
                {t("setup.connect")}
              </button>
            </div>
          </div>
        )}

        {step === STEPS.WIFI && (
          <div style={styles.content}>
            <p style={styles.text}>{t("setup.enterWifi")}</p>
            <p style={styles.subtext}>{t("setup.enterWifiHint")}</p>
            <input
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder={t("setup.wifiSsid")}
              style={styles.input}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("setup.wifiPassword")}
              style={styles.input}
              onKeyDown={(e) => e.key === "Enter" && ssid.trim() && !staticInvalid && handleWifiConnect()}
            />
            <StaticIpAdvanced
              t={t}
              enabled={staticEnabled}
              setEnabled={setStaticEnabled}
              addr={staticAddr}
              setAddr={setStaticAddr}
              gateway={staticGateway}
              setGateway={setStaticGateway}
              dns={staticDns}
              setDns={setStaticDns}
            />
            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={() => setStep(STEPS.CHOOSE)}>
                {t("setup.back")}
              </button>
              <button
                style={{
                  ...styles.button,
                  opacity: ssid.trim() && !staticInvalid ? 1 : 0.5,
                  cursor: ssid.trim() && !staticInvalid ? "pointer" : "not-allowed",
                }}
                disabled={!ssid.trim() || staticInvalid}
                onClick={handleWifiConnect}
              >
                {t("setup.connect")}
              </button>
            </div>
          </div>
        )}

        {step === STEPS.CONNECTING && (
          <div style={styles.content}>
            <div style={styles.spinnerWrap}>
              <div className="loading-spinner" />
              <p style={styles.text}>{t("setup.connecting")}</p>
              <p style={styles.subtext}>{t("setup.connectingDesc")}</p>
            </div>
          </div>
        )}

        {step === STEPS.SUCCESS && (
          <div style={styles.content}>
            <div style={styles.successIcon}>&#10003;</div>
            <p style={styles.text}>{t("setup.success")}</p>
            <p style={styles.subtext}>{t("setup.successDesc")}</p>
          </div>
        )}

        {step === STEPS.ERROR && (
          <div style={styles.content}>
            <p style={{ ...styles.text, color: "#e74c3c" }}>{t("setup.error")}</p>
            <p style={styles.subtext}>{error}</p>
            <button style={styles.button} onClick={() => setStep(STEPS.CHOOSE)}>
              {t("setup.tryAgain")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StaticIpAdvanced({ t, enabled, setEnabled, addr, setAddr, gateway, setGateway, dns, setDns }) {
  return (
    <div style={styles.advancedWrap}>
      <label style={styles.advancedToggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>{t("setup.useStaticIp")}</span>
      </label>
      {enabled && (
        <div style={styles.advancedFields}>
          <input
            type="text"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder={t("setup.staticAddrPlaceholder")}
            style={styles.input}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <input
            type="text"
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            placeholder={t("setup.staticGatewayPlaceholder")}
            style={styles.input}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <input
            type="text"
            value={dns}
            onChange={(e) => setDns(e.target.value)}
            placeholder={t("setup.staticDnsPlaceholder")}
            style={styles.input}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    padding: 20,
  },
  card: {
    background: "white",
    borderRadius: 20,
    padding: "40px 30px",
    maxWidth: 400,
    width: "100%",
    textAlign: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  logo: { marginBottom: 16 },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: "#2d3436",
    margin: "0 0 24px 0",
  },
  content: { display: "flex", flexDirection: "column", gap: 12 },
  text: { fontSize: 16, color: "#2d3436", margin: 0, lineHeight: 1.5 },
  subtext: { fontSize: 13, color: "#636e72", margin: 0, lineHeight: 1.5 },
  button: {
    padding: "12px 24px",
    borderRadius: 10,
    border: "none",
    background: "#6C5CE7",
    color: "white",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 8,
  },
  secondaryBtn: {
    padding: "10px 20px",
    borderRadius: 10,
    border: "1px solid #dfe6e9",
    background: "white",
    color: "#636e72",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  input: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid #dfe6e9",
    fontSize: 15,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  networkList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 250,
    overflowY: "auto",
  },
  networkItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #dfe6e9",
    background: "white",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 14,
    textAlign: "left",
  },
  networkSelected: {
    borderColor: "#6C5CE7",
    background: "#6C5CE710",
  },
  networkName: { display: "flex", alignItems: "center", gap: 6, color: "#2d3436" },
  lockIcon: { fontSize: 12 },
  signal: { fontSize: 12, color: "#636e72" },
  actions: { display: "flex", gap: 8, justifyContent: "center" },
  spinnerWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: 20,
  },
  successIcon: {
    fontSize: 48,
    color: "#00b894",
    marginBottom: 8,
  },
  advancedWrap: {
    marginTop: 8,
    paddingTop: 12,
    borderTop: "1px solid #ecf0f1",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  advancedToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#636e72",
    cursor: "pointer",
  },
  advancedFields: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
};
