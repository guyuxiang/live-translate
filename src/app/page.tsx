"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [password, setPassword] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [recentSessions, setRecentSessions] = useState<Array<{
    sessionId: string;
    name: string;
    createdAt: string;
    languageCount: number;
    tokenCount: number;
  }>>([]);

  useEffect(() => {
    const loadLocalSessions = () => {
      try {
        return JSON.parse(localStorage.getItem("liveTranslateSessions") || "[]");
      } catch {
        return [];
      }
    };

    window.setTimeout(() => setRecentSessions(loadLocalSessions()), 0);

    fetch("/api/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!Array.isArray(data?.sessions)) return;
        const persistedSessions = data.sessions.map((session: {
          sessionId: string;
          name?: string;
          createdAt: string;
          languageCount?: number;
          tokenCount?: number;
        }) => ({
          sessionId: session.sessionId,
          name: session.name || session.sessionId,
          createdAt: session.createdAt,
          languageCount: session.languageCount ?? 0,
          tokenCount: session.tokenCount ?? 0,
        }));
        setRecentSessions(persistedSessions);
        localStorage.setItem("liveTranslateSessions", JSON.stringify(persistedSessions));
      })
      .catch(() => {});
  }, []);

  function openPasswordDialog() {
    setShowPasswordDialog(true);
    setPassword("");
    setSessionName("");
    setPasswordError("");
  }

  function closePasswordDialog() {
    setShowPasswordDialog(false);
    setPassword("");
    setPasswordError("");
  }

  async function createSession() {
    if (!password) {
      setPasswordError("Password is required");
      return;
    }

    setLoading(true);
    setPasswordError("");

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizerName: "host", password, name: sessionName }),
      });
      const data = await res.json();

      if (!res.ok) {
        setPasswordError(data.error || "Incorrect password");
        setLoading(false);
        return;
      }

      const createdAt = new Date().toISOString();
      const name = sessionName.trim() || `Session ${new Date(createdAt).toLocaleString()}`;
      const nextSessions = [
        { sessionId: data.sessionId, name, createdAt, languageCount: 0, tokenCount: 0 },
        ...recentSessions.filter((s) => s.sessionId !== data.sessionId),
      ].slice(0, 8);
      localStorage.setItem("liveTranslateSessions", JSON.stringify(nextSessions));
      localStorage.setItem("liveTranslateLastBroadcastSession", data.sessionId);
      closePasswordDialog();
      router.push(`/session/${data.sessionId}/broadcast`);
    } catch (err) {
      console.error("Failed to create session:", err);
      setPasswordError("Network error, please try again");
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="container" style={{ textAlign: "center" }}>
        {/* Title */}
        <h1 className="display display-xl enter" style={{ marginBottom: 24 }}>
          <em>Live</em> Translate
        </h1>

        {/* Subtitle */}
        <p
          className="body enter-d1"
          style={{ maxWidth: 340, margin: "0 auto 48px" }}
        >
          Broadcast your voice. Attendees choose their language.
          Translation spins up on demand.
        </p>

        {/* CTA */}
        <div className="enter-d2">
          <button
            className="btn btn-dark"
            onClick={openPasswordDialog}
            disabled={loading}
            id="create-session-btn"
          >
            {loading ? (
              <>
                <span className="spinner" /> Creating…
              </>
            ) : (
              "Create session"
            )}
          </button>
        </div>

        {recentSessions.length > 0 && (
          <div className="enter-d3" style={{ marginTop: 48, textAlign: "left" }}>
            <span className="label" style={{ display: "block", marginBottom: 12 }}>Recent sessions</span>
            <hr className="rule" />
            {recentSessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => router.push(`/session/${session.sessionId}/broadcast`)}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--fg)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span>
                  <span style={{ display: "block", fontWeight: 500 }}>{session.name}</span>
                  <span className="mono">{new Date(session.createdAt).toLocaleString()}</span>
                </span>
                <span className="mono" style={{ textAlign: "right" }}>
                  {session.languageCount} langs<br />{session.tokenCount.toLocaleString()} tokens
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Steps */}
        <div
          className="enter-d3"
          style={{
            marginTop: 80,
            display: "flex",
            flexDirection: "column",
            gap: 0,
            textAlign: "left",
          }}
        >
          <hr className="rule" />
          {[
            "Speak into your microphone — your audio goes live",
            "Share the QR code with your audience",
            "Each language picked spins up one Gemini session",
          ].map((text, i) => (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  padding: "18px 0",
                  alignItems: "baseline",
                }}
              >
                <span className="mono" style={{ flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="body-sm" style={{ color: "var(--fg-secondary)" }}>
                  {text}
                </p>
              </div>
              <hr className="rule" />
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className="mono enter-d4" style={{ marginTop: 48 }}>
          Powered by Gemini Live API + LiveKit
        </p>
      </div>

      {/* Password Dialog */}
      {showPasswordDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg)",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePasswordDialog();
          }}
        >
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "40px 32px",
              minWidth: 340,
              maxWidth: 400,
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Enter Password
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--fg-tertiary)",
                marginBottom: 20,
              }}
            >
              A password is required to create a session
            </p>
            <input
              type="text"
              placeholder="Session name (optional)"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                color: "var(--fg)",
                fontSize: 15,
                outline: "none",
                textAlign: "center",
                marginBottom: 12,
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") createSession();
                if (e.key === "Escape") closePasswordDialog();
              }}
              autoFocus
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: passwordError
                  ? "1.5px solid var(--error)"
                  : "1px solid var(--border)",
                background: "var(--bg-elevated)",
                color: "var(--fg)",
                fontSize: 15,
                outline: "none",
                textAlign: "center",
                marginBottom: passwordError ? 8 : 20,
              }}
            />
            {passwordError && (
              <p
                style={{
                  color: "var(--error)",
                  fontSize: 13,
                  margin: "0 0 16px",
                }}
              >
                {passwordError}
              </p>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn btn-outline"
                onClick={closePasswordDialog}
                disabled={loading}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                className="btn btn-dark"
                onClick={createSession}
                disabled={loading}
                style={{ flex: 1 }}
              >
                {loading ? "Verifying…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
