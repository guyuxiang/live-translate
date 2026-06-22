"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  const remainderSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${remainderMinutes}m`;
  if (minutes > 0) return `${minutes}m ${remainderSeconds}s`;
  return `${remainderSeconds}s`;
}

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
    costUsd: number;
    status: "active" | "ended" | "archived";
    durationSeconds: number;
    listenerPeakCount: number;
    lastActivityAt: string;
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
          costUsd?: number;
          status?: "active" | "ended" | "archived";
          durationSeconds?: number;
          listenerPeakCount?: number;
          lastActivityAt?: string;
        }) => ({
          sessionId: session.sessionId,
          name: session.name || session.sessionId,
          createdAt: session.createdAt,
          languageCount: session.languageCount ?? 0,
          tokenCount: session.tokenCount ?? 0,
          costUsd: session.costUsd ?? 0,
          status: session.status ?? "active",
          durationSeconds: session.durationSeconds ?? 0,
          listenerPeakCount: session.listenerPeakCount ?? 0,
          lastActivityAt: session.lastActivityAt ?? session.createdAt,
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
        {
          sessionId: data.sessionId,
          name,
          createdAt,
          languageCount: 0,
          tokenCount: 0,
          costUsd: 0,
          status: "active" as const,
          durationSeconds: 0,
          listenerPeakCount: 0,
          lastActivityAt: createdAt,
        },
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
            {recentSessions.map((session) => (
              <div
                key={session.sessionId}
                style={{
                  width: "100%",
                  padding: "16px 18px",
                  marginBottom: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  background: "var(--bg-surface)",
                  color: "var(--fg)",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    onClick={() => router.push(`/session/${session.sessionId}/broadcast`)}
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      background: "none",
                      border: "none",
                      color: "var(--fg)",
                      cursor: session.status === "archived" ? "not-allowed" : "pointer",
                      padding: 0,
                      textAlign: "left",
                      opacity: session.status === "archived" ? 0.5 : 1,
                    }}
                    disabled={session.status === "archived"}
                  >
                    {session.name}
                  </button>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: "2px 10px",
                    borderRadius: 100,
                    background: session.status === "active" ? "var(--success-soft, #e6f9ed)" : session.status === "ended" ? "var(--warning-soft, #fef3c7)" : "var(--bg-elevated)",
                    color: session.status === "active" ? "var(--success, #16a34a)" : session.status === "ended" ? "var(--warning, #d97706)" : "var(--fg-tertiary)",
                  }}>
                    {session.status}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--fg-tertiary)" }}>
                  {new Date(session.createdAt).toLocaleString()}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 13, color: "var(--fg-secondary)" }}>
                      {session.tokenCount.toLocaleString()} tokens
                    </span>
                    <span className="mono" style={{ fontSize: 13, color: "var(--fg-secondary)" }}>
                      ${session.costUsd.toFixed(4)}
                    </span>
                    {session.durationSeconds > 0 && (
                      <span className="mono" style={{ fontSize: 13, color: "var(--fg-secondary)" }}>
                        {formatDuration(session.durationSeconds)}
                      </span>
                    )}
                  </div>
                  {session.status !== "archived" && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await fetch(`/api/sessions/${session.sessionId}/archive`, { method: "POST" });
                        setRecentSessions((prev) =>
                          prev.map((s) =>
                            s.sessionId === session.sessionId ? { ...s, status: "archived" as const } : s
                          )
                        );
                      }}
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: "3px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elevated)",
                        color: "var(--fg-secondary)",
                        cursor: "pointer",
                        flexShrink: 0,
                        marginLeft: 16,
                      }}
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
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
