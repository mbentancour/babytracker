import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../utils/i18n";

const STEPS = { WELCOME: 0, SCAN: 1, CONNECT: 2, CONNECTING: 3, SUCCESS: 4, ERROR: 5 };

export default function SetupWizard() {
  const { t } = useI18n();
  const [step, setStep] = useState(STEPS.WELCOME);
  const [networks, setNetworks] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [selectedSSID, setSelectedSSID] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const scanNetworks = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("./api/setup/wifi/scan");
      if (res.ok) {
        const data = await res.json();
        setNetworks(data || []);
      }
    } catch {
      // ignore scan errors
    }
    setScanning(false);
  }, []);

  const handleConnect = async () => {
    if (!selectedSSID) return;
    setStep(STEPS.CONNECTING);
    setError("");
    try {
      const res = await fetch("./api/setup/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: selectedSSID, password }),
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

  useEffect(() => {
    if (step === STEPS.SCAN) {
      scanNetworks();
    }
  }, [step, scanNetworks]);

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
            <button style={styles.button} onClick={() => setStep(STEPS.SCAN)}>
              {t("setup.getStarted")}
            </button>
          </div>
        )}

        {step === STEPS.SCAN && (
          <div style={styles.content}>
            <p style={styles.text}>{t("setup.selectNetwork")}</p>
            {scanning ? (
              <div style={styles.spinnerWrap}>
                <div className="loading-spinner" />
                <span style={styles.subtext}>{t("setup.scanning")}</span>
              </div>
            ) : (
              <>
                <div style={styles.networkList}>
                  {networks.map((n) => (
                    <button
                      key={n.ssid}
                      style={{
                        ...styles.networkItem,
                        ...(selectedSSID === n.ssid ? styles.networkSelected : {}),
                      }}
                      onClick={() => setSelectedSSID(n.ssid)}
                    >
                      <div style={styles.networkName}>
                        {n.security && n.security !== "--" && (
                          <span style={styles.lockIcon}>&#128274;</span>
                        )}
                        {n.ssid}
                      </div>
                      <div style={styles.signal}>{n.signal}%</div>
                    </button>
                  ))}
                  {networks.length === 0 && (
                    <p style={styles.subtext}>{t("setup.noNetworks")}</p>
                  )}
                </div>
                <div style={styles.actions}>
                  <button style={styles.secondaryBtn} onClick={scanNetworks}>
                    {t("setup.rescan")}
                  </button>
                </div>
                {selectedSSID && (
                  <button style={styles.button} onClick={() => setStep(STEPS.CONNECT)}>
                    {t("setup.next")}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {step === STEPS.CONNECT && (
          <div style={styles.content}>
            <p style={styles.text}>
              {t("setup.connectTo")} <strong>{selectedSSID}</strong>
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("setup.wifiPassword")}
              style={styles.input}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={() => setStep(STEPS.SCAN)}>
                {t("setup.back")}
              </button>
              <button style={styles.button} onClick={handleConnect}>
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
            <button style={styles.button} onClick={() => setStep(STEPS.SCAN)}>
              {t("setup.tryAgain")}
            </button>
          </div>
        )}
      </div>
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
};
